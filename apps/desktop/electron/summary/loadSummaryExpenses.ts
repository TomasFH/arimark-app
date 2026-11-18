/**
 * Detalle de gastos de los turnos que están en pantalla.
 * La PC del local lee SQLite. La otra pide solo esos turnos, de a 30.
 * Una semana cerrada queda guardada. La semana en curso se vuelve a leer.
 */
import { eq } from 'drizzle-orm'
import log from 'electron-log'
import {
  mondayWeekContaining,
  mondayWeekRange,
  type SummaryExpenseInput,
} from '@carniceria/shared'
import { getDb } from '../db/client'
import { shifts, summaryExpenseCache } from '../db/schema'
import { shouldSnapshotShiftMoney } from '../db/shiftMoney'
import { isFirebaseAvailable } from '../licensing/firebase'
import { fetchRemoteExpenseLines } from '../licensing/summaryRemote'
import { readExpenseLines } from './loadAdminSummary'

export interface SummaryExpenseRequest {
  id: string
  storeId: string
  startedAt: string
}

type AppDb = ReturnType<typeof getDb>

function withoutInject(lines: SummaryExpenseInput[]): SummaryExpenseInput[] {
  return lines.filter(line => line.kind !== 'inject')
}

function parseCachedLines(json: string): SummaryExpenseInput[] | null {
  try {
    const value: unknown = JSON.parse(json)
    if (!Array.isArray(value)) return null
    const lines: SummaryExpenseInput[] = []
    for (const item of value) {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      if (typeof row['id'] !== 'string' || typeof row['shiftId'] !== 'string') return null
      if (typeof row['amount'] !== 'number' || !Number.isFinite(row['amount'])) return null
      if (row['kind'] === 'inject') continue
      lines.push({
        id: row['id'],
        shiftId: row['shiftId'],
        createdAt: typeof row['createdAt'] === 'string' ? row['createdAt'] : '',
        concept: typeof row['concept'] === 'string' ? row['concept'] : null,
        providerName: typeof row['providerName'] === 'string' ? row['providerName'] : null,
        amount: row['amount'],
        notes: typeof row['notes'] === 'string' ? row['notes'] : null,
        kind: 'expense',
      })
    }
    return lines
  } catch (err) {
    log.warn('[summary] Caché de gastos ilegible', err)
    return null
  }
}

function readCachedShift(db: AppDb, shiftId: string): SummaryExpenseInput[] | null {
  const row = db.select({ linesJson: summaryExpenseCache.linesJson })
    .from(summaryExpenseCache)
    .where(eq(summaryExpenseCache.shiftId, shiftId))
    .get()
  if (!row) return null
  return parseCachedLines(row.linesJson)
}

function saveClosedShift(
  db: AppDb,
  shift: SummaryExpenseRequest,
  weekStartIso: string,
  lines: SummaryExpenseInput[],
  at: string,
): void {
  db.insert(summaryExpenseCache).values({
    shiftId: shift.id,
    storeId: shift.storeId,
    weekStartIso,
    linesJson: JSON.stringify(lines),
    pulledAt: at,
  }).onConflictDoUpdate({
    target: summaryExpenseCache.shiftId,
    set: {
      storeId: shift.storeId,
      weekStartIso,
      linesJson: JSON.stringify(lines),
      pulledAt: at,
    },
  }).run()
}

export async function loadSummaryExpenses(
  requested: SummaryExpenseRequest[],
  now = new Date(),
): Promise<SummaryExpenseInput[]> {
  const db = getDb()
  const currentWeekStart = mondayWeekRange(0, now).startIso
  const seen = new Set<string>()
  const unique = requested.filter(shift => {
    if (seen.has(shift.id)) return false
    seen.add(shift.id)
    return true
  })

  const localIds: string[] = []
  const remote: SummaryExpenseRequest[] = []
  const cached: SummaryExpenseInput[] = []

  for (const shift of unique) {
    const row = db.select().from(shifts).where(eq(shifts.id, shift.id)).get()
    if (row && shouldSnapshotShiftMoney(db, row)) {
      localIds.push(shift.id)
      continue
    }
    const week = mondayWeekContaining(shift.startedAt)
    if (week.startIso < currentWeekStart) {
      const hit = readCachedShift(db, shift.id)
      if (hit) {
        cached.push(...hit)
        continue
      }
    }
    remote.push(shift)
  }

  const localLines = withoutInject(readExpenseLines(db, localIds))
  if (remote.length === 0 || !isFirebaseAvailable()) return [...localLines, ...cached]

  let fetched: SummaryExpenseInput[]
  try {
    fetched = await fetchRemoteExpenseLines(remote.map(shift => shift.id))
  } catch (err) {
    log.error('[summary] No se pudieron leer los gastos de los turnos en pantalla', err)
    throw err
  }

  const byShift = new Map<string, SummaryExpenseInput[]>()
  for (const shift of remote) byShift.set(shift.id, [])
  for (const line of fetched) {
    const list = byShift.get(line.shiftId)
    if (!list) continue
    list.push(line)
  }

  const at = now.toISOString()
  const remoteLines: SummaryExpenseInput[] = []
  for (const shift of remote) {
    const lines = byShift.get(shift.id) ?? []
    remoteLines.push(...lines)
    const week = mondayWeekContaining(shift.startedAt)
    if (week.startIso < currentWeekStart) saveClosedShift(db, shift, week.startIso, lines, at)
  }

  return [...localLines, ...cached, ...remoteLines]
}
