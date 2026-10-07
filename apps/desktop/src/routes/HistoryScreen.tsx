/**
 * Pantalla de historial completo — solo admin.
 *
 * Panel izquierdo: lista de turnos (abiertos y cerrados) con filtro por rango de fechas.
 * Panel derecho: detalle completo del turno seleccionado.
 */
import { useState, useEffect, useCallback } from 'react'
import CashHandoverAuditCard from '../components/CashHandoverAuditCard'
import { ScreenHeader } from '../components/ui'
import { formatARS, toLocalDate, toLocalDateTime, toLocalTime, todayLocalYmd, addDaysYmd } from '../lib/datetime'
import { exceptionalDiscountLabel, injectHistoryLabel } from '@carniceria/shared'
import type { HistoryShiftRow, HistoryShiftDetail, HistoryOrderRow, GetHistoryShiftsPayload, StoreRow } from '../types/hw-api'
import StoreFilter from '../components/StoreFilter'

const SHIFT_TYPE_LABEL = { morning: 'Mañana', evening: 'Tarde' }

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  debit: 'Débito',
  wallet: 'Billetera Virtual',
  credit: 'Crédito',
}

function depositBreakdown(dep: HistoryOrderRow): string | null {
  const payments = dep.depositPayments && dep.depositPayments.length > 0
    ? dep.depositPayments
    : dep.depositMethod && dep.depositAmount > 0
      ? [{ method: dep.depositMethod, amount: dep.depositAmount }]
      : []
  if (payments.length === 0) return null
  return payments
    .map(p => `${PAYMENT_METHOD_LABELS[p.method] ?? p.method} ${formatARS(p.amount)}`)
    .join(' · ')
}

interface Props {
  onBack: () => void
}

export default function HistoryScreen({ onBack }: Props) {
  const [shifts, setShifts] = useState<HistoryShiftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [fromDate, setFromDate] = useState(() => addDaysYmd(todayLocalYmd(), -7))
  const [toDate, setToDate] = useState(() => todayLocalYmd())
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
      setShifts([...r.data].sort((a, b) => {
        const aOpen = a.closedAt ? 0 : 1
        const bOpen = b.closedAt ? 0 : 1
        if (aOpen !== bOpen) return bOpen - aOpen
        return b.startedAt.localeCompare(a.startedAt)
      }))
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
    <div className="flex flex-col flex-1 h-full bg-app text-ink overflow-hidden">
      <ScreenHeader
        title="Historial de turnos"
        onBack={onBack}
        actions={availableStores.length > 0 ? (
          <StoreFilter
            stores={availableStores}
            value={storeIdFilter}
            onChange={v => { setStoreIdFilter(v); setSelectedShiftId(null); setDetail(null) }}
          />
        ) : undefined}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Panel izquierdo — lista de turnos */}
        <div className="w-full sm:w-80 shrink-0 flex flex-col border-r border-line bg-panel overflow-hidden">
          <div className="px-3 py-2 border-b border-line space-y-2">
            <p className="text-xs text-muted">Filtrar por fecha</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-subtle">Desde</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  className="w-full mt-0.5 bg-input border border-line rounded-lg px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-line-accent"
                />
              </div>
              <div>
                <label className="text-[10px] text-subtle">Hasta</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  className="w-full mt-0.5 bg-input border border-line rounded-lg px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-line-accent"
                />
              </div>
            </div>
            {(fromDate || toDate) && (
              <button
                onClick={() => { setFromDate(''); setToDate('') }}
                className="text-xs text-muted hover:text-ink transition-colors"
              >
                Limpiar filtro
              </button>
            )}
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <p className="text-muted text-sm text-center py-8 animate-pulse">Cargando turnos…</p>
            )}
            {error && (
              <p className="text-danger text-sm text-center py-8">{error}</p>
            )}
            {!loading && !error && shifts.length === 0 && (
              <p className="text-muted text-sm text-center py-8">No hay turnos en el período.</p>
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
              <p className="text-subtle text-sm">Seleccioná un turno para ver el detalle</p>
            </div>
          )}
          {detailLoading && (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted text-sm animate-pulse">Cargando detalle…</p>
            </div>
          )}
          {detailError && (
            <div className="flex items-center justify-center h-full">
              <p className="text-danger text-sm">{detailError}</p>
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
  const isOpen = !shift.closedAt

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 border-b border-line transition-colors ${
        selected ? 'bg-accent-soft' : 'hover:bg-hover'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-medium text-ink min-w-0 truncate" title={`${date} — ${SHIFT_TYPE_LABEL[shift.shiftType]}`}>
              {date} — {SHIFT_TYPE_LABEL[shift.shiftType]}
            </p>
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                isOpen
                  ? 'bg-accent-soft text-success border border-line-accent'
                  : 'bg-raised text-muted border border-line'
              }`}
            >
              {isOpen ? 'Abierto' : 'Cerrado'}
            </span>
            {shift.source === 'mobile' && (
              <span
                className="shrink-0 rounded-full border border-line bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent"
                title="Cierre hecho en el celular"
              >
                Móvil
              </span>
            )}
          </div>
          <p className="text-xs text-muted truncate" title={shift.cashierName}>{shift.cashierName}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold font-mono text-ink">{formatARS(shift.totalRevenue)}</p>
          <p className="text-xs text-muted">{shift.salesCount} ventas</p>
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
  const vales = detail.vales ?? []
  const [activeTab, setActiveTab] = useState<'sales' | 'expenses' | 'debts' | 'deposits' | 'vales'>('sales')

  const shiftLabel = SHIFT_TYPE_LABEL[shift.shiftType]
  const start = toLocalDateTime(shift.startedAt)
  const end = shift.closedAt ? toLocalDateTime(shift.closedAt) : '—'

  return (
    <div className="p-4 space-y-4">
      {/* Resumen financiero */}
      <div className="bg-panel rounded-xl border border-line p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              {toLocalDate(shift.startedAt)} — Turno {shiftLabel}
              {!shift.closedAt && (
                <span className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-accent-soft text-success border border-line-accent align-middle">
                  Abierto
                </span>
              )}
              {shift.source === 'mobile' && (
                <span className="ml-2 rounded-full border border-line bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent align-middle">
                  Móvil
                </span>
              )}
            </h2>
            <p className="text-xs text-muted mt-0.5">Cajera: {shift.cashierName}</p>
            <p className="text-xs text-muted">{start} → {end}</p>
          </div>
          {shift.closingCash != null && (
            <div className="text-right shrink-0">
              <p className="text-[10px] text-muted">Efectivo al cerrar</p>
              <p className="text-sm font-semibold text-ink">{formatARS(shift.closingCash)}</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-line">
          <SummaryStat label="Ventas" value={String(summary.salesCount)} />
          <SummaryStat label="Total vendido" value={formatARS(summary.totalRevenue)} />
          <SummaryStat label="Efectivo ventas" value={formatARS(summary.totalCashSales)} />
          {summary.totalDebitSales > 0 && <SummaryStat label="Débito" value={formatARS(summary.totalDebitSales)} />}
          {summary.totalWalletSales > 0 && <SummaryStat label="Billetera Virtual" value={formatARS(summary.totalWalletSales)} />}
          {summary.totalCreditSales > 0 && <SummaryStat label="Crédito" value={formatARS(summary.totalCreditSales)} />}
          {summary.totalExpenses > 0 && <SummaryStat label="Gastos" value={`- ${formatARS(summary.totalExpenses)}`} negative />}
          {summary.totalCashInjects > 0 && <SummaryStat label="Ingresos" value={formatARS(summary.totalCashInjects)} />}
          {summary.cashDeposits > 0 && <SummaryStat label="Señas efectivo" value={formatARS(summary.cashDeposits)} />}
          {summary.digitalDeposits > 0 && <SummaryStat label="Señas digital" value={formatARS(summary.digitalDeposits)} />}
          {summary.debtsCount > 0 && <SummaryStat label={`Fiados (${summary.debtsCount})`} value={formatARS(summary.totalDebts)} />}
          <SummaryStat label="Efectivo esperado" value={formatARS(summary.cashInHand)} highlight />
        </div>

        {shift.notes && (
          <p className="text-xs text-muted pt-1">Notas: <span className="text-ink">{shift.notes}</span></p>
        )}
          {shift.deliveredAmount != null && shift.deliveredAmount > 0 && (
          <p className="text-xs text-muted">
            Entregó {formatARS(shift.deliveredAmount)}
            {shift.deliveredTo ? ` a ${shift.deliveredTo}` : ''}
          </p>
        )}
      </div>

      {detail.cashHandover && <CashHandoverAuditCard audit={detail.cashHandover} />}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line">
        {([
          { key: 'sales', label: `Ventas (${sales.length})` },
          { key: 'expenses', label: `Gastos (${expenses.length})` },
          { key: 'debts', label: `Fiados (${debts.length})` },
          { key: 'deposits', label: `Señas (${deposits.length})` },
          { key: 'vales', label: `Vales (${vales.length})` },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-b-2 border-b-accent text-ink'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab contents */}
      {activeTab === 'sales' && (
        <div className="space-y-2">
          {sales.length === 0 && <p className="text-muted text-sm py-4 text-center">Sin ventas en este turno.</p>}
          {sales.map(sale => {
            const apartLabel = sale.discountException
              ? exceptionalDiscountLabel(sale.discountPercent ?? 0)
              : null
            return (
            <div
              key={sale.id}
              className={`rounded-lg border p-3 text-sm ${
                sale.status === 'cancelled'
                  ? 'border-line bg-panel opacity-50'
                  : 'border-line bg-panel'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted">{toLocalTime(sale.createdAt)}</span>
                    {sale.status === 'cancelled' && (
                      <span className="text-[10px] text-muted font-medium line-through">Anulada</span>
                    )}
                    {sale.isDebt && <span className="text-[10px] text-muted font-medium">Fiado</span>}
                    {sale.manualEntry && <span className="text-[10px] text-muted font-medium">Manual</span>}
                    {apartLabel && (
                      <span className="max-w-[11rem] truncate text-[10px] font-medium text-muted" title={apartLabel}>
                        {apartLabel}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 mt-0.5 flex-wrap">
                    {sale.paymentMethods.map(m => (
                      <span key={m} className="text-[10px] text-muted bg-raised rounded px-1">
                        {PAYMENT_METHOD_LABELS[m] ?? m}
                      </span>
                    ))}
                  </div>
                </div>
                <span className={`font-semibold shrink-0 ${sale.status === 'cancelled' ? 'line-through text-muted' : 'text-ink'}`}>
                  {formatARS(sale.total)}
                </span>
              </div>
              {sale.items.length > 0 && (
                <div className="mt-2 space-y-0.5 border-t border-line pt-2">
                  {sale.items.map((item, i) => (
                    <div key={i} className="flex justify-between text-xs text-muted">
                      <span className="truncate min-w-0 flex-1" title={item.productName}>
                        {item.productName} × {item.unit === 'kg' ? `${item.quantity.toFixed(3)} kg` : item.quantity}
                      </span>
                      <span className="shrink-0 ml-2">{formatARS(item.subtotal)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}

      {activeTab === 'expenses' && (
        <div className="space-y-2">
          {expenses.length === 0 && <p className="text-muted text-sm py-4 text-center">Sin gastos en este turno.</p>}
          {expenses.map(exp => {
            const isInject = exp.kind === 'inject'
            const injectLabel = isInject ? injectHistoryLabel(exp.injectReason, exp.concept) : ''
            const title = isInject ? injectLabel : (exp.provider ?? exp.concept ?? '')
            return (
            <div key={exp.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  {isInject && (
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-success border border-line-accent rounded px-1.5 py-0.5 truncate max-w-[11rem]" title={injectLabel}>
                      {injectLabel}
                    </span>
                  )}
                  <p className="text-ink font-medium truncate min-w-0 flex-1" title={title}>
                    {isInject ? (exp.notes?.trim() || injectLabel) : (exp.provider ?? exp.concept ?? '—')}
                  </p>
                </div>
                <div className="flex gap-3 text-xs text-muted min-w-0">
                  <span className="shrink-0">{toLocalTime(exp.createdAt)}</span>
                  {!isInject && exp.provider && exp.concept && <span className="truncate" title={exp.concept}>{exp.concept}</span>}
                  {!isInject && exp.notes && <span className="truncate" title={exp.notes}>{exp.notes}</span>}
                </div>
              </div>
              <span className={`font-semibold shrink-0 font-mono ${isInject ? 'text-success' : 'text-muted'}`}>
                {isInject ? formatARS(exp.amount) : `- ${formatARS(exp.amount)}`}
              </span>
            </div>
            )
          })}
        </div>
      )}

      {activeTab === 'debts' && (
        <div className="space-y-2">
          {debts.length === 0 && <p className="text-muted text-sm py-4 text-center">Sin fiados en este turno.</p>}
          {debts.map(debt => (
            <div key={debt.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-ink font-medium truncate" title={debt.customerName}>{debt.customerName}</p>
                <div className="flex gap-3 text-xs text-muted">
                  <span>{toLocalTime(debt.createdAt)}</span>
                  {debt.notes && <span className="truncate" title={debt.notes}>{debt.notes}</span>}
                </div>
              </div>
              <span className="text-ink font-semibold shrink-0 font-mono">{formatARS(debt.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'deposits' && (
        <div className="space-y-2">
          {deposits.length === 0 && <p className="text-muted text-sm py-4 text-center">Sin señas en este turno.</p>}
          {deposits.map(dep => {
            const breakdown = depositBreakdown(dep)
            return (
            <div key={dep.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-ink font-medium truncate" title={dep.customerName}>{dep.customerName}</p>
                <div className="flex gap-3 text-xs text-muted min-w-0">
                  <span className="shrink-0">{toLocalTime(dep.createdAt)}</span>
                  <span className="truncate" title={dep.items}>{dep.items}</span>
                </div>
                {breakdown && (
                  <p className="text-[10px] text-muted truncate" title={breakdown}>{breakdown}</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-ink font-semibold font-mono">{formatARS(dep.depositAmount)}</p>
                {dep.status === 'cancelled' && (
                  <p className="text-[10px] text-danger">Pedido anulado</p>
                )}
              </div>
            </div>
            )
          })}
        </div>
      )}

      {activeTab === 'vales' && (
        <div className="space-y-2">
          {vales.length === 0 && <p className="text-muted text-sm py-4 text-center">Sin vales en este turno.</p>}
          {vales.map(vale => (
            <div key={vale.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-ink font-medium truncate" title={vale.employeeName}>{vale.employeeName}</p>
                <div className="flex gap-3 text-xs text-muted min-w-0">
                  <span className="shrink-0">{toLocalTime(vale.createdAt)}</span>
                  {vale.items && vale.items.length > 0 ? (
                    <span className="truncate" title={vale.items.map(i => i.productName).join(', ')}>
                      {vale.items.map(i => i.productName).join(', ')}
                    </span>
                  ) : vale.description ? (
                    <span className="truncate" title={vale.description}>{vale.description}</span>
                  ) : (
                    <span>Adelanto en efectivo</span>
                  )}
                </div>
                {vale.cancelledAt && (
                  <p className="text-[10px] text-danger">Anulado</p>
                )}
              </div>
              <span className={`text-ink font-semibold shrink-0 font-mono ${vale.cancelledAt ? 'line-through text-muted' : ''}`}>
                {formatARS(vale.amount)}
              </span>
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
      <p className="text-[10px] text-muted">{label}</p>
      <p className={`text-sm font-semibold font-mono ${highlight ? 'text-success' : negative ? 'text-muted' : 'text-ink'}`}>
        {value}
      </p>
    </div>
  )
}
