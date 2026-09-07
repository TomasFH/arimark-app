import type { OrderRow, OrderStatus } from '../types/hw-api'
import {
  LIST_SLOT_ORDER,
  effectiveListSlot,
  hoursForDate,
  isPickupDueSoon,
  type StoreHoursSource,
} from '@carniceria/shared'

const STATUS_ORDER: Record<OrderStatus, number> = {
  pending: 0,
  ready: 1,
  delivered: 2,
  cancelled: 3,
}

export interface OrderSortContext {
  todayYmd: string
  nowMinutes: number
  hoursByStore: ReadonlyMap<string, StoreHoursSource>
}

function hoursFor(order: OrderRow, ctx?: OrderSortContext): StoreHoursSource | null {
  const source = ctx?.hoursByStore.get(order.storeId) ?? null
  if (!source) return null
  return hoursForDate(source, order.pickupDate)
}

function dueSoon(order: OrderRow, ctx?: OrderSortContext): boolean {
  if (!ctx) return false
  return isPickupDueSoon({
    pickupDate: order.pickupDate,
    pickupTime: order.pickupTime,
    todayYmd: ctx.todayYmd,
    nowMinutes: ctx.nowMinutes,
  })
}

/** Más próximo a entregar primero. El estado no pisa la fecha de retiro. */
export function compareOrdersByPickup(a: OrderRow, b: OrderRow, ctx?: OrderSortContext): number {
  if (a.pickupDate !== b.pickupDate) return a.pickupDate.localeCompare(b.pickupDate)
  const aDue = dueSoon(a, ctx)
  const bDue = dueSoon(b, ctx)
  if (aDue !== bDue) return aDue ? -1 : 1
  const aSlot = LIST_SLOT_ORDER[effectiveListSlot(a, hoursFor(a, ctx))]
  const bSlot = LIST_SLOT_ORDER[effectiveListSlot(b, hoursFor(b, ctx))]
  if (aSlot !== bSlot) return aSlot - bSlot
  if (a.pickupTime && b.pickupTime) {
    const byTime = a.pickupTime.localeCompare(b.pickupTime)
    if (byTime !== 0) return byTime
  } else if (a.pickupTime) return -1
  else if (b.pickupTime) return 1
  if (a.priority !== b.priority) return a.priority ? -1 : 1
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
}
