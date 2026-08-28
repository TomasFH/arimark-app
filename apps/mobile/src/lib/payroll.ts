/**
 * Liquidación semanal (solo consulta): sueldo − vales lun–dom.
 * Puro / testeable; la suscripción a Firestore vive en adminPayroll.ts.
 */
import { valeInLocalWeek } from './week'

export interface PayrollEmployee {
  id: string
  name: string
  weeklyWage: number
  archivedAt: string | null
  deleted: boolean
}

export interface PayrollVale {
  id: string
  employeeId: string
  amount: number
  description: string | null
  paidAt: string
  deleted?: boolean
  cancelledAt?: string | null
}

export interface PayrollRow {
  employee: PayrollEmployee
  weeklyWage: number
  totalVales: number
  netToPay: number
  vales: PayrollVale[]
  payment: PayrollPayment | null
}

export interface PayrollPayment {
  id: string
  employeeId: string
  amount: number
  valesDeducted: number
  netPaid: number
  notes: string | null
  paidAt: string
  valesSnapshot: PayrollVale[] | null
}

export function buildWeeklyPayroll(
  employees: PayrollEmployee[],
  vales: PayrollVale[],
  weekStart: string,
  weekEnd: string,
): PayrollRow[] {
  const eligible = employees.filter(
    e => !e.deleted && !e.archivedAt && e.weeklyWage > 0,
  )

  const valesByEmployee = new Map<string, PayrollVale[]>()
  for (const v of vales) {
    if (v.deleted === true || v.cancelledAt) continue
    if (!valeInLocalWeek(v.paidAt, weekStart, weekEnd)) continue
    const list = valesByEmployee.get(v.employeeId) ?? []
    list.push(v)
    valesByEmployee.set(v.employeeId, list)
  }

  return eligible.map(employee => {
    const empVales = (valesByEmployee.get(employee.id) ?? [])
      .slice()
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
    const totalVales = empVales.reduce((s, v) => s + v.amount, 0)
    return {
      employee,
      weeklyWage: employee.weeklyWage,
      totalVales,
      netToPay: Math.max(0, employee.weeklyWage - totalVales),
      vales: empVales,
      payment: null,
    }
  })
}

export function mergePayrollWithPayments(
  rows: PayrollRow[],
  payments: PayrollPayment[],
  employees: PayrollEmployee[],
): PayrollRow[] {
  const byEmp = new Map(payments.map(p => [p.employeeId, p]))
  const merged = rows.map(row => {
    const p = byEmp.get(row.employee.id)
    if (!p) return row
    const snap = p.valesSnapshot && p.valesSnapshot.length > 0 ? p.valesSnapshot : row.vales
    return {
      ...row,
      weeklyWage: p.amount,
      totalVales: p.valesDeducted,
      netToPay: p.netPaid,
      vales: snap,
      payment: p,
    }
  })

  const seen = new Set(merged.map(r => r.employee.id))
  for (const p of payments) {
    if (seen.has(p.employeeId)) continue
    const employee = employees.find(e => e.id === p.employeeId)
    if (!employee) continue
    merged.push({
      employee,
      weeklyWage: p.amount,
      totalVales: p.valesDeducted,
      netToPay: p.netPaid,
      vales: p.valesSnapshot ?? [],
      payment: p,
    })
  }
  return merged
}
