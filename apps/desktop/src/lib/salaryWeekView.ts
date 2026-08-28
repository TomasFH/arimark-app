/**
 * Armado de la vista de liquidación (semana civil, snapshot, merge local/remoto).
 * El pago en sí lo valida el handler IPC; acá solo se decide qué mostrar y si la UI ofrece Pagar.
 */
import type { SalaryPaymentRow, SalaryValeSnapshotItem } from '../types/hw-api'
import { utcToLocalYmd } from './datetime'

export interface SalaryValeLine {
  id: string
  amount: number
  description: string | null
  paidAt: string
  storeId: string | null
}

export function valeInLocalWeek(paidAt: string, weekStart: string, weekEnd: string): boolean {
  const ymd = utcToLocalYmd(paidAt)
  return ymd !== '' && ymd >= weekStart && ymd <= weekEnd
}

export function snapshotToValeLines(items: SalaryValeSnapshotItem[] | null): SalaryValeLine[] {
  if (!items) return []
  return items.map(v => ({
    id: v.id,
    amount: v.amount,
    description: v.description,
    paidAt: v.paidAt,
    storeId: null,
  }))
}

/** Local pisa remoto si el mismo empleado tiene pago en los dos. */
export function mergeSalaryPayments(
  local: SalaryPaymentRow[],
  remote: SalaryPaymentRow[],
): Map<string, SalaryPaymentRow> {
  const byEmp = new Map<string, SalaryPaymentRow>()
  for (const p of remote) byEmp.set(p.employeeId, p)
  for (const p of local) byEmp.set(p.employeeId, p)
  return byEmp
}

export function canPayCurrentSalaryWeek(
  weekStart: string,
  currentWeekStart: string,
  hasOpenShift: boolean,
): boolean {
  return hasOpenShift && weekStart === currentWeekStart
}
