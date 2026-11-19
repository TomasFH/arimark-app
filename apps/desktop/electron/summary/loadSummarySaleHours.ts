/**
 * Ventas confirmadas de los turnos que están en Hoy, cortadas por hora.
 * La PC del local lee SQLite. La otra pide solo esos turnos, de a 30.
 * El día sigue abierto, así que no se guarda: cada vez se vuelve a leer.
 */
import { and, eq, inArray } from 'drizzle-orm'
import {
  summarySoldByHour,
  type SaleHourStamp,
  type SoldHourBucket,
} from '@carniceria/shared'
import { getDb } from '../db/client'
import { sales, shifts } from '../db/schema'
import { shouldSnapshotShiftMoney } from '../db/shiftMoney'
import { isFirebaseAvailable } from '../licensing/firebase'
import { fetchRemoteSaleStamps } from '../licensing/summaryRemote'

export async function loadSummarySaleHours(
  shiftIds: string[],
  ymd: string,
): Promise<SoldHourBucket[]> {
  const db = getDb()
  const seen = new Set<string>()
  const unique = shiftIds.filter(id => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })

  const localIds: string[] = []
  const remoteIds: string[] = []
  for (const id of unique) {
    const row = db.select().from(shifts).where(eq(shifts.id, id)).get()
    if (row && shouldSnapshotShiftMoney(db, row)) localIds.push(id)
    else remoteIds.push(id)
  }

  const stamps: SaleHourStamp[] = []
  if (localIds.length > 0) {
    const rows = db.select({ createdAt: sales.createdAt, total: sales.total })
      .from(sales)
      .where(and(inArray(sales.shiftId, localIds), eq(sales.status, 'confirmed')))
      .all()
    stamps.push(...rows)
  }

  if (remoteIds.length > 0) {
    if (!isFirebaseAvailable()) {
      throw new Error('Sin conexión para leer las ventas del día.')
    }
    stamps.push(...await fetchRemoteSaleStamps(remoteIds))
  }

  return summarySoldByHour(stamps, ymd)
}
