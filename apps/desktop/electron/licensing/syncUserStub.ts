/**
 * Asegura un stub de usuario local para satisfacer FKs al bajar datos remotos.
 * No crea perfiles reales: solo evita fallos de integridad referencial.
 *
 * `storeId` en `users` (y en clientes especiales) referencia `stores.id`.
 * Un admin de otro dispositivo o un UUID placeholder puede traer un local
 * que esta PC aún no tiene. Si no existe, se usa null.
 */
import { eq } from 'drizzle-orm'
import log from 'electron-log'
import { getDb } from '../db/client'
import { stores, users } from '../db/schema'

type StubDb = {
  select: ReturnType<typeof getDb>['select']
  insert: ReturnType<typeof getDb>['insert']
  update: ReturnType<typeof getDb>['update']
}

export function existingStoreIdOrNull(storeId: string | null | undefined): string | null {
  const id = storeId?.trim() || null
  if (!id) return null
  const row = getDb().select({ id: stores.id }).from(stores).where(eq(stores.id, id)).get()
  return row ? id : null
}

export function ensureUserStub(
  userId: string,
  fallbackStoreId?: string | null,
  displayName?: string | null,
): void {
  ensureUserStubWith(getDb(), userId, fallbackStoreId, displayName)
}

/**
 * Misma semántica que `ensureUserStub`, usando el `tx` de una transacción
 * para que el stub sea visible a los INSERT posteriores del mismo tx.
 */
export function ensureUserStubWith(
  db: StubDb,
  userId: string,
  fallbackStoreId?: string | null,
  displayName?: string | null,
): void {
  const id = userId.trim()
  if (!id) return
  const existing = db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, id)).all()[0]
  const resolvedName = displayName?.trim() || ''
  if (existing) {
    if (resolvedName && existing.name.startsWith('Usuario ')) {
      db.update(users).set({ name: resolvedName }).where(eq(users.id, id)).run()
    }
    return
  }

  const base = {
    id,
    storeId: existingStoreIdOrNull(fallbackStoreId),
    name: resolvedName || `Usuario ${id.slice(0, 8)}`,
    role: 'cashier' as const,
    active: true,
    createdAt: new Date().toISOString(),
  }

  try {
    db.insert(users).values({ ...base, firebaseUid: id }).run()
    return
  } catch (err) {
    log.warn('[syncUserStub] Insert con firebaseUid chocó — reintento sin uid', { id, err })
  }

  try {
    db.insert(users).values({ ...base, firebaseUid: null }).run()
  } catch (err) {
    log.warn('[syncUserStub] No se pudo crear stub de usuario', { id, err })
  }
}
