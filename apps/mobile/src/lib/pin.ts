/**
 * Login por PIN de emergencia para operar sin internet.
 *
 * Seguridad:
 *  - El PIN (4-6 dígitos) se hashea con PBKDF2-SHA256 + salt aleatorio.
 *  - El hash y el salt se guardan en IndexedDB (no en localStorage ni sessionStorage).
 *  - El PIN es específico del dispositivo — no se puede usar en otro celular.
 *  - Al recuperar internet la sesión Firebase se revalida de forma transparente.
 */
import { db } from './db'

const PBKDF2_ITERATIONS = 200_000
const HASH_ALGO = 'SHA-256'

function bufToB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function b64ToBuf(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

async function deriveKey(pin: string, salt: BufferSource): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: HASH_ALGO, salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256
  )
}

/** Guarda el hash del PIN en IndexedDB. Sobreescribe si ya existe. */
export async function savePin(uid: string, pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hashBuf = await deriveKey(pin, salt)
  await db.pin.put({ id: 1, uid, hashB64: bufToB64(hashBuf), saltB64: bufToB64(salt.buffer as ArrayBuffer) })
}

/** Retorna true si el PIN coincide con el hash guardado. */
export async function verifyPin(pin: string): Promise<boolean> {
  const record = await db.pin.get(1)
  if (!record) return false

  const salt = b64ToBuf(record.saltB64)
  const hashBuf = await deriveKey(pin, salt.buffer as ArrayBuffer)
  return bufToB64(hashBuf) === record.hashB64
}

/** Retorna el uid del PIN guardado, o null si no hay PIN configurado. */
export async function getPinUid(): Promise<string | null> {
  const record = await db.pin.get(1)
  return record?.uid ?? null
}

/** Retorna true si este dispositivo tiene PIN configurado. */
export async function hasPinConfigured(): Promise<boolean> {
  const count = await db.pin.count()
  return count > 0
}
