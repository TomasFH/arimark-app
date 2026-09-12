/**
 * Sync de cebo con Firestore (colección que crece: solo outbox por doc, nunca getDocs de toda la colección).
 *
 * Path: licenses/{tenantId}/ceboEntries/{id}
 */
import { getFirestore, doc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore'
import log from 'electron-log'
import { eq, isNull } from 'drizzle-orm'
import { getDb } from '../db/client'
import { ceboEntries } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'

export async function pushUnsyncedCebo(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(ceboEntries).where(isNull(ceboEntries.syncedAt)).all()
  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const row of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'ceboEntries', row.id)
      await setDoc(ref, {
        id: row.id,
        storeId: row.storeId,
        shiftId: row.shiftId,
        quantityKg: row.quantityKg,
        notes: row.notes ?? null,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        updatedBy: row.updatedBy ?? null,
        updatedAt: row.updatedAt ?? null,
        deleted: false,
      }, { merge: true })

      db.update(ceboEntries)
        .set({ syncedAt: now })
        .where(eq(ceboEntries.id, row.id))
        .run()
    } catch (err) {
      log.error('[ceboSync] Error al pushear cebo', { id: row.id, err })
    }
  }

  log.info('[ceboSync] Cebo pusheado', { count: pending.length })
}

/**
 * Baja cebo de un local en un rango ISO (una semana). Nunca la colección entera.
 * No pisa filas locales pendientes de push.
 */
export async function pullCeboForStoreWeek(
  tenantId: string,
  storeId: string,
  startIso: string,
  endIso: string,
): Promise<number> {
  if (!isFirebaseAvailable()) return 0

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const q = query(
    collection(firestore, 'licenses', tenantId, 'ceboEntries'),
    where('storeId', '==', storeId),
    where('createdAt', '>=', startIso),
    where('createdAt', '<', endIso),
  )
  const snap = await getDocs(q)
  const db = getDb()
  let upserted = 0

  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>
    if (data['deleted'] === true) continue
    const kg = Number(data['quantityKg'])
    if (!Number.isFinite(kg) || kg <= 0) continue
    const shiftId = typeof data['shiftId'] === 'string' ? data['shiftId'] : ''
    if (!shiftId) continue
    const id = typeof data['id'] === 'string' ? data['id'] : d.id
    const createdAt = typeof data['createdAt'] === 'string' ? data['createdAt'] : startIso
    const createdBy = typeof data['createdBy'] === 'string' ? data['createdBy'] : ''
    if (!createdBy) continue

    const existing = db.select({
      id: ceboEntries.id,
      syncedAt: ceboEntries.syncedAt,
    }).from(ceboEntries).where(eq(ceboEntries.id, id)).get()
    if (existing && existing.syncedAt === null) continue

    const now = new Date().toISOString()
    db.insert(ceboEntries).values({
      id,
      storeId,
      shiftId,
      quantityKg: kg,
      notes: typeof data['notes'] === 'string' ? data['notes'] : null,
      createdBy,
      createdAt,
      updatedBy: typeof data['updatedBy'] === 'string' ? data['updatedBy'] : null,
      updatedAt: typeof data['updatedAt'] === 'string' ? data['updatedAt'] : null,
      syncedAt: now,
    }).onConflictDoUpdate({
      target: ceboEntries.id,
      set: {
        quantityKg: kg,
        notes: typeof data['notes'] === 'string' ? data['notes'] : null,
        updatedBy: typeof data['updatedBy'] === 'string' ? data['updatedBy'] : null,
        updatedAt: typeof data['updatedAt'] === 'string' ? data['updatedAt'] : null,
        syncedAt: now,
      },
    }).run()
    upserted += 1
  }

  if (upserted > 0) {
    log.info('[ceboSync] Cebo bajado de la semana', { storeId, count: upserted })
  }
  return upserted
}

export async function markCeboDeletedInFirestore(
  tenantId: string,
  ids: string[],
): Promise<void> {
  if (!isFirebaseAvailable() || ids.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const id of ids) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'ceboEntries', id)
      await updateDoc(ref, { deleted: true, deletedAt: now })
    } catch (err) {
      log.error('[ceboSync] No se pudo marcar cebo como eliminado', { id, err })
    }
  }
}
