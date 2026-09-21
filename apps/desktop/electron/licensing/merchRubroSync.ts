/**
 * Rubros de mercadería (colección chica y estable de toda la licencia).
 * getDocs / onSnapshot están permitidos: no crece todos los días.
 *
 * Path: licenses/{tenantId}/merchandiseIntakeRubros/{id}
 */
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import log from 'electron-log'
import { eq, isNull } from 'drizzle-orm'
import { getDb } from '../db/client'
import { merchandiseIntakeRubros } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { ensureFactoryMerchRubros } from './merchIntakeDb'
import {
  coerceMerchIntakeTemplate,
  MERCH_INTAKE_NAME_MAX,
} from '@carniceria/shared'

const rubroListeners: Unsubscribe[] = []

interface RemoteRubroDoc {
  id?: string
  name?: string
  template?: string
  packContents?: number | null
  packTareKg?: number | null
  packLabel?: string | null
  sortOrder?: number
  archivedAt?: string | null
  deleted?: boolean
  createdAt?: string
  createdBy?: string | null
  updatedAt?: string | null
  updatedBy?: string | null
}

function upsertRubroFromRemote(data: RemoteRubroDoc, docId: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  const id = (data.id || docId).trim()
  const name = typeof data.name === 'string' ? data.name.trim().slice(0, MERCH_INTAKE_NAME_MAX) : ''
  const template = coerceMerchIntakeTemplate(data.template)
  if (!id || !name || !template) return

  const existing = db.select({
    id: merchandiseIntakeRubros.id,
    syncedAt: merchandiseIntakeRubros.syncedAt,
  }).from(merchandiseIntakeRubros).where(eq(merchandiseIntakeRubros.id, id)).get()
  if (existing && existing.syncedAt === null) return

  const packContents = typeof data.packContents === 'number' && Number.isInteger(data.packContents) && data.packContents > 0
    ? data.packContents
    : null
  const packTareKg = typeof data.packTareKg === 'number' && Number.isFinite(data.packTareKg) && data.packTareKg >= 0
    ? data.packTareKg
    : null
  const packLabel = typeof data.packLabel === 'string' && data.packLabel.trim()
    ? data.packLabel.trim().slice(0, 40)
    : null
  const sortOrder = typeof data.sortOrder === 'number' && Number.isFinite(data.sortOrder)
    ? Math.round(data.sortOrder)
    : 200
  const archivedAt = data.deleted === true
    ? (typeof data.archivedAt === 'string' ? data.archivedAt : now)
    : (typeof data.archivedAt === 'string' ? data.archivedAt : null)
  const createdAt = typeof data.createdAt === 'string' ? data.createdAt : now
  const createdBy = typeof data.createdBy === 'string' ? data.createdBy : null
  const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : null
  const updatedBy = typeof data.updatedBy === 'string' ? data.updatedBy : null

  db.insert(merchandiseIntakeRubros).values({
    id,
    name,
    template,
    packContents,
    packTareKg,
    packLabel,
    sortOrder,
    archivedAt,
    createdAt,
    createdBy,
    updatedAt,
    updatedBy,
    syncedAt: now,
  }).onConflictDoUpdate({
    target: merchandiseIntakeRubros.id,
    set: {
      name,
      template,
      packContents,
      packTareKg,
      packLabel,
      sortOrder,
      archivedAt,
      updatedAt,
      updatedBy,
      syncedAt: now,
    },
  }).run()
}

export async function pushUnsyncedMerchandiseIntakeRubros(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  ensureFactoryMerchRubros(db)
  const pending = db.select().from(merchandiseIntakeRubros).where(isNull(merchandiseIntakeRubros.syncedAt)).all()
  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const row of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'merchandiseIntakeRubros', row.id)
      await setDoc(ref, {
        id: row.id,
        name: row.name,
        template: row.template,
        packContents: row.packContents ?? null,
        packTareKg: row.packTareKg ?? null,
        packLabel: row.packLabel ?? null,
        sortOrder: row.sortOrder,
        archivedAt: row.archivedAt ?? null,
        createdAt: row.createdAt,
        createdBy: row.createdBy ?? null,
        updatedAt: row.updatedAt ?? null,
        updatedBy: row.updatedBy ?? null,
        deleted: false,
      }, { merge: true })

      db.update(merchandiseIntakeRubros)
        .set({ syncedAt: now })
        .where(eq(merchandiseIntakeRubros.id, row.id))
        .run()
    } catch (err) {
      log.error('[merchRubroSync] Error al pushear rubro', { id: row.id, err })
    }
  }

  log.info('[merchRubroSync] Rubros pusheados', { count: pending.length })
}

export async function pullMerchandiseIntakeRubros(tenantId: string): Promise<number> {
  if (!isFirebaseAvailable()) return 0

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const snap = await getDocs(collection(firestore, 'licenses', tenantId, 'merchandiseIntakeRubros'))
  ensureFactoryMerchRubros()
  let upserted = 0
  for (const d of snap.docs) {
    try {
      upsertRubroFromRemote(d.data() as RemoteRubroDoc, d.id)
      upserted += 1
    } catch (err) {
      log.error('[merchRubroSync] Error al upsertear rubro en pull', { id: d.id, err })
    }
  }
  if (upserted > 0) {
    log.info('[merchRubroSync] Rubros bajados', { count: upserted })
  }
  return upserted
}

export function startMerchRubroSyncListener(tenantId: string): void {
  if (!isFirebaseAvailable()) return
  if (rubroListeners.length > 0) return

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const col = collection(firestore, 'licenses', tenantId, 'merchandiseIntakeRubros')
    const unsub = onSnapshot(col, snapshot => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'removed') continue
        try {
          upsertRubroFromRemote(change.doc.data() as RemoteRubroDoc, change.doc.id)
        } catch (err) {
          log.error('[merchRubroSync] Error al upsertear rubro desde snapshot', {
            id: change.doc.id,
            err,
          })
        }
      }
    }, err => {
      log.error('[merchRubroSync] Error en listener de rubros', err)
    })
    rubroListeners.push(unsub)
    log.info('[merchRubroSync] Listener de rubros iniciado')
  } catch (err) {
    log.error('[merchRubroSync] No se pudo iniciar el listener de rubros', err)
  }
}

export function stopMerchRubroSyncListener(): void {
  for (const unsub of rubroListeners) {
    try {
      unsub()
    } catch (err) {
      log.warn('[merchRubroSync] Error al detener listener', err)
    }
  }
  rubroListeners.length = 0
}

export async function ensureMerchRubrosSynced(tenantId: string): Promise<void> {
  ensureFactoryMerchRubros()
  await pushUnsyncedMerchandiseIntakeRubros(tenantId)
  await pullMerchandiseIntakeRubros(tenantId)
  startMerchRubroSyncListener(tenantId)
}
