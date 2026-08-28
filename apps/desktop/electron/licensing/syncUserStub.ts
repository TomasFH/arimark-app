/**
 * Asegura un stub de usuario local para satisfacer FKs al bajar datos remotos.
 * No crea perfiles reales: solo evita fallos de integridad referencial.
 *
 * `storeId` en `users` (y en clientes especiales) referencia `stores.id`.
 * Un admin de otro dispositivo o un UUID placeholder puede traer un local
 * que esta PC aún no tiene. Si no existe, se usa null.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { stores, users } from '../db/schema'

export function existingStoreIdOrNull(storeId: string | null | undefined): string | null {
  const id = storeId?.trim() || null
  if (!id) return null
  const row = getDb().select({ id: stores.id }).from(stores).where(eq(stores.id, id)).get()
  return row ? id : null
}

export function ensureUserStub(userId: string, fallbackStoreId?: string | null): void {
  const id = userId.trim()
  if (!id) return
  const db = getDb()
  const existing = db.select({ id: users.id }).from(users).where(eq(users.id, id)).all()[0]
  if (existing) return

  db.insert(users)
    .values({
      id,
      storeId: existingStoreIdOrNull(fallbackStoreId),
      name: `Usuario ${id.slice(0, 8)}`,
      firebaseUid: id,
      role: 'cashier',
      active: true,
      createdAt: new Date().toISOString(),
    })
    .run()
}
