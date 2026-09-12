/**
 * Cebo del turno: Dexie + Firestore acotado por shiftId (nunca la colección entera).
 */
import {
  collection,
  getDocs,
  getFirestore,
  query,
  where,
} from 'firebase/firestore'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import { mondayWeekRange } from '@carniceria/shared'
import { isOnline } from './connectivity'
import { db } from './db'
import type { LocalCebo, SyncStatus } from '../types/pos'

const firestore = getFirestore(firebaseApp)
const NOTES_MAX = 300

export { NOTES_MAX as CEBO_NOTES_MAX }

function parseRemote(data: Record<string, unknown>, fallbackId: string): LocalCebo | null {
  const kg = Number(data['quantityKg'])
  if (!Number.isFinite(kg) || kg <= 0) return null
  const shiftId = typeof data['shiftId'] === 'string' ? data['shiftId'] : ''
  const storeId = typeof data['storeId'] === 'string' ? data['storeId'] : ''
  if (!shiftId || !storeId) return null
  return {
    id: typeof data['id'] === 'string' ? data['id'] : fallbackId,
    shiftId,
    storeId,
    quantityKg: kg,
    notes: typeof data['notes'] === 'string' ? data['notes'] : null,
    createdAt: typeof data['createdAt'] === 'string' ? data['createdAt'] : new Date().toISOString(),
    createdBy: typeof data['createdBy'] === 'string' ? data['createdBy'] : '',
    createdByName: typeof data['createdByName'] === 'string' ? data['createdByName'] : '',
    updatedAt: typeof data['updatedAt'] === 'string' ? data['updatedAt'] : null,
    updatedBy: typeof data['updatedBy'] === 'string' ? data['updatedBy'] : null,
    updatedByName: typeof data['updatedByName'] === 'string' ? data['updatedByName'] : null,
    syncStatus: 'synced',
    syncedAt: typeof data['syncedAt'] === 'string' ? data['syncedAt'] : new Date().toISOString(),
  }
}

export function canEditCebo(role: 'admin' | 'cashier', userId: string, createdBy: string): boolean {
  return role === 'admin' || createdBy === userId
}

export async function listWeekCebo(storeId: string, weekOffset = 0): Promise<LocalCebo[]> {
  const bounds = mondayWeekRange(weekOffset)
  const local = await db.ceboEntries.where('storeId').equals(storeId).toArray()
  const inWeek = local.filter(r => r.createdAt >= bounds.startIso && r.createdAt < bounds.endIso)
  const byId = new Map(inWeek.map(r => [r.id, r]))

  if (inWeek.length === 0 && await isOnline()) {
    try {
      const q = query(
        collection(firestore, 'licenses', LICENSE_KEY, 'ceboEntries'),
        where('storeId', '==', storeId),
        where('createdAt', '>=', bounds.startIso),
        where('createdAt', '<', bounds.endIso),
      )
      const snap = await getDocs(q)
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>
        if (data['deleted'] === true) continue
        const parsed = parseRemote(data, d.id)
        if (!parsed) continue
        const existing = await db.ceboEntries.get(parsed.id)
        if (existing && (existing.syncStatus === 'pending' || existing.syncStatus === 'error')) continue
        byId.set(parsed.id, parsed)
        await db.ceboEntries.put(parsed)
      }
    } catch {
      /* offline / reglas / índice pendiente */
    }
  }

  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function listShiftCebo(shiftId: string): Promise<LocalCebo[]> {
  const local = await db.ceboEntries.where('shiftId').equals(shiftId).toArray()
  const storeId = local[0]?.storeId
  if (storeId) return listWeekCebo(storeId, 0)
  return local.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function upsertLocalCebo(row: LocalCebo): Promise<void> {
  const notes = row.notes?.trim() ? row.notes.trim().slice(0, NOTES_MAX) : null
  await db.ceboEntries.put({ ...row, notes, syncStatus: 'pending' as SyncStatus, syncedAt: null })
}
