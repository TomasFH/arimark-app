/**
 * Liquidación semanal en el POS móvil (semana en curso, turno abierto).
 */
import { useEffect, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useBackLayer } from '../lib/backStack'
import { useKeyboardInset } from '../lib/keyboardInset'
import { formatMoney } from '../lib/adminFirestore'
import { db } from '../lib/db'
import {
  listCachedEmployees,
  refreshEmployeesCache,
  refreshWeekPayrollCache,
} from '../lib/posCaches'
import { buildSalaryPayRecords } from '../lib/posPayrollWrite'
import { addDaysYmd, formatYmd, valeInLocalWeek, weekStartMondayLocalYmd } from '../lib/week'
import { buildWeeklyPayroll, mergePayrollWithPayments, type PayrollPayment, type PayrollVale } from '../lib/payroll'
import type { CachedEmployee, LocalSalaryPayment, LocalShift, LocalVale } from '../types/pos'

interface Props {
  shift: LocalShift
  onSaved: () => void
  onClose: () => void
}

function toPayrollVale(v: LocalVale): PayrollVale {
  return {
    id: v.id,
    employeeId: v.employeeId,
    amount: v.amount,
    description: v.description,
    paidAt: v.paidAt,
  }
}

function toPayrollPayment(p: LocalSalaryPayment): PayrollPayment {
  return {
    id: p.id,
    employeeId: p.employeeId,
    amount: p.amount,
    valesDeducted: p.valesDeducted,
    netPaid: p.netPaid,
    notes: p.notes,
    paidAt: p.paidAt,
    valesSnapshot: (p.valesSnapshot ?? []).map(v => ({
      id: v.id,
      employeeId: p.employeeId,
      amount: v.amount,
      description: v.description,
      paidAt: v.paidAt,
    })),
  }
}

export function ShiftPayrollModal({ shift, onSaved, onClose }: Props) {
  useBackLayer(true, onClose)
  const keyboardInset = useKeyboardInset()
  const weekStart = weekStartMondayLocalYmd()
  const weekEnd = addDaysYmd(weekStart, 6)

  const [employees, setEmployees] = useState<CachedEmployee[]>([])
  const [vales, setVales] = useState<LocalVale[]>([])
  const [payments, setPayments] = useState<LocalSalaryPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notesById, setNotesById] = useState<Record<string, string>>({})
  const [reloadKey, setReloadKey] = useState(0)

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      await refreshEmployeesCache()
      await refreshWeekPayrollCache(weekStart, weekEnd)
    } catch (err) {
      console.error('[payroll] caché', err)
    }
    const [emps, allVales, allPay] = await Promise.all([
      listCachedEmployees(),
      db.vales.toArray(),
      db.salaryPayments.where('weekStart').equals(weekStart).toArray(),
    ])
    setEmployees(emps)
    setVales(allVales.filter(v => valeInLocalWeek(v.paidAt, weekStart, weekEnd)))
    setPayments(allPay)
    setLoading(false)
  }

  useEffect(() => { void reload() }, [reloadKey])

  const rows = useMemo(() => {
    const payrollEmps = employees.map(e => ({
      id: e.id,
      name: e.name,
      weeklyWage: e.weeklyWage,
      archivedAt: e.archivedAt,
      deleted: false,
    }))
    const base = buildWeeklyPayroll(payrollEmps, vales.map(toPayrollVale), weekStart, weekEnd)
    return mergePayrollWithPayments(base, payments.map(toPayrollPayment), payrollEmps)
  }, [employees, vales, payments, weekStart, weekEnd])

  async function pay(employeeId: string) {
    const row = rows.find(r => r.employee.id === employeeId)
    const employee = employees.find(e => e.id === employeeId)
    if (!row || !employee || row.payment) return
    if (row.netToPay <= 0 && row.weeklyWage <= 0) return
    setSavingId(employeeId)
    setError(null)
    try {
      const existing = await db.salaryPayments
        .where('weekStart')
        .equals(weekStart)
        .filter(p => p.employeeId === employeeId)
        .first()
      if (existing) {
        setError('Ya se registró el pago de esa semana.')
        setSavingId(null)
        return
      }
      const note = (notesById[employeeId] ?? '').trim()
      const { payment, expense } = buildSalaryPayRecords({
        paymentId: uuidv4(),
        expenseId: uuidv4(),
        employee,
        shiftId: shift.id,
        storeId: shift.storeId,
        weekStart,
        amount: row.weeklyWage,
        valesDeducted: row.totalVales,
        notes: note ? note.slice(0, 200) : null,
        valesSnapshot: row.vales.map(v => ({
          id: v.id,
          amount: v.amount,
          description: v.description,
          paidAt: v.paidAt,
        })),
        recordedBy: shift.userId,
        now: new Date().toISOString(),
      })
      await db.transaction('rw', db.salaryPayments, db.expenses, async () => {
        await db.salaryPayments.put(payment)
        if (expense) await db.expenses.put(expense)
      })
      onSaved()
      setReloadKey(k => k + 1)
    } catch (err) {
      console.error('[payroll] pagar', err)
      setError('No se pudo registrar el pago.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/80"
      style={{ paddingBottom: keyboardInset }}
    >
      <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-gray-900">
        <div className="flex items-center justify-between gap-2 border-b border-gray-800 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-white" title="Liquidación semanal">Liquidación semanal</h2>
            <p className="truncate text-[11px] text-gray-500">
              Semana {formatYmd(weekStart)} – {formatYmd(weekEnd)} · sale de esta caja
            </p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-2xl leading-none text-gray-400">×</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
          {loading && <p className="text-center text-sm text-gray-400">Cargando…</p>}
          {!loading && rows.length === 0 && (
            <p className="text-center text-sm text-orange-400">
              No hay empleados con sueldo en caché. Conectate una vez para bajar la lista.
            </p>
          )}
          {rows.map(row => (
            <div key={row.employee.id} className="space-y-2 rounded-xl border border-gray-800 bg-gray-800/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 flex-1 truncate font-semibold text-white" title={row.employee.name}>
                  {row.employee.name}
                </p>
                {row.payment && (
                  <span className="shrink-0 rounded border border-emerald-800 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-400">
                    Pagado
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1 text-center text-xs">
                <div>
                  <p className="text-gray-500">Sueldo</p>
                  <p className="text-white">{formatMoney(row.weeklyWage)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Vales</p>
                  <p className="text-amber-300">{formatMoney(row.totalVales)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Neto</p>
                  <p className="font-semibold text-emerald-300">{formatMoney(row.netToPay)}</p>
                </div>
              </div>
              {row.vales.length > 0 && (
                <ul className="space-y-0.5 text-[11px] text-gray-400">
                  {row.vales.map(v => (
                    <li key={v.id} className="flex justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate" title={v.description ?? 'Vale'}>{v.description ?? 'Vale'}</span>
                      <span className="shrink-0">{formatMoney(v.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!row.payment && (
                <>
                  <input
                    type="text"
                    value={notesById[row.employee.id] ?? ''}
                    onChange={e => setNotesById(prev => ({ ...prev, [row.employee.id]: e.target.value.slice(0, 200) }))}
                    maxLength={200}
                    placeholder="Nota opcional…"
                    className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
                  />
                  <button
                    type="button"
                    disabled={savingId !== null}
                    onClick={() => { void pay(row.employee.id) }}
                    className="w-full rounded-xl bg-red-600 py-3 text-sm font-bold text-white disabled:opacity-40"
                  >
                    {savingId === row.employee.id ? 'Guardando…' : `Pagar ${formatMoney(row.netToPay)}`}
                  </button>
                </>
              )}
              {row.payment?.notes && (
                <p className="truncate text-[11px] text-gray-400" title={row.payment.notes}>{row.payment.notes}</p>
              )}
            </div>
          ))}
          {error && <p className="text-center text-sm font-medium text-orange-400">{error}</p>}
        </div>

        <div className="border-t border-gray-800 p-4">
          <button type="button" onClick={onClose} className="w-full rounded-xl bg-gray-800 py-4 font-semibold text-white">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
