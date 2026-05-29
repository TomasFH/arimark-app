/**
 * Capa unificada de almacenamiento seguro.
 *
 * - Electron safeStorage: tokens, timestamps de verificación de licencia,
 *   session tokens de cajeras. Cifrado a nivel OS user (DPAPI en Windows).
 *
 * - @napi-rs/keyring: credenciales de la caja SAM4S (HTTP Basic Auth).
 *   Se almacena en el Administrador de Credenciales de Windows para que el
 *   técnico pueda inspeccionarlas si hace falta sin necesidad de abrir la app.
 *
 * REGLA: Cero secretos en texto plano. Cero secretos en archivos rastreados por git.
 */

import { safeStorage } from 'electron'
import { Entry } from '@napi-rs/keyring'
import log from 'electron-log'

const APP_SERVICE = 'carniceria-app'

// ---------------------------------------------------------------------------
// safeStorage — tokens y secretos de app (cifrados con clave del OS user)
// ---------------------------------------------------------------------------

export function setSecret(key: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('[secureStorage] safeStorage no disponible en este sistema.')
  }
  const encrypted = safeStorage.encryptString(value)
  // Persistir en un archivo dentro de userData
  // La serialización y ruta se maneja en setSecretToFile
  _writeEncryptedFile(key, encrypted)
}

export function getSecret(key: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('[secureStorage] safeStorage no disponible — retornando null')
    return null
  }
  const encrypted = _readEncryptedFile(key)
  if (!encrypted) return null
  try {
    return safeStorage.decryptString(encrypted)
  } catch (err) {
    log.error('[secureStorage] Error al descifrar secreto', key, err)
    return null
  }
}

export function deleteSecret(key: string): void {
  _deleteEncryptedFile(key)
}

// ---------------------------------------------------------------------------
// @napi-rs/keyring — credenciales de hardware (Administrador de Credenciales)
// ---------------------------------------------------------------------------

/**
 * Guarda credenciales en el Administrador de Credenciales de Windows.
 * account: identificador de la cuenta (ej. 'sam4s-user')
 * password: contraseña en texto plano (se cifra internamente por el OS)
 */
export function setCredential(account: string, password: string): void {
  try {
    const entry = new Entry(APP_SERVICE, account)
    entry.setPassword(password)
    log.info('[secureStorage] Credencial guardada en Credential Manager', account)
  } catch (err) {
    log.error('[secureStorage] Error al guardar credencial', account, err)
    throw err
  }
}

export function getCredential(account: string): string | null {
  try {
    const entry = new Entry(APP_SERVICE, account)
    return entry.getPassword()
  } catch (err) {
    log.warn('[secureStorage] Credencial no encontrada o error', account, err)
    return null
  }
}

export function deleteCredential(account: string): void {
  try {
    const entry = new Entry(APP_SERVICE, account)
    entry.deletePassword()
    log.info('[secureStorage] Credencial eliminada del Credential Manager', account)
  } catch (err) {
    log.warn('[secureStorage] No se pudo eliminar credencial', account, err)
  }
}

// ---------------------------------------------------------------------------
// Claves conocidas (constantes para evitar typos)
// ---------------------------------------------------------------------------
export const SECRET_KEYS = {
  LAST_LICENSE_VERIFIED_AT: 'last-license-verified-at',
  FIREBASE_ANON_UID: 'firebase-anon-uid',
  CASHIER_SESSION_TOKEN: 'cashier-session-token',
  ADMIN_SESSION_TOKEN: 'admin-session-token',
} as const

export const CREDENTIAL_ACCOUNTS = {
  SAM4S_USER: 'sam4s-user',
  SAM4S_PASSWORD: 'sam4s-password',
} as const

// ---------------------------------------------------------------------------
// Helpers internos — archivos cifrados en userData
// ---------------------------------------------------------------------------

import { app } from 'electron'
import path from 'path'
import fs from 'fs'

function getSecretsDir(): string {
  const dir = path.join(app.getPath('userData'), '.secrets')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function _writeEncryptedFile(key: string, data: Buffer): void {
  const filePath = path.join(getSecretsDir(), _sanitizeKey(key))
  fs.writeFileSync(filePath, data)
}

function _readEncryptedFile(key: string): Buffer | null {
  const filePath = path.join(getSecretsDir(), _sanitizeKey(key))
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath)
}

function _deleteEncryptedFile(key: string): void {
  const filePath = path.join(getSecretsDir(), _sanitizeKey(key))
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}

function _sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_')
}
