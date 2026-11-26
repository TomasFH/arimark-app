/**
 * Historial de turnos. El admin ve todo; la cajera, la semana en curso y la anterior.
 *
 * Panel izquierdo: lista de turnos (abiertos y cerrados) con filtro por rango de fechas.
 * Panel derecho: detalle completo del turno seleccionado.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import CashHandoverAuditCard from '../components/CashHandoverAuditCard'
import HistoryStoreSelect from '../components/HistoryStoreSelect'
import ShiftCloseCorrection from '../components/ShiftCloseCorrection'
import { AdminSectionHeader } from '../components/AdminSectionHeader'
import { formatARS, formatKg, toLocalDate, toLocalDateTime, toLocalTime, toVisitDayLabel, todayLocalYmd, addDaysYmd, utcToLocalYmd } from '../lib/datetime'
import { getCachedHistoryDetail, rememberHistoryDetail } from '../lib/historyDetailCache'
import {
  clearHistoryVisitReturn,
  readHistoryVisitReturn,
  rememberHistoryVisitReturn,
  type HistoryDetailTab,
  type HistoryVisitReturnState,
} from '../lib/historyVisitReturn'
import { clampHistoryRange, planHistoryFetch, type HistorySpan } from '../lib/historyRange'
import { cashierHistoryWindow, exceptionalDiscountLabel, injectHistoryLabel } from '@carniceria/shared'
import type { HistoryShiftRow, HistoryShiftDetail, HistoryOrderRow, GetHistoryShiftsPayload, StoreRow } from '../types/hw-api'

const SHIFT_TYPE_LABEL = { morning: 'Mañana', evening: 'Tarde' }

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  debit: 'Débito',
  wallet: 'Billetera virtual',
  credit: 'Crédito',
}

const PAYMENT_CHIP: Record<string, string> = {
  cash: 'bg-pay-cash-soft text-pay-cash',
  debit: 'bg-pay-debit-soft text-pay-debit',
  wallet: 'bg-pay-wallet-soft text-pay-wallet',
  credit: 'bg-pay-credit-soft text-pay-credit',
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
  onLogout: () => void
  onOpenVisit?: (visit: { id: string; createdAt: string }) => void
  /** Cajera: la semana en curso y la anterior. El proceso principal rechaza lo demás. */
  limitedToRecentWeeks?: boolean
  /** Vuelta desde «Ver visita»: restaura turno, solapa y gasto abierto. */
  resumeAfterVisit?: boolean
}

export default function HistoryScreen({
  onBack,
  onLogout,
  onOpenVisit,
  limitedToRecentWeeks = false,
  resumeAfterVisit = false,
}: Props) {
  const resumeRef = useRef<HistoryVisitReturnState | null | undefined>(undefined)
  if (resumeRef.current === undefined) {
    resumeRef.current = resumeAfterVisit ? readHistoryVisitReturn() : null
    if (!resumeAfterVisit) clearHistoryVisitReturn()
  }
  const resume = resumeRef.current
  const recentWindow = limitedToRecentWeeks ? cashierHistoryWindow() : null
  const [shifts, setShifts] = useState<HistoryShiftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [fromDate, setFromDate] = useState(() => resume?.fromDate ?? addDaysYmd(todayLocalYmd(), -7))
  const [toDate, setToDate] = useState(() => resume?.toDate ?? todayLocalYmd())
  const [storeIdFilter, setStoreIdFilter] = useState<string>(resume?.storeIdFilter ?? 'all')
  const [availableStores, setAvailableStores] = useState<StoreRow[]>([])
  const [loadedSpan, setLoadedSpan] = useState<HistorySpan | null>(null)
  const listCache = useRef<{ store: string; span: HistorySpan | null; shifts: HistoryShiftRow[] }>({
    store: 'all',
    span: null,
    shifts: [],
  })

  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(resume?.selectedShiftId ?? null)
  const [detailTab, setDetailTab] = useState<HistoryDetailTab>(resume?.activeTab ?? 'sales')
  const [openExpenseId, setOpenExpenseId] = useState<string | null>(resume?.openExpenseId ?? null)
  const [detail, setDetail] = useState<HistoryShiftDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const detailRequest = useRef(0)
  const listRequest = useRef(0)

  // Cargar locales al montar
  useEffect(() => {
    window.hw.getStores().then(r => {
      if (r.ok) setAvailableStores(r.data)
    })
  }, [])

  const loadShifts = useCallback(async (prefer: 'auto' | 'older' | 'newer' = 'auto') => {
    const ticket = ++listRequest.current
    const today = todayLocalYmd()
    const range = clampHistoryRange(fromDate, toDate, today)
    if (range.from !== fromDate) setFromDate(range.from)
    if (range.to !== toDate) setToDate(range.to)

    const cache = listCache.current
    if (cache.store !== storeIdFilter) {
      cache.store = storeIdFilter
      cache.span = null
      cache.shifts = []
    }

    const plan = planHistoryFetch(range.from, range.to, cache.span, prefer)
    const show = (rows: HistoryShiftRow[]) => {
      const visible = rows.filter(shift => {
        const day = shift.startedAt.slice(0, 10)
        return day >= range.from && day <= range.to && (!cache.span || (day >= cache.span.from && day <= cache.span.to))
      })
      setShifts([...visible].sort((a, b) => {
        const aOpen = a.closedAt ? 0 : 1
        const bOpen = b.closedAt ? 0 : 1
        if (aOpen !== bOpen) return bOpen - aOpen
        return b.startedAt.localeCompare(a.startedAt)
      }))
    }

    if (plan.kind === 'none') {
      if (ticket !== listRequest.current) return
      show(cache.shifts)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    const payload: GetHistoryShiftsPayload = {
      fromDate: plan.from,
      toDate: plan.to,
      storeIdFilter,
      limit: 200,
    }
    const r = await window.hw.getHistoryShifts(payload)
    if (ticket !== listRequest.current) return
    if (!r.ok) {
      setError(r.error)
      setLoading(false)
      return
    }
    const merged = plan.kind === 'replace'
      ? r.data
      : [...r.data, ...cache.shifts.filter(shift => !r.data.some(row => row.id === shift.id))]
    cache.shifts = merged
    cache.span = plan.kind === 'replace'
      ? { from: plan.from, to: plan.to }
      : {
          from: cache.span && cache.span.from < plan.from ? cache.span.from : plan.from,
          to: cache.span && cache.span.to > plan.to ? cache.span.to : plan.to,
        }
    setLoadedSpan(cache.span)
    show(merged)
    setLoading(false)
  }, [fromDate, toDate, storeIdFilter])

  useEffect(() => {
    void loadShifts('auto')
  }, [loadShifts])

  async function openShift(shiftId: string) {
    const cached = getCachedHistoryDetail(shiftId)
    if (cached) {
      detailRequest.current += 1
      setSelectedShiftId(shiftId)
      setDetail(cached)
      setDetailError(null)
      setDetailLoading(false)
      return
    }
    const ticket = ++detailRequest.current
    setSelectedShiftId(shiftId)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    const r = await window.hw.getHistoryShiftDetail({ shiftId })
    if (ticket !== detailRequest.current) return
    if (r.ok) {
      rememberHistoryDetail(r.data)
      setDetail(r.data)
    } else {
      setDetailError(r.error)
    }
    setDetailLoading(false)
  }

  async function handleSelectShift(shiftId: string) {
    if (selectedShiftId === shiftId) {
      setSelectedShiftId(null)
      setDetail(null)
      return
    }
    setDetailTab('sales')
    setOpenExpenseId(null)
    await openShift(shiftId)
  }

  const resumeShiftId = useRef(resume?.selectedShiftId ?? null)
  useEffect(() => {
    const shiftId = resumeShiftId.current
    if (!shiftId) return
    resumeShiftId.current = null
    void openShift(shiftId)
  }, [])

  async function reloadSelectedDetail(shiftId: string) {
    const ticket = ++detailRequest.current
    const r = await window.hw.getHistoryShiftDetail({ shiftId })
    if (ticket !== detailRequest.current) return
    if (!r.ok) {
      setDetailError(r.error)
      return
    }
    rememberHistoryDetail(r.data)
    setDetail(r.data)
    setDetailError(null)
  }

  return (
    <div className="flex flex-col flex-1 h-full bg-app text-ink overflow-hidden">
      <AdminSectionHeader
        title="Historial de turnos"
        subtitle={recentWindow
          ? 'Semana en curso y la anterior, de todos los locales'
          : 'Lo vendido, cómo se cobró y el cierre de cada turno'}
        onBack={() => {
          clearHistoryVisitReturn()
          onBack()
        }}
        onLogout={onLogout}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Panel izquierdo — filtros y lista. El detalle de cada turno no se toca. */}
        <div className="flex w-full sm:w-80 shrink-0 flex-col overflow-hidden border-r border-line bg-panel">
          <div className="relative z-10 shrink-0 space-y-3 border-b border-line bg-app px-3 py-3">
            <p className="text-sm font-medium text-ink">Filtros</p>
            {availableStores.length > 0 && (
              <div>
                <label className="mb-1 block text-xs text-muted" htmlFor="history-store">Local</label>
                <HistoryStoreSelect
                  id="history-store"
                  stores={availableStores}
                  value={storeIdFilter}
                  onChange={storeId => { setStoreIdFilter(storeId); setSelectedShiftId(null); setDetail(null) }}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-muted" htmlFor="history-from">Desde</label>
                <input
                  id="history-from"
                  type="date"
                  value={fromDate}
                  min={recentWindow?.fromYmd}
                  max={recentWindow && recentWindow.toYmd < todayLocalYmd() ? recentWindow.toYmd : todayLocalYmd()}
                  onChange={e => {
                    const today = todayLocalYmd()
                    let next = e.target.value > today ? today : e.target.value
                    if (recentWindow && next < recentWindow.fromYmd) next = recentWindow.fromYmd
                    if (recentWindow && next > recentWindow.toYmd) next = recentWindow.toYmd
                    setFromDate(next)
                    if (next > toDate) setToDate(next)
                  }}
                  className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink focus:border-line-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted" htmlFor="history-to">Hasta</label>
                <input
                  id="history-to"
                  type="date"
                  value={toDate}
                  min={recentWindow?.fromYmd}
                  max={recentWindow && recentWindow.toYmd < todayLocalYmd() ? recentWindow.toYmd : todayLocalYmd()}
                  onChange={e => {
                    const today = todayLocalYmd()
                    let next = e.target.value > today ? today : e.target.value
                    if (recentWindow && next < recentWindow.fromYmd) next = recentWindow.fromYmd
                    if (recentWindow && next > recentWindow.toYmd) next = recentWindow.toYmd
                    setToDate(next)
                    if (fromDate > next) setFromDate(next)
                  }}
                  className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink focus:border-line-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const today = todayLocalYmd()
                setFromDate(addDaysYmd(today, -7))
                setToDate(today)
              }}
              className="text-xs font-medium text-muted hover:text-ink"
            >
              Últimos 7 días
            </button>
            {loadedSpan && fromDate < loadedSpan.from && (!recentWindow || loadedSpan.from > recentWindow.fromYmd) && (
              <button
                type="button"
                onClick={() => void loadShifts('older')}
                disabled={loading}
                className="block text-xs text-ink hover:text-accent transition-colors disabled:opacity-40"
              >
                Traer los días anteriores del filtro
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
            {groupHistoryShiftsByDay(shifts).map(day => (
              <section key={day.ymd}>
                <h3 className="sticky top-0 z-10 border-b border-line-strong bg-app px-3 py-2 text-sm font-semibold text-ink">
                  {day.label}
                </h3>
                {day.shifts.map(shift => (
                  <ShiftListItem
                    key={shift.id}
                    shift={shift}
                    storeName={storeIdFilter === 'all' ? storeNameById(availableStores, shift.storeId) : null}
                    selected={selectedShiftId === shift.id}
                    onClick={() => void handleSelectShift(shift.id)}
                  />
                ))}
              </section>
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
          {detail && (
            <ShiftDetail
              detail={detail}
              canCorrectClose={!limitedToRecentWeeks}
              activeTab={detailTab}
              onActiveTab={setDetailTab}
              openExpenseId={openExpenseId}
              onOpenExpense={setOpenExpenseId}
              onOpenVisit={onOpenVisit ? visit => {
                rememberHistoryVisitReturn({
                  fromDate,
                  toDate,
                  storeIdFilter,
                  selectedShiftId,
                  activeTab: detailTab,
                  openExpenseId,
                })
                onOpenVisit(visit)
              } : undefined}
              onCorrected={() => { void reloadSelectedDetail(detail.shift.id) }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function storeNameById(stores: StoreRow[], storeId: string | null | undefined): string | null {
  if (!storeId) return null
  return stores.find(store => store.id === storeId)?.name ?? null
}

/** Días más nuevos primero. Dentro del día, el abierto arriba y después el más tardío. */
function groupHistoryShiftsByDay(shifts: HistoryShiftRow[]): Array<{ ymd: string; label: string; shifts: HistoryShiftRow[] }> {
  const groups = new Map<string, HistoryShiftRow[]>()
  for (const shift of shifts) {
    const ymd = utcToLocalYmd(shift.startedAt)
    const list = groups.get(ymd) ?? []
    list.push(shift)
    groups.set(ymd, list)
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([ymd, dayShifts]) => ({
      ymd,
      label: toVisitDayLabel(dayShifts[0]?.startedAt ?? `${ymd}T15:00:00.000Z`),
      shifts: [...dayShifts].sort((a, b) => {
        const aOpen = a.closedAt ? 0 : 1
        const bOpen = b.closedAt ? 0 : 1
        if (aOpen !== bOpen) return bOpen - aOpen
        return b.startedAt.localeCompare(a.startedAt)
      }),
    }))
}

// ---------------------------------------------------------------------------
// Shift list item
// ---------------------------------------------------------------------------

function ShiftListItem({
  shift,
  storeName,
  selected,
  onClick,
}: {
  shift: HistoryShiftRow
  storeName: string | null
  selected: boolean
  onClick: () => void
}) {
  const isOpen = !shift.closedAt
  const identity = storeName
    ? `${SHIFT_TYPE_LABEL[shift.shiftType]} · ${storeName}`
    : SHIFT_TYPE_LABEL[shift.shiftType]

  return (
    <button
      onClick={onClick}
      className={`w-full border-b border-line px-3 py-3 text-left transition-colors ${
        selected ? 'bg-accent-soft' : 'hover:bg-hover'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-ink">{identity}</p>
          <p className="break-words text-xs text-muted">{shift.cashierName}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="flex items-center justify-end gap-1">
            <span
              className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                isOpen
                  ? 'border border-line-accent bg-accent-soft text-success'
                  : 'border border-line bg-raised text-muted'
              }`}
            >
              {isOpen ? 'En curso' : 'Cerrado'}
            </span>
            {shift.source === 'mobile' && (
              <span
                className="whitespace-nowrap rounded-full border border-line bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent"
                title="Cierre hecho en el celular"
              >
                Móvil
              </span>
            )}
          </div>
          {shift.totalsSealed && shift.totalRevenue != null ? (
            <p className="mt-1 whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-ink">{formatARS(shift.totalRevenue)}</p>
          ) : shift.closedAt ? (
            <p className="mt-1 whitespace-nowrap text-xs text-muted">Sin dato</p>
          ) : null}
        </div>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Shift detail
// ---------------------------------------------------------------------------

function saleCountLabel(count: number): string {
  return count === 1 ? '1 venta' : `${count} ventas`
}

function ShiftDetail({
  detail,
  canCorrectClose,
  activeTab,
  onActiveTab,
  openExpenseId,
  onOpenExpense,
  onCorrected,
  onOpenVisit,
}: {
  detail: HistoryShiftDetail
  /** La cajera no corrige cierres hasta la tanda B: si lo ve y no guarda, cree que corrigió. */
  canCorrectClose: boolean
  activeTab: HistoryDetailTab
  onActiveTab: (tab: HistoryDetailTab) => void
  openExpenseId: string | null
  onOpenExpense: (expenseId: string | null) => void
  onCorrected: () => void
  onOpenVisit?: (visit: { id: string; createdAt: string }) => void
}) {
  const { shift, sales, expenses, debts, deposits, summary } = detail
  const vales = detail.vales ?? []
  const unpaidArrivals = detail.unpaidArrivals ?? []

  const shiftLabel = SHIFT_TYPE_LABEL[shift.shiftType]
  const start = toLocalDateTime(shift.startedAt)
  const end = shift.closedAt ? toLocalDateTime(shift.closedAt) : '—'
  const collections = collectionFacts(summary)
  const drawer = drawerFacts(summary, shift)

  return (
    <div className="p-4 space-y-4">
      {/* Resumen financiero */}
      <div className="bg-panel rounded-xl border border-line p-4 space-y-3">
        <div className="flex items-start gap-4 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="min-w-0 truncate text-sm font-semibold text-ink" title={`${toLocalDate(shift.startedAt)} — Turno ${shiftLabel}`}>
                {toLocalDate(shift.startedAt)} — Turno {shiftLabel}
              </h2>
              {!shift.closedAt && (
                <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-accent-soft text-success border border-line-accent">
                  Abierto
                </span>
              )}
              {shift.source === 'mobile' && (
                <span className="shrink-0 rounded-full border border-line bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  Móvil
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted" title={shift.cashierName}>Cajera: {shift.cashierName}</p>
            <p className="truncate text-xs text-muted" title={`${start} → ${end}`}>{start} → {end}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-2xl font-semibold leading-none tabular-nums tracking-tight text-ink">{formatARS(summary.totalRevenue)}</p>
            <p className="mt-1 text-xs text-muted">Total vendido · {saleCountLabel(summary.salesCount)}</p>
          </div>
        </div>

        {collections.length > 0 && (
          <div className="border-t border-line pt-3">
            <p className="text-xs text-muted">Cómo se cobró</p>
            <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {collections.map(item => (
                <Fact key={item.label} label={item.label} value={item.value} />
              ))}
            </dl>
          </div>
        )}

        <div className="border-t border-line pt-3">
          <p className="text-xs text-muted">Caja</p>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {drawer.map(item => (
              <Fact key={item.label} label={item.label} value={item.value} tone={item.tone} />
            ))}
          </dl>
        </div>

        {shift.notes && (
          <p className="text-xs text-muted">Notas: <span className="text-ink">{shift.notes}</span></p>
        )}

        {unpaidArrivals.length > 0 && (
          <div className="space-y-2 border-t border-line pt-3">
            <p className="text-sm font-medium text-ink">Entró y no se pagó acá</p>
            <p className="text-xs text-muted">Media res y delantero. No entra en la caja.</p>
            {unpaidArrivals.map(arrival => {
              const who = arrival.providerName?.trim() || 'Sin proveedor'
              return (
                <div key={arrival.intakeId} className="space-y-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm text-ink" title={who}>{who}</p>
                    <span className="shrink-0 text-xs text-muted">{toLocalTime(arrival.createdAt)}</span>
                  </div>
                  {arrival.lines.map((line, index) => (
                    <div key={`${arrival.intakeId}-${index}`} className="flex min-w-0 items-baseline gap-3 text-xs">
                      <span className="min-w-0 flex-1 truncate text-ink" title={line.name}>{line.name}</span>
                      <span className="shrink-0 tabular-nums text-muted">{line.quantityLabel || '—'}</span>
                    </div>
                  ))}
                  {onOpenVisit && (
                    <button
                      type="button"
                      className="rounded-md px-1.5 py-0.5 text-xs text-ink underline decoration-line underline-offset-2 hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      onClick={() => onOpenVisit({ id: arrival.intakeId, createdAt: arrival.createdAt })}
                    >
                      Ver visita
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {shift.closedAt && canCorrectClose && (
          <div className="border-t border-line pt-3">
            <ShiftCloseCorrection
              key={`${shift.id}:${shift.cashLeft ?? ''}:${shift.deliveredAmount ?? ''}`}
              cashLeft={shift.cashLeft ?? null}
              withdrawn={shift.deliveredAmount ?? null}
              onSubmit={async patch => {
                const r = await window.hw.correctShiftClose({ shiftId: shift.id, ...patch })
                if (!r.ok) throw new Error(r.error ?? 'No se pudo corregir.')
                onCorrected()
              }}
            />
          </div>
        )}
      </div>

      {detail.cashHandover && <CashHandoverAuditCard key={shift.id} audit={detail.cashHandover} />}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line">
        {([
          { key: 'sales', label: `Ventas (${sales.length})` },
          { key: 'expenses', label: `Gastos (${expenses.filter(row => row.kind !== 'inject').length})` },
          { key: 'injects', label: `Ingresos (${expenses.filter(row => row.kind === 'inject').length})` },
          { key: 'debts', label: `Fiados (${debts.length})` },
          { key: 'deposits', label: `Señas (${deposits.length})` },
          { key: 'vales', label: `Vales (${vales.length})` },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => onActiveTab(tab.key)}
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
            const discountAmount = sale.discountAmount ?? 0
            const listPrice = discountAmount > 0 ? sale.total + discountAmount : null
            const slices = (sale.payments ?? []).filter(pay => pay.amount > 0)
            const showSliceAmount = slices.length > 1
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
                    {(slices.length > 0 ? slices.map(pay => pay.method) : sale.paymentMethods).map(method => {
                      const amount = slices.find(pay => pay.method === method)?.amount
                      const label = PAYMENT_METHOD_LABELS[method] ?? method
                      const text = showSliceAmount && amount != null ? `${label} ${formatARS(amount)}` : label
                      return (
                        <span
                          key={method}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PAYMENT_CHIP[method] ?? 'bg-raised text-muted'}`}
                          title={text}
                        >
                          {text}
                        </span>
                      )
                    })}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {listPrice != null && (
                    <p className="text-xs text-subtle line-through tabular-nums" title={sale.discountPercent ? `Precio de lista, ${sale.discountPercent}% de descuento` : 'Precio de lista'}>
                      {formatARS(listPrice)}
                    </p>
                  )}
                  <p className={`font-semibold tabular-nums ${sale.status === 'cancelled' ? 'line-through text-muted' : 'text-ink'}`}>
                    {formatARS(sale.total)}
                  </p>
                </div>
              </div>
              {sale.items.length > 0 && (
                <div className="mt-2 space-y-0.5 border-t border-line pt-2">
                  {sale.items.map((item, i) => (
                    <div key={i} className="flex justify-between text-xs text-muted">
                      <span className="truncate min-w-0 flex-1" title={item.productName}>
                        {item.productName} × {item.unit === 'kg' ? formatKg(item.quantity) : item.quantity}
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

      {(activeTab === 'expenses' || activeTab === 'injects') && (
        <div className="space-y-2">
          {(activeTab === 'injects' ? expenses.filter(row => row.kind === 'inject') : expenses.filter(row => row.kind !== 'inject')).length === 0 && (
            <p className="text-muted text-sm py-4 text-center">
              {activeTab === 'injects' ? 'Sin ingresos en este turno.' : 'Sin gastos en este turno.'}
            </p>
          )}
          {(activeTab === 'injects' ? expenses.filter(row => row.kind === 'inject') : expenses.filter(row => row.kind !== 'inject')).map(exp => {
            const isInject = exp.kind === 'inject'
            const injectLabel = isInject ? injectHistoryLabel(exp.injectReason, exp.concept) : ''
            const title = isInject ? injectLabel : (exp.provider ?? exp.concept ?? '')
            const open = openExpenseId === exp.id
            const visitLines = exp.visitLines && exp.visitLines.length > 0
              ? exp.visitLines
              : (exp.lineNames ?? []).map(name => ({ name, quantityLabel: '', unitPrice: 0, subtotal: 0 }))
            return (
            <div key={exp.id} className="overflow-hidden rounded-lg border border-line bg-panel text-sm">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => onOpenExpense(open ? null : exp.id)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${open ? 'rounded-t-lg' : 'rounded-lg'}`}
              >
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
              </button>
              {open && (
                <div className="space-y-1 border-t border-line px-3 py-2 text-xs">
                  <p className="break-words text-ink">{title || '—'}</p>
                  {!isInject && exp.provider && exp.concept && (
                    <p className="break-words text-muted">{exp.concept}</p>
                  )}
                  {exp.notes && <p className="break-words text-muted">{exp.notes}</p>}
                  {visitLines.length > 0 && (
                    <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-6 gap-y-1 pt-1">
                      <span className="text-muted">Producto</span>
                      <span className="text-muted">Cantidad</span>
                      <span className="text-right text-muted">Precio</span>
                      <span className="text-right text-muted">Subtotal</span>
                      {visitLines.map((line, index) => (
                        <div key={`${exp.id}-${index}`} className="col-span-4 grid grid-cols-subgrid items-baseline">
                          <span className="min-w-0 truncate text-ink" title={line.name}>{line.name}</span>
                          <span className="whitespace-nowrap tabular-nums text-muted">{line.quantityLabel || '—'}</span>
                          <span className={`whitespace-nowrap text-right tabular-nums ${line.unitPrice > 0 ? 'text-ink' : 'text-muted'}`}>
                            {line.unitPrice > 0 ? formatARS(line.unitPrice) : 'sin precio'}
                          </span>
                          <span className={`whitespace-nowrap text-right tabular-nums ${line.subtotal > 0 ? 'text-ink' : 'text-muted'}`}>
                            {line.subtotal > 0 ? formatARS(line.subtotal) : 'sin precio'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {exp.intakeId && exp.intakeCreatedAt && onOpenVisit && (
                    <button
                      type="button"
                      className="rounded-md px-1.5 py-0.5 text-ink underline decoration-line underline-offset-2 hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      onClick={() => onOpenVisit({ id: exp.intakeId!, createdAt: exp.intakeCreatedAt! })}
                    >
                      Ver visita
                    </button>
                  )}
                </div>
              )}
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

function collectionFacts(summary: HistoryShiftDetail['summary']): FactItem[] {
  const items: FactItem[] = []
  if (summary.totalCashSales > 0) items.push({ label: 'Efectivo', value: formatARS(summary.totalCashSales) })
  if (summary.totalDebitSales > 0) items.push({ label: 'Débito', value: formatARS(summary.totalDebitSales) })
  if (summary.totalWalletSales > 0) items.push({ label: 'Billetera virtual', value: formatARS(summary.totalWalletSales) })
  if (summary.totalCreditSales > 0) items.push({ label: 'Crédito', value: formatARS(summary.totalCreditSales) })
  if (summary.debtsCount > 0) items.push({ label: `Fiados (${summary.debtsCount})`, value: formatARS(summary.totalDebts) })
  return items
}

function drawerFacts(summary: HistoryShiftDetail['summary'], shift: HistoryShiftDetail['shift']): FactItem[] {
  const items: FactItem[] = []
  if (summary.totalExpenses > 0) items.push({ label: 'Gastos', value: `- ${formatARS(summary.totalExpenses)}`, tone: 'muted' })
  if (summary.totalCashInjects > 0) items.push({ label: 'Ingresos', value: formatARS(summary.totalCashInjects) })
  if (summary.cashDeposits > 0) items.push({ label: 'Señas en efectivo', value: formatARS(summary.cashDeposits) })
  if (summary.digitalDeposits > 0) items.push({ label: 'Señas digitales', value: formatARS(summary.digitalDeposits) })
  items.push({ label: 'Efectivo esperado', value: formatARS(summary.cashInHand) })
  if (shift.deliveredAmount != null && shift.deliveredAmount > 0) {
    const who = shift.deliveredTo?.trim()
    items.push({ label: who ? `Entregó a ${who}` : 'Entregó', value: formatARS(shift.deliveredAmount) })
  }
  if (shift.closingCash != null && shift.closingCash !== shift.deliveredAmount) {
    items.push({ label: 'Efectivo al cerrar', value: formatARS(shift.closingCash) })
  }
  return items
}

interface FactItem {
  label: string
  value: string
  tone?: 'ink' | 'muted'
}

function Fact({ label, value, tone = 'ink' }: FactItem) {
  return (
    <div className="flex min-w-0 max-w-full items-baseline gap-2">
      <dt className="min-w-0 truncate text-xs text-muted" title={label}>{label}</dt>
      <dd className={`shrink-0 text-sm font-semibold tabular-nums ${tone === 'muted' ? 'text-muted' : 'text-ink'}`}>{value}</dd>
    </div>
  )
}
