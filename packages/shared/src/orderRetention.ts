/** Días después del retiro en que un pendiente o listo se descarta. */
export const STALE_OPEN_ORDER_DAYS = 7

function calendarDaysBefore(yyyyMmDd: string, days: number): string {
  const d = new Date(`${yyyyMmDd}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * Pendiente o listo cuyo retiro ya quedó atrás más de una semana.
 * Un pedido cargado hoy para fin de mes no entra: el reloj es el día de retiro.
 */
export function isStaleOpenOrder(pickupDate: string, status: string, todayYmd: string): boolean {
  if (status !== 'pending' && status !== 'ready') return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate) || !/^\d{4}-\d{2}-\d{2}$/.test(todayYmd)) return false
  return pickupDate < calendarDaysBefore(todayYmd, STALE_OPEN_ORDER_DAYS)
}
