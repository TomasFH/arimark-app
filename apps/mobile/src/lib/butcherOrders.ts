/**
 * Pedidos del carnicero: consulta + actualización de estado.
 *
 * - Pendientes: trabajo del día.
 * - Listos: auditoría; se puede volver a Pendiente (misma regla que PC).
 * - Entregados: solo lectura, acotados por fecha de retiro (no se baja el historial entero).
 * - "Listo" / deshacer requieren conexión.
 * - El carnicero no puede crear, editar ni cobrar pedidos.
 */
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import { addDaysYmd, formatYmd } from './week'
import {
  parseTimeSlot,
  parseOrderPriority,
  parseDepositPayments,
  type OrderTimeSlot,
  type DepositPayment,
} from './orderMapping'
import {
  effectiveListSlot,
  hoursForDate,
  isPickupDueSoon,
  type StoreHoursSource,
  type ListTimeSlot,
} from '@carniceria/shared'

const firestore = getFirestore(firebaseApp)

/** Entregados: ventana civil de retiro. Más atrás no se consulta (Spark). */
export const DELIVERED_LOOKBACK_DAYS = 7

export type ButcherOrderStatus = 'pending' | 'ready' | 'delivered'

export interface ButcherOrder {
  id: string
  storeId: string
  customerName: string
  phone: string | null
  /** Texto libre con descripción del pedido (compat. con pedidos sin carrito). */
  items: string
  pickupDate: string
  timeSlot: OrderTimeSlot | null
  pickupTime: string | null
  priority: boolean
  status: ButcherOrderStatus
  depositAmount: number
  depositPayments: DepositPayment[] | null
  notes: string | null
  createdAt: string
  createdBy: string
  readyAt: string | null
  readyByName: string | null
  updatedAt: string | null
  /** Cuándo se cobró/entregó. Si el doc no lo trae, se usa updatedAt. */
  deliveredAt: string | null
  deliveredByName: string | null
  /** Líneas de presupuesto (Track B). Null si el pedido es texto libre. */
  budgetItems: BudgetLine[] | null
}

export interface BudgetLine {
  productId: string
  name: string
  unit: 'kg' | 'unit'
  pluNumber?: number | null
  estimatedQty: number
  unitPrice: number
  requestedUnits?: number | null
}

export function deliveredPickupFrom(todayYmd: string): string {
  return addDaysYmd(todayYmd, -DELIVERED_LOOKBACK_DAYS)
}

/**
 * Encabezado de día. En historial (entregados) no se dice "Atrasado":
 * un pedido cobrado a tiempo no está atrasado porque hoy sea otro día.
 */
export function formatPickupDayHeading(
  ymd: string,
  todayYmd: string,
  kind: 'work' | 'history',
): string {
  const a = new Date(`${ymd}T12:00:00Z`)
  const b = new Date(`${todayYmd}T12:00:00Z`)
  const diff = Math.round((a.getTime() - b.getTime()) / 86400000)
  if (diff === 0) return `Hoy · ${formatYmd(ymd)}`
  if (diff === -1) return `Ayer · ${formatYmd(ymd)}`
  if (diff === 1) return `Mañana · ${formatYmd(ymd)}`
  if (diff < 0 && kind === 'work') return `Atrasado · ${formatYmd(ymd)}`
  return formatYmd(ymd)
}

export function formatPickupDayChip(ymd: string, todayYmd: string): string | null {
  if (ymd === todayYmd) return null
  const a = new Date(`${ymd}T12:00:00Z`)
  const b = new Date(`${todayYmd}T12:00:00Z`)
  const diff = Math.round((a.getTime() - b.getTime()) / 86400000)
  if (diff === 1) return 'Retiro: mañana'
  if (diff === -1) return 'Retiro: ayer'
  return `Retiro: ${formatYmd(ymd)}`
}

function parseBudgetItems(raw: unknown): BudgetLine[] | null {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw
    if (Array.isArray(parsed)) return parsed as BudgetLine[]
  } catch {
    // silently ignore malformed budgetItems
  }
  return null
}

function parseOrder(
  id: string,
  data: Record<string, unknown>,
  allowed: ReadonlySet<ButcherOrderStatus>,
): ButcherOrder | null {
  const status = data['status']
  if (status !== 'pending' && status !== 'ready' && status !== 'delivered') return null
  if (!allowed.has(status)) return null
  if (data['deleted'] === true) return null

  return {
    id,
    storeId: typeof data['storeId'] === 'string' ? data['storeId'] : '',
    customerName: typeof data['customerName'] === 'string' ? data['customerName'] : '',
    phone: typeof data['phone'] === 'string' ? data['phone'] : null,
    items: typeof data['items'] === 'string' ? data['items'] : '',
    pickupDate: typeof data['pickupDate'] === 'string' ? data['pickupDate'] : '',
    timeSlot: parseTimeSlot(data['timeSlot']),
    pickupTime: typeof data['pickupTime'] === 'string' ? data['pickupTime'] : null,
    priority: parseOrderPriority(data['priority']),
    status,
    depositAmount: typeof data['depositAmount'] === 'number' ? data['depositAmount'] : 0,
    depositPayments: parseDepositPayments(data['depositPayments']),
    notes: typeof data['notes'] === 'string' ? data['notes'] : null,
    createdAt: typeof data['createdAt'] === 'string' ? data['createdAt'] : '',
    createdBy: typeof data['createdBy'] === 'string' ? data['createdBy'] : '',
    readyAt: typeof data['readyAt'] === 'string' ? data['readyAt'] : null,
    readyByName: typeof data['readyByName'] === 'string' ? data['readyByName'] : null,
    updatedAt: typeof data['updatedAt'] === 'string' ? data['updatedAt'] : null,
    deliveredAt: typeof data['deliveredAt'] === 'string'
      ? data['deliveredAt']
      : status === 'delivered' && typeof data['updatedAt'] === 'string'
        ? data['updatedAt']
        : null,
    deliveredByName: typeof data['deliveredByName'] === 'string' ? data['deliveredByName'] : null,
    budgetItems: parseBudgetItems(data['budgetItems']),
  }
}

function subscribeByStatus(
  storeId: string,
  status: ButcherOrderStatus,
  onData: (orders: ButcherOrder[]) => void,
  onError: (message: string) => void,
  pickupDateFrom?: string,
): Unsubscribe {
  const col = collection(firestore, 'licenses', LICENSE_KEY, 'orders')
  const constraints = [
    where('storeId', '==', storeId),
    where('status', '==', status),
  ]
  if (pickupDateFrom) constraints.push(where('pickupDate', '>=', pickupDateFrom))
  const q = query(col, ...constraints)
  const allowed = new Set<ButcherOrderStatus>([status])
  return onSnapshot(
    q,
    snap => {
      const list: ButcherOrder[] = []
      for (const d of snap.docs) {
        const parsed = parseOrder(d.id, d.data() as Record<string, unknown>, allowed)
        if (parsed) list.push(parsed)
      }
      onData(list)
    },
    err => {
      onError(err.message || 'No se pudieron cargar los pedidos.')
    },
  )
}

/** Pedidos pendientes del local. */
export function subscribeButcherOrders(
  storeId: string,
  onData: (orders: ButcherOrder[]) => void,
  onError: (message: string) => void,
): Unsubscribe {
  return subscribeByStatus(storeId, 'pending', onData, onError)
}

/** Pedidos listos del local (set de trabajo, no historial). */
export function subscribeButcherReadyOrders(
  storeId: string,
  onData: (orders: ButcherOrder[]) => void,
  onError: (message: string) => void,
): Unsubscribe {
  return subscribeByStatus(storeId, 'ready', onData, onError)
}

/** Entregados del local con retiro desde `pickupDateFrom` (inclusive). */
export function subscribeButcherDeliveredOrders(
  storeId: string,
  pickupDateFrom: string,
  onData: (orders: ButcherOrder[]) => void,
  onError: (message: string) => void,
): Unsubscribe {
  return subscribeByStatus(storeId, 'delivered', onData, onError, pickupDateFrom)
}

/**
 * Marca un pedido como "Listo" en Firestore.
 * Solo se llama cuando navigator.onLine === true.
 */
export async function markOrderReady(
  orderId: string,
  butcherUid: string,
  butcherName: string,
): Promise<void> {
  const now = new Date().toISOString()
  const ref = doc(firestore, 'licenses', LICENSE_KEY, 'orders', orderId)
  await updateDoc(ref, {
    status: 'ready',
    readyAt: now,
    readyBy: butcherUid,
    readyByName: butcherName,
    updatedAt: now,
    updatedBy: butcherUid,
    syncedAt: null,
  })
}

/** Revierte Listo → Pendiente (mismo efecto que Deshacer en PC). */
export async function unmarkOrderReady(
  orderId: string,
  butcherUid: string,
): Promise<void> {
  const now = new Date().toISOString()
  const ref = doc(firestore, 'licenses', LICENSE_KEY, 'orders', orderId)
  await updateDoc(ref, {
    status: 'pending',
    readyAt: null,
    readyBy: null,
    readyByName: null,
    updatedAt: now,
    updatedBy: butcherUid,
    syncedAt: null,
  })
}

// ---------------------------------------------------------------------------
// Agrupación por día y turno para la UI
// ---------------------------------------------------------------------------

export type TimeGroup = ListTimeSlot

export interface DayGroup {
  date: string
  /** YYYY-MM-DD */
  groups: TimeGroupEntry[]
}

export interface TimeGroupEntry {
  slot: TimeGroup
  orders: ButcherOrder[]
}

const SLOT_ORDER: TimeGroup[] = ['dueSoon', 'morning', 'afternoon', 'specific', 'noSlot']

export interface GroupOrdersOptions {
  hours?: StoreHoursSource | null
  nowMinutes?: number
  pinDueSoon?: boolean
}

function compareButcherOrders(a: ButcherOrder, b: ButcherOrder): number {
  if (a.pickupTime && b.pickupTime) {
    const byTime = a.pickupTime.localeCompare(b.pickupTime)
    if (byTime !== 0) return byTime
  } else if (a.pickupTime) return -1
  else if (b.pickupTime) return 1
  if (a.priority !== b.priority) return a.priority ? -1 : 1
  return a.createdAt.localeCompare(b.createdAt)
}

/**
 * Agrupa pedidos por día (pickupDate) y dentro de cada día por turno.
 * Un horario específico cae en mañana o tarde según las franjas del local.
 * Si pinDueSoon, los que faltan ≤1 h van en "Retiro próximo" arriba del día.
 */
export function groupOrdersByDayAndShift(
  orders: ButcherOrder[],
  todayYmd: string,
  opts?: GroupOrdersOptions,
): DayGroup[] {
  const byDate = new Map<string, Map<TimeGroup, ButcherOrder[]>>()

  for (const order of orders) {
    const date = order.pickupDate
    if (!byDate.has(date)) byDate.set(date, new Map())
    const bySlot = byDate.get(date)!

    const dueSoon = Boolean(
      opts?.pinDueSoon
      && opts.nowMinutes != null
      && isPickupDueSoon({
        pickupDate: order.pickupDate,
        pickupTime: order.pickupTime,
        todayYmd,
        nowMinutes: opts.nowMinutes,
      }),
    )
    const slotHours = opts?.hours
      ? hoursForDate(opts.hours, order.pickupDate)
      : null
    const slotKey: TimeGroup = dueSoon
      ? 'dueSoon'
      : effectiveListSlot(order, slotHours)

    const list = bySlot.get(slotKey) ?? []
    list.push(order)
    bySlot.set(slotKey, list)
  }

  const sortedDates = [...byDate.keys()].sort((a, b) => {
    const pastA = a <= todayYmd
    const pastB = b <= todayYmd
    if (pastA && !pastB) return -1
    if (!pastA && pastB) return 1
    if (pastA && pastB) return b.localeCompare(a)
    return a.localeCompare(b)
  })

  return sortedDates.map(date => {
    const bySlot = byDate.get(date)!
    const groups: TimeGroupEntry[] = SLOT_ORDER
      .filter(s => bySlot.has(s))
      .map(s => ({
        slot: s,
        orders: (bySlot.get(s) ?? []).sort(compareButcherOrders),
      }))
    return { date, groups }
  })
}
