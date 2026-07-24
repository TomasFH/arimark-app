/**
 * Pantalla de historial completo — solo admin.
 *
 * Panel izquierdo: lista de turnos cerrados con filtro por rango de fechas.
 * Panel derecho: detalle completo del turno seleccionado.
 */
import { useState, useEffect, useCallback } from 'react'
import { formatARS, toLocalDate, toLocalDateTime, toLocalTime } from '../lib/datetime'
import type { HistoryShiftRow, HistoryShiftDetail, GetHistoryShiftsPayload, StoreRow } from '../types/hw-api'
import StoreFilter from '../components/StoreFilter'

const SHIFT_TYPE_LABEL = { morning: 'Mañana', evening: 'Tarde' }

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  debit: 'Débito',
  wallet: 'Billetera Virtual',
  credit: 'Crédito',
}

interface Props {
  onBack: () => void
}

export default function HistoryScreen({ onBack }: Props) {
  const [shifts, setShifts] = useState<HistoryShiftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [storeIdFilter, setStoreIdFilter] = useState<string>('all')
  const [availableStores, setAvailableStores] = useState<StoreRow[]>([])

  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null)
  const [detail, setDetail] = useState<HistoryShiftDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  // Cargar locales al montar
  useEffect(() => {
    window.hw.getStores().then(r => {
      if (r.ok) setAvailableStores(r.data)
    })
  }, [])

  const loadShifts = useCallback(async () => {
    setLoading(true)
    setError(null)
    const payload: GetHistoryShiftsPayload = {
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      storeIdFilter,
    }
    const r = await window.hw.getHistoryShifts(payload)
    if (r.ok) {
      setShifts([...r.data].sort((a, b) => b.startedAt.localeCompare(a.startedAt)))
    } else {
      setError(r.error)
    }
    setLoading(false)
  }, [fromDate, toDate, storeIdFilter])

  useEffect(() => {
    void loadShifts()
  }, [loadShifts])

  async function handleSelectShift(shiftId: string) {
    if (selectedShiftId === shiftId) {
      setSelectedShiftId(null)
      setDetail(null)
      return
    }
    setSelectedShiftId(shiftId)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    const r = await window.hw.getHistoryShiftDetail({ shiftId })
    if (r.ok) setDetail(r.data)
    else setDetailError(r.error)
    setDetailLoading(false)
  }

  return (
    <div className="flex flex-col flex-1 h-full bg-gray-950 text-white overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 shrink-0">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-gray-800 transition-colors text-gray-400 hover:text-white shrink-0"
          title="Volver"
        >
          ←
        </button>
        <h1 className="text-base font-semibold text-white min-w-0 flex-1">Historial de turnos</h1>
        {availableStores.length > 0 && (
          <StoreFilter
            stores={availableStores}
            value={storeIdFilter}
            onChange={v => { setStoreIdFilter(v); setSelectedShiftId(null); setDetail(null) }}
          />
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Panel izquierdo — lista de turnos */}
        <div className="w-full sm:w-80 shrink-0 flex flex-col border-r border-gray-800 overflow-hidden">
          {/* Filtro de fechas */}
          <div className="px-3 py-2 border-b border-gray-800 space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Filtrar por fecha</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-600">Desde</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  className="w-full mt-0.5 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-600">Hasta</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  className="w-full mt-0.5 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            {(fromDate || toDate) && (
              <button
                onClick={() => { setFromDate(''); setToDate('') }}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                Limpiar filtro
              </button>
            )}
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <p className="text-gray-500 text-sm text-center py-8 animate-pulse">Cargando turnos…</p>
            )}
            {error && (
              <p className="text-red-400 text-sm text-center py-8">{error}</p>
            )}
            {!loading && !error && shifts.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-8">No hay turnos en el período.</p>
            )}
            {shifts.map(shift => (
              <ShiftListItem
                key={shift.id}
                shift={shift}
                selected={selectedShiftId === shift.id}
                onClick={() => void handleSelectShift(shift.id)}
              />
            ))}
          </div>
        </div>

        {/* Panel derecho — detalle */}
        <div className="flex-1 overflow-y-auto">
          {!selectedShiftId && (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-600 text-sm">Seleccioná un turno para ver el detalle</p>
            </div>
          )}
          {detailLoading && (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500 text-sm animate-pulse">Cargando detalle…</p>
            </div>
          )}
          {detailError && (
            <div className="flex items-center justify-center h-full">
              <p className="text-red-400 text-sm">{detailError}</p>
            </div>
          )}
          {detail && <ShiftDetail detail={detail} />}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shift list item
// ---------------------------------------------------------------------------

function ShiftListItem({ shift, selected, onClick }: { shift: HistoryShiftRow; selected: boolean; onClick: () => void }) {
  const date = toLocalDate(shift.startedAt)

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 border-b border-gray-800/60 transition-colors ${
        selected ? 'bg-blue-900/30 border-l-2 border-l-blue-500' : 'hover:bg-gray-900/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">{date} — {SHIFT_TYPE_LABEL[shift.shiftType]}</p>
          <p className="text-xs text-gray-400 truncate" title={shift.cashierName}>{shift.cashierName}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-emerald-400">{formatARS(shift.totalRevenue)}</p>
          <p className="text-xs text-gray-500">{shift.salesCount} ventas</p>
        </div>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Shift detail
// ---------------------------------------------------------------------------

function ShiftDetail({ detail }: { detail: HistoryShiftDetail }) {
  const { shift, sales, expenses, debts, deposits, summary } = detail
  const [activeTab, setActiveTab] = useState<'sales' | 'expenses' | 'debts' | 'deposits'>('sales')

  const shiftLabel = SHIFT_TYPE_LABEL[shift.shiftType]
  const start = toLocalDateTime(shift.startedAt)
  const end = shift.closedAt ? toLocalDateTime(shift.closedAt) : '—'

  return (
    <div className="p-4 space-y-4">
      {/* Resumen financiero */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">
              {toLocalDate(shift.startedAt)} — Turno {shiftLabel}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Cajera: {shift.cashierName}</p>
            <p className="text-xs text-gray-500">{start} → {end}</p>
          </div>
          {shift.closingCash != null && (
            <div className="text-right shrink-0">
              <p className="text-[10px] text-gray-500">Efectivo al cerrar</p>
              <p className="text-sm font-semibold text-white">{formatARS(shift.closingCash)}</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-gray-800">
          <SummaryStat label="Ventas" value={String(summary.salesCount)} />
          <SummaryStat label="Total vendido" value={formatARS(summary.totalRevenue)} />
          <SummaryStat label="Efectivo ventas" value={formatARS(summary.totalCashSales)} />
          {summary.totalDebitSales > 0 && <SummaryStat label="Débito" value={formatARS(summary.totalDebitSales)} />}
          {summary.totalWalletSales > 0 && <SummaryStat label="Billetera Virtual" value={formatARS(summary.totalWalletSales)} />}
          {summary.totalCreditSales > 0 && <SummaryStat label="Crédito" value={formatARS(summary.totalCreditSales)} />}
          {summary.totalExpenses > 0 && <SummaryStat label="Gastos" value={`- ${formatARS(summary.totalExpenses)}`} negative />}
          {summary.cashDeposits > 0 && <SummaryStat label="Señas efectivo" value={formatARS(summary.cashDeposits)} />}
          {summary.digitalDeposits > 0 && <SummaryStat label="Señas digital" value={formatARS(summary.digitalDeposits)} />}
          {summary.debtsCount > 0 && <SummaryStat label={`Fiados (${summary.debtsCount})`} value={formatARS(summary.totalDebts)} />}
          <SummaryStat label="Efectivo esperado" value={formatARS(summary.cashInHand)} highlight />
        </div>

        {shift.notes && (
          <p className="text-xs text-gray-400 pt-1">Notas: <span className="text-gray-200">{shift.notes}</span></p>
        )}
        {shift.deliveredAmount != null && shift.deliveredAmount > 0 && (
          <p className="text-xs text-gray-400">
            Entregó {formatARS(shift.deliveredAmount)}
            {shift.deliveredTo ? ` a ${shift.deliveredTo}` : ''}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {([
          { key: 'sales', label: `Ventas (${sales.length})` },
          { key: 'expenses', label: `Gastos (${expenses.length})` },
          { key: 'debts', label: `Fiados (${debts.length})` },
          { key: 'deposits', label: `Señas (${deposits.length})` },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab contents */}
      {activeTab === 'sales' && (
        <div className="space-y-2">
          {sales.length === 0 && <p className="text-gray-500 text-sm py-4 text-center">Sin ventas en este turno.</p>}
          {sales.map(sale => (
            <div
              key={sale.id}
              className={`rounded-lg border p-3 text-sm ${
                sale.status === 'cancelled'
                  ? 'border-gray-800 bg-gray-900/30 opacity-50'
                  : 'border-gray-800 bg-gray-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-400">{toLocalTime(sale.createdAt)}</span>
                    {sale.status === 'cancelled' && (
                      <span className="text-[10px] text-red-400 font-medium line-through">Anulada</span>
                    )}
                    {sale.isDebt && <span className="text-[10px] text-amber-400 font-medium">Fiado</span>}
                    {sale.manualEntry && <span className="text-[10px] text-gray-500 font-medium">Manual</span>}
                  </div>
                  <div className="flex gap-1 mt-0.5 flex-wrap">
                    {sale.paymentMethods.map(m => (
                      <span key={m} className="text-[10px] text-gray-500 bg-gray-800 rounded px-1">
                        {PAYMENT_METHOD_LABELS[m] ?? m}
                      </span>
                    ))}
                  </div>
                </div>
                <span className={`font-semibold shrink-0 ${sale.status === 'cancelled' ? 'line-through text-gray-500' : 'text-white'}`}>
                  {formatARS(sale.total)}
                </span>
              </div>
              {sale.items.length > 0 && (
                <div className="mt-2 space-y-0.5 border-t border-gray-800/60 pt-2">
                  {sale.items.map((item, i) => (
                    <div key={i} className="flex justify-between text-xs text-gray-400">
                      <span className="truncate min-w-0 flex-1" title={item.productName}>
                        {item.productName} × {item.unit === 'kg' ? `${item.quantity.toFixed(3)} kg` : item.quantity}
                      </span>
                      <span className="shrink-0 ml-2">{formatARS(item.subtotal)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'expenses' && (
        <div className="space-y-2">
          {expenses.length === 0 && <p className="text-gray-500 text-sm py-4 text-center">Sin gastos en este turno.</p>}
          {expenses.map(exp => (
            <div key={exp.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-white font-medium truncate" title={exp.provider ?? exp.concept ?? ''}>
                  {exp.provider ?? exp.concept ?? '—'}
                </p>
                <div className="flex gap-3 text-xs text-gray-500">
                  <span>{toLocalTime(exp.createdAt)}</span>
                  {exp.provider && exp.concept && <span className="truncate" title={exp.concept}>{exp.concept}</span>}
                  {exp.notes && <span className="truncate" title={exp.notes}>{exp.notes}</span>}
                </div>
              </div>
              <span className="text-red-400 font-semibold shrink-0">- {formatARS(exp.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'debts' && (
        <div className="space-y-2">
          {debts.length === 0 && <p className="text-gray-500 text-sm py-4 text-center">Sin fiados en este turno.</p>}
          {debts.map(debt => (
            <div key={debt.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-white font-medium truncate" title={debt.customerName}>{debt.customerName}</p>
                <div className="flex gap-3 text-xs text-gray-500">
                  <span>{toLocalTime(debt.createdAt)}</span>
                  {debt.notes && <span className="truncate" title={debt.notes}>{debt.notes}</span>}
                </div>
              </div>
              <span className="text-amber-400 font-semibold shrink-0">{formatARS(debt.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'deposits' && (
        <div className="space-y-2">
          {deposits.length === 0 && <p className="text-gray-500 text-sm py-4 text-center">Sin señas en este turno.</p>}
          {deposits.map(dep => (
            <div key={dep.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-white font-medium truncate" title={dep.customerName}>{dep.customerName}</p>
                <div className="flex gap-3 text-xs text-gray-500">
                  <span>{toLocalTime(dep.createdAt)}</span>
                  <span className="truncate" title={dep.items}>{dep.items}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-blue-400 font-semibold">{formatARS(dep.depositAmount)}</p>
                {dep.depositMethod && (
                  <p className="text-[10px] text-gray-500">{PAYMENT_METHOD_LABELS[dep.depositMethod]}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryStat({ label, value, highlight, negative }: { label: string; value: string; highlight?: boolean; negative?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className={`text-sm font-semibold ${highlight ? 'text-emerald-400' : negative ? 'text-red-400' : 'text-white'}`}>
        {value}
      </p>
    </div>
  )
}
