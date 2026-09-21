/**
 * Sync del libro de mercadería con Firestore (colección que crece:
 * solo outbox por doc, nunca getDocs de toda la colección).
 *
 * Path: licenses/{tenantId}/merchandiseIntakes/{id}
 * El array `lines` viaja embebido (hechos para stats semanales/mensuales).
 */
import { getFirestore, doc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore'
import log from 'electron-log'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '../db/client'
import { merchandiseIntakeLines, merchandiseIntakes } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import {
  merchDbLineToSnapshot,
  replaceIntakeLines,
} from './merchIntakeDb'
import {
  coerceMerchIntakePaymentKind,
  merchLineToFirestore,
  parseMerchLinesFromUnknown,
} from '@carniceria/shared'

function linesForIntake(
  db: ReturnType<typeof getDb>,
  intakeId: string,
): ReturnType<typeof merchDbLineToSnapshot>[] {
  return db
    .select()
    .from(merchandiseIntakeLines)
    .where(eq(merchandiseIntakeLines.intakeId, intakeId))
    .all()
    .map(merchDbLineToSnapshot)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function pushUnsyncedMerchandiseIntakes(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(merchandiseIntakes).where(and(
    isNull(merchandiseIntakes.syncedAt),
    eq(merchandiseIntakes.status, 'confirmed'),
  )).all()
  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const row of pending) {
    try {
      const lines = linesForIntake(db, row.id)
      const ref = doc(firestore, 'licenses', tenantId, 'merchandiseIntakes', row.id)
      await setDoc(ref, {
        id: row.id,
        storeId: row.storeId,
        shiftId: row.shiftId,
        notes: row.notes ?? null,
        paymentKind: row.paymentKind,
        paidAmount: row.paidAmount,
        debtAmount: row.debtAmount,
        providerId: row.providerId ?? null,
        providerName: row.providerName ?? null,
        expenseId: row.expenseId ?? null,
        status: row.status ?? 'confirmed',
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        updatedBy: row.updatedBy ?? null,
        updatedAt: row.updatedAt ?? null,
        lines: lines.map(merchLineToFirestore),
        deleted: false,
      }, { merge: true })

      db.update(merchandiseIntakes)
        .set({ syncedAt: now })
        .where(eq(merchandiseIntakes.id, row.id))
        .run()
    } catch (err) {
      log.error('[merchIntakeSync] Error al pushear ingreso', { id: row.id, err })
    }
  }

  log.info('[merchIntakeSync] Ingresos pusheados', { count: pending.length })
}

/**
 * Baja ingresos de un local en un rango ISO (semana o mes). Nunca la colección entera.
 * No pisa filas locales pendientes de push.
 */
export async function pullMerchandiseIntakesForStoreWeek(
  tenantId: string,
  storeId: string,
  startIso: string,
  endIso: string,
): Promise<number> {
  if (!isFirebaseAvailable()) return 0

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const q = query(
    collection(firestore, 'licenses', tenantId, 'merchandiseIntakes'),
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
    if (data['status'] === 'draft') continue
    const paymentKind = coerceMerchIntakePaymentKind(data['paymentKind']) ?? 'none'
    const shiftId = typeof data['shiftId'] === 'string' ? data['shiftId'] : ''
    if (!shiftId) continue
    const id = typeof data['id'] === 'string' ? data['id'] : d.id
    const createdAt = typeof data['createdAt'] === 'string' ? data['createdAt'] : startIso
    const createdBy = typeof data['createdBy'] === 'string' ? data['createdBy'] : ''
    if (!createdBy) continue
    const lines = parseMerchLinesFromUnknown(data['lines'], {
      intakeId: id,
      category: data['category'],
      unit: data['unit'],
      quantity: data['quantity'],
    })
    if (lines.length === 0) continue

    const existing = db.select({
      id: merchandiseIntakes.id,
      syncedAt: merchandiseIntakes.syncedAt,
    }).from(merchandiseIntakes).where(eq(merchandiseIntakes.id, id)).get()
    if (existing && existing.syncedAt === null) continue

    const paidAmount = Number(data['paidAmount'])
    const debtAmount = Number(data['debtAmount'])
    const now = new Date().toISOString()
    const notes = typeof data['notes'] === 'string' ? data['notes'] : null
    const providerId = typeof data['providerId'] === 'string' ? data['providerId'] : null
    const providerName = typeof data['providerName'] === 'string' ? data['providerName'] : null
    const expenseId = typeof data['expenseId'] === 'string' ? data['expenseId'] : null
    const updatedBy = typeof data['updatedBy'] === 'string' ? data['updatedBy'] : null
    const updatedAt = typeof data['updatedAt'] === 'string' ? data['updatedAt'] : null
    const header = {
      storeId,
      shiftId,
      notes,
      paymentKind,
      paidAmount: Number.isFinite(paidAmount) ? Math.max(0, Math.round(paidAmount)) : 0,
      debtAmount: Number.isFinite(debtAmount) ? Math.max(0, Math.round(debtAmount)) : 0,
      providerId,
      providerName,
      expenseId,
      status: 'confirmed' as const,
      createdBy,
      createdAt,
      updatedBy,
      updatedAt,
      syncedAt: now,
    }

    db.transaction(tx => {
      tx.insert(merchandiseIntakes).values({
        id,
        ...header,
      }).onConflictDoUpdate({
        target: merchandiseIntakes.id,
        set: {
          notes: header.notes,
          paymentKind: header.paymentKind,
          paidAmount: header.paidAmount,
          debtAmount: header.debtAmount,
          providerId: header.providerId,
          providerName: header.providerName,
          expenseId: header.expenseId,
          status: header.status,
          updatedBy: header.updatedBy,
          updatedAt: header.updatedAt,
          syncedAt: header.syncedAt,
        },
      }).run()
      replaceIntakeLines(tx, id, lines)
    })
    upserted += 1
  }

  if (upserted > 0) {
    log.info('[merchIntakeSync] Ingresos bajados del rango', { storeId, count: upserted })
  }
  return upserted
}

export async function markMerchandiseIntakesDeletedInFirestore(
  tenantId: string,
  ids: string[],
): Promise<void> {
  if (!isFirebaseAvailable() || ids.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const id of ids) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'merchandiseIntakes', id)
      await updateDoc(ref, { deleted: true, deletedAt: now })
    } catch (err) {
      log.error('[merchIntakeSync] No se pudo marcar ingreso como eliminado', { id, err })
    }
  }
}
