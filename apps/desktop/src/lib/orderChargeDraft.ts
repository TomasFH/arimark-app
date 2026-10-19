/**
 * Borrador del cobro de un pedido.
 *
 * Vive en un Map del módulo, una entrada por id de pedido. Sobrevive al
 * cierre del modal y al desmonte de Pedidos (volver al POS). No se escribe
 * en SQLite, localStorage ni sessionStorage. Cerrar la aplicación lo pierde.
 * Ir al POS no lo borra. Se borra cuando esa venta queda confirmada. Otro pedido no lo ve.
 */
import type { OrderChargeLine } from './orderTicketMatch'

const drafts = new Map<string, OrderChargeLine[]>()

function cloneLines(lines: readonly OrderChargeLine[]): OrderChargeLine[] {
  return lines.map(line => ({ ...line }))
}

/** Reemplaza el borrador de ese pedido. Una copia: el caller puede seguir editando. */
export function saveOrderChargeDraft(orderId: string, lines: readonly OrderChargeLine[]): void {
  drafts.set(orderId, cloneLines(lines))
}

/** Copia del borrador, o null si ese pedido nunca se guardó. */
export function loadOrderChargeDraft(orderId: string): OrderChargeLine[] | null {
  const saved = drafts.get(orderId)
  if (!saved) return null
  return cloneLines(saved)
}

/** Cuando la venta de ese pedido quedó hecha. Los demás pedidos quedan como estaban. */
export function clearOrderChargeDraft(orderId: string): void {
  drafts.delete(orderId)
}

/** Cierre de sesión. El proceso que se cierra también lo pierde, sin llamar esto. */
export function resetOrderChargeDrafts(): void {
  drafts.clear()
}
