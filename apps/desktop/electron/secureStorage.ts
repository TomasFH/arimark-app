/**
 * Capa unificada de almacenamiento seguro.
 *
 * - Electron safeStorage: tokens, timestamps de verificación de licencia,
 *   session tokens de cajeras. Cifrado a nivel OS user (DPAPI en Windows).
 *
 * REGLA: Cero secretos en texto plano. Cero secretos en archivos rastreados por git.
 */

import { safeStorage } from 'electron'
import log from 'electron-log'

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
// Claves conocidas (constantes para evitar typos)
// ---------------------------------------------------------------------------
export const SECRET_KEYS = {
  LAST_LICENSE_VERIFIED_AT: 'last-license-verified-at',
  FIREBASE_ANON_UID: 'firebase-anon-uid',
  ADMIN_SESSION_TOKEN: 'admin-session-token',
  // Hardware
  KRETZ_PORT: 'kretz-port',
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
