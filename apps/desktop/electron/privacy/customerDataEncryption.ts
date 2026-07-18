/**
 * Protección local de los identificadores de clientes.
 *
 * DNI y teléfono se cifran con AES-256-GCM antes de persistirse en SQLite.
 * La clave se guarda mediante Electron safeStorage, que en Windows usa DPAPI
 * ligada al usuario del sistema operativo.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { getSecret, setSecret, SECRET_KEYS } from '../secureStorage'

const ENVELOPE_PREFIX = 'enc:v1:'
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

function getOrCreateKey(): Buffer {
  const stored = getSecret(SECRET_KEYS.CUSTOMER_DATA_ENCRYPTION_KEY)
  if (stored) {
    const key = Buffer.from(stored, 'base64')
    if (key.length !== 32) throw new Error('La clave de cifrado de clientes es inválida.')
    return key
  }

  const key = randomBytes(32)
  setSecret(SECRET_KEYS.CUSTOMER_DATA_ENCRYPTION_KEY, key.toString('base64'))
  return key
}

export function encryptCustomerIdentifier(value: string | null | undefined): string | null {
  if (!value) return null
  const key = getOrCreateKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENVELOPE_PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`
}

/**
 * Mantiene compatibilidad de lectura con datos creados antes del cifrado.
 * Esos valores se cifran al actualizar el cliente o volver a registrar un fiado.
 */
export function decryptCustomerIdentifier(value: string | null | undefined): string | null {
  if (!value) return null
  if (!value.startsWith(ENVELOPE_PREFIX)) return value

  const packed = Buffer.from(value.slice(ENVELOPE_PREFIX.length), 'base64')
  if (packed.length <= IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error('El identificador cifrado de cliente es inválido.')
  }

  const iv = packed.subarray(0, IV_BYTES)
  const tag = packed.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES)
  const encrypted = packed.subarray(IV_BYTES + AUTH_TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', getOrCreateKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

export function maskDni(value: string | null): string | null {
  if (!value) return null
  const visible = value.slice(-3)
  return `DNI •••••${visible}`
}

export function maskPhone(value: string | null): string | null {
  if (!value) return null
  const visible = value.replace(/\D/g, '').slice(-4)
  return `Tel. ••••${visible}`
}
