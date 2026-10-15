import type { HistoryShiftDetail } from '../types/hw-api'

/**
 * Detalle de turnos ya bajados en esta sesión.
 * Un turno cerrado no cambia: volver a abrirlo no vuelve a consultar.
 * Un turno abierto no se guarda, porque todavía puede sumar ventas.
 */
const closedShiftDetails = new Map<string, HistoryShiftDetail>()

export function getCachedHistoryDetail(shiftId: string): HistoryShiftDetail | null {
  return closedShiftDetails.get(shiftId) ?? null
}

export function rememberHistoryDetail(detail: HistoryShiftDetail): void {
  if (!detail.shift.closedAt) return
  closedShiftDetails.set(detail.shift.id, detail)
}

export function clearHistoryDetailCache(): void {
  closedShiftDetails.clear()
}
