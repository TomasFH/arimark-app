/**
 * Asegura un stub de usuario local para satisfacer FKs al bajar datos remotos.
 * No crea perfiles reales: solo evita fallos de integridad referencial.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { users } from '../db/schema'

export function ensureUserStub(userId: string, fallbackStoreId: string): void {
  if (!userId) return
  const db = getDb()
  const existing = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).all()[0]
  if (existing) return

  db.insert(users)
    .values({
      id: userId,
      storeId: fallbackStoreId,
      name: `Usuario ${userId.slice(0, 8)}`,
      firebaseUid: userId,
      role: 'cashier',
      active: true,
      createdAt: new Date().toISOString(),
    })
    .run()
}
