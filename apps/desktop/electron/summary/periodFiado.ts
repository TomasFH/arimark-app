/**
 * Fiado del período, pedido con el botón. No baja el libro entero.
 * Una semana ya cerrada queda en memoria de esta sesión.
 */
import { collection, getDocs, getFirestore, limit, orderBy, query, where } from 'firebase/firestore'
import log from 'electron-log'
import {
  PERIOD_FIADO_LIMIT,
  periodFiadoAccount,
  type PeriodFiadoAccount,
} from '@carniceria/shared'
import { getBusinessConfig } from '../businessConfig'
import { getFirebaseApp, isFirebaseAvailable } from '../licensing/firebase'

interface PeriodFiadoEvent {
  eventType: string
  amount: number
  createdAt: string
  shiftId: string | null
}

const cache = new Map<string, PeriodFiadoAccount>()

function cacheKey(storeId: string, startIso: string, endIso: string): string {
  return `${storeId}\0${startIso}\0${endIso}`
}

function periodIsClosed(endIso: string, now: Date): boolean {
  const end = Date.parse(endIso)
  return Number.isFinite(end) && now.getTime() >= end
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function clearPeriodFiadoCache(): void {
  cache.clear()
}

async function readPeriodFiadoEvents(
  storeId: string,
  startIso: string,
  endIso: string,
): Promise<PeriodFiadoEvent[]> {
  const firestore = getFirestore(getFirebaseApp())
  const tenant = getBusinessConfig().tenant_id
  const snap = await getDocs(query(
    collection(firestore, 'licenses', tenant, 'customerDebtEvents'),
    where('storeId', '==', storeId),
    where('createdAt', '>=', startIso),
    where('createdAt', '<', endIso),
    orderBy('createdAt', 'asc'),
    limit(PERIOD_FIADO_LIMIT),
  ))
  return snap.docs.map(docSnap => {
    const data = docSnap.data() as Record<string, unknown>
    const shiftId = data['shiftId']
    return {
      eventType: text(data['eventType']),
      amount: typeof data['amount'] === 'number' && Number.isFinite(data['amount']) ? data['amount'] : 0,
      createdAt: text(data['createdAt']),
      shiftId: typeof shiftId === 'string' && shiftId ? shiftId : null,
    }
  })
}

/**
 * Lee el período de un local, o devuelve la copia de sesión si esa semana ya cerró.
 * El rango abierto se vuelve a pedir: todavía pueden aparecer cobros.
 */
export async function loadPeriodFiado(input: {
  storeId: string
  startIso: string
  endIso: string
  now?: Date
}): Promise<PeriodFiadoAccount> {
  if (!isFirebaseAvailable()) {
    throw new Error('FIREBASE_OFF')
  }
  const now = input.now ?? new Date()
  const key = cacheKey(input.storeId, input.startIso, input.endIso)
  const closed = periodIsClosed(input.endIso, now)
  if (closed) {
    const saved = cache.get(key)
    if (saved) return saved
  }
  let events: PeriodFiadoEvent[]
  try {
    events = await readPeriodFiadoEvents(input.storeId, input.startIso, input.endIso)
  } catch (err) {
    log.error('[periodFiado] No se pudo leer el período', { storeId: input.storeId, err })
    throw err
  }
  const account = periodFiadoAccount(events, input.startIso, input.endIso)
  if (closed) cache.set(key, account)
  return account
}
