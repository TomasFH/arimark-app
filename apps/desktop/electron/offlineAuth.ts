/**
 * Caché de credenciales para login offline en PC (DT-02, Opción E).
 *
 * Al login online se guarda un hash scrypt (Node nativo) en safeStorage.
 * Sin red, se compara la contraseña ingresada contra ese hash.
 * Nunca se persiste la contraseña en texto plano.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import log from 'electron-log'
import { getSecret, setSecret, SECRET_KEYS } from './secureStorage'

export const OFFLINE_TTL_MS = 30 * 24 * 60 * 60 * 1000

type CacheableRole = 'cashier' | 'admin'

export interface CacheableProfile {
  uid: string
  email: string
  role: CacheableRole
  displayName: string
  authorizedStores: string[]
}

const SCRYPT_KEYLEN = 32
const SCRYPT_SALT_LEN = 16
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const
const STORE_VERSION = 1 as const

export interface OfflineProfile {
  userId: string
  email: string
  name: string
  role: CacheableRole
  authorizedStores: string[]
}

interface OfflineCredentialRecord {
  userId: string
  name: string
  role: CacheableRole
  email: string
  salt: string
  hash: string
  storedAt: string
  expiresAt: string
  authorizedStores: string[]
  scryptN: number
  scryptR: number
  scryptP: number
  keylen: number
}

interface OfflineCredentialStore {
  version: typeof STORE_VERSION
  records: OfflineCredentialRecord[]
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function emptyStore(): OfflineCredentialStore {
  return { version: STORE_VERSION, records: [] }
}

function loadStore(): OfflineCredentialStore {
  const raw = getSecret(SECRET_KEYS.OFFLINE_CREDENTIALS)
  if (!raw) return emptyStore()
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return emptyStore()
    const recs = (parsed as { records?: unknown }).records
    if (!Array.isArray(recs)) return emptyStore()
    return { version: STORE_VERSION, records: recs.filter(isRecord) }
  } catch (err) {
    log.warn('[offlineAuth] Cache corrupto — se ignora', err)
    return emptyStore()
  }
}

function isRecord(value: unknown): value is OfflineCredentialRecord {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return (
    typeof r['userId'] === 'string' &&
    typeof r['email'] === 'string' &&
    typeof r['name'] === 'string' &&
    (r['role'] === 'cashier' || r['role'] === 'admin') &&
    typeof r['salt'] === 'string' &&
    typeof r['hash'] === 'string' &&
    typeof r['storedAt'] === 'string' &&
    typeof r['expiresAt'] === 'string'
  )
}

function saveStore(store: OfflineCredentialStore): void {
  setSecret(SECRET_KEYS.OFFLINE_CREDENTIALS, JSON.stringify(store))
}

function hashPassword(password: string, salt: Buffer, opts?: {
  N: number
  r: number
  p: number
  keylen: number
}): Buffer {
  const N = opts?.N ?? SCRYPT_OPTS.N
  const r = opts?.r ?? SCRYPT_OPTS.r
  const p = opts?.p ?? SCRYPT_OPTS.p
  const keylen = opts?.keylen ?? SCRYPT_KEYLEN
  return scryptSync(password, salt, keylen, { N, r, p, maxmem: SCRYPT_OPTS.maxmem }) as Buffer
}

/**
 * Guarda o actualiza el hash de un usuario tras un login online exitoso.
 * No-op si el rol no es cashier/admin.
 */
export function cacheCredentials(email: string, password: string, profile: CacheableProfile): void {
  if (profile.role !== 'cashier' && profile.role !== 'admin') return

  const normalized = normalizeEmail(email)
  const salt = randomBytes(SCRYPT_SALT_LEN)
  const hash = hashPassword(password, salt)
  const now = Date.now()
  const store = loadStore()
  const previous = store.records.find(r => r.email === normalized)
  const authorizedStores = profile.authorizedStores.length > 0
    ? profile.authorizedStores
    : (previous?.authorizedStores ?? [])

  const record: OfflineCredentialRecord = {
    userId: profile.uid,
    name: profile.displayName,
    role: profile.role,
    email: normalized,
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
    storedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + OFFLINE_TTL_MS).toISOString(),
    authorizedStores,
    scryptN: SCRYPT_OPTS.N,
    scryptR: SCRYPT_OPTS.r,
    scryptP: SCRYPT_OPTS.p,
    keylen: SCRYPT_KEYLEN,
  }

  store.records = store.records.filter(r => r.email !== normalized)
  store.records.push(record)
  saveStore(store)
  log.info('[offlineAuth] Credenciales cacheadas para login offline', { email: normalized })
}

/**
 * Compara email+password contra el hash local.
 * Retorna null si no hay cache, expiró, o la contraseña no coincide.
 * No revela si el email existe.
 */
export function validateOffline(email: string, password: string): OfflineProfile | null {
  const normalized = normalizeEmail(email)
  const store = loadStore()
  const rec = store.records.find(r => r.email === normalized)
  if (!rec) return null
  if (new Date(rec.expiresAt).getTime() <= Date.now()) {
    log.info('[offlineAuth] Hash expirado', { email: normalized })
    return null
  }

  let actual: Buffer
  try {
    const salt = Buffer.from(rec.salt, 'base64')
    actual = hashPassword(password, salt, {
      N: rec.scryptN || SCRYPT_OPTS.N,
      r: rec.scryptR || SCRYPT_OPTS.r,
      p: rec.scryptP || SCRYPT_OPTS.p,
      keylen: rec.keylen || SCRYPT_KEYLEN,
    })
  } catch (err) {
    log.warn('[offlineAuth] Error al hashear para comparar', err)
    return null
  }

  const expected = Buffer.from(rec.hash, 'base64')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null
  }

  return {
    userId: rec.userId,
    email: rec.email,
    name: rec.name,
    role: rec.role,
    authorizedStores: rec.authorizedStores ?? [],
  }
}
