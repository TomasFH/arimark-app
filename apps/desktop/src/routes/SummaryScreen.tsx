/**
 * Resumen del admin. Arranca en todos los locales y en esta semana.
 * Hoy filtra esa semana, sin otra consulta. El mes corta por el lunes.
 * El modo de prueba solo existe con VITE_APP_ENV=dev y no consulta ni escribe.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  boxAporteAmount,
  chickenTotals,
  civilYmd,
  collectionNote,
  combineFiadoSlices,
  coverageAccount,
  filterMediaResProvider,
  formatKg3,
  formatSummaryRange,
  groupMediaResByDay,
  mediaResAverageKg,
  mediaResProviders,
  mediaResTotals,
  onCivilDay,
  paymentsInCivilRange,
  shiftCloseBoxText,
  summaryBoxLabel,
  summaryBoxTally,
  summaryMoneyView,
  summaryMonthStep,
  summaryNewDebt,
  summarizeExpenses,
  summaryPaymentBreakdown,
  summaryPeriodDates,
  summaryPeriodQuery,
  ymdInRange,
  summaryPreview,
  summaryPreviewSelection,
  summaryShownAmounts,
  soldHourChartBars,
  summaryHoursView,
  summarySoldByDay,
  sumCollections,
  type ChickenVisit,
  type ExpenseRow,
  type ExpenseSummaryView,
  type SummaryExpenseInput,
  type SummaryPurchaseIntake,
  type SummaryHoursView,
  type SummaryFiadoSlice,
  type SummaryPeriod,
  type SummaryPreviewVisit,
  type SummaryShiftCard,
} from '@carniceria/shared'
import HistoryStoreSelect from '../components/HistoryStoreSelect'
import { AdminSectionHeader } from '../components/AdminSectionHeader'
import { SaleSplitChart, SoldDayBars } from '../components/SummaryCharts'
import { Button, CollapseReveal, cx } from '../components/ui'
import { formatARS } from '../lib/datetime'
import type { AdminSummaryResult, StoreRow } from '../types/hw-api'

/** Oculto hasta post 1.0. El bloque y la cuenta siguen en el código. Ver docs/POST_1.0.md. */
const SHOW_SUMMARY_BOXES = false

interface Props {
  onBack: () => void
  onLogout?: () => void
}

const PERIOD_OPTIONS: { id: SummaryPeriod; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Esta semana' },
  { id: 'month', label: 'Este mes' },
]

const EMPTY_FIADO: SummaryFiadoSlice = { debtNow: null, payments: null }

function devPreviewEnabled(): boolean {
  return import.meta.env.VITE_APP_ENV === 'dev'
}

export default function SummaryScreen({ onBack, onLogout }: Props) {
  const [stores, setStores] = useState<StoreRow[]>([])
  const [storesReady, setStoresReady] = useState(false)
  const [storesAttempt, setStoresAttempt] = useState(0)
  const [storeId, setStoreId] = useState('all')
  const [period, setPeriod] = useState<SummaryPeriod>('week')
  const [refreshToken, setRefreshToken] = useState(0)
  const [data, setData] = useState<AdminSummaryResult | null>(null)
  const [loadedExpenses, setLoadedExpenses] = useState<SummaryExpenseInput[] | null>(null)
  const [expenseLoading, setExpenseLoading] = useState(false)
  const [expenseError, setExpenseError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [storesError, setStoresError] = useState<string | null>(null)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [expenseView, setExpenseView] = useState<'fecha' | 'grupo'>('fecha')
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [provider, setProvider] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)

  const allowPreview = devPreviewEnabled()
  const previewOn = allowPreview && preview
  const queried: SummaryPeriod = period === 'today' ? 'week' : period
  const previewPack = useMemo(() => (previewOn ? summaryPreview() : null), [previewOn])

  useEffect(() => {
    if (!previewPack) {
      if (storeId !== 'all' && storesReady && !stores.some(store => store.id === storeId)) setStoreId('all')
      return
    }
    if (storeId !== 'all' && !previewPack.stores.some(store => store.id === storeId)) setStoreId('all')
  }, [previewPack, storeId, stores, storesReady])

  useEffect(() => {
    let cancelled = false
    setStoresReady(false)
    setStoresError(null)
    setLoading(true)
    void window.hw.getStores().then(result => {
      if (cancelled) return
      if (!result.ok) {
        setStoresError(result.error ?? 'No se pudieron cargar los locales.')
        return
      }
      setStores(result.data.filter(store => !store.archivedAt))
    }).finally(() => {
      if (!cancelled) setStoresReady(true)
    })
    return () => { cancelled = true }
  }, [storesAttempt])

  useEffect(() => {
    if (previewOn) {
      setLoading(false)
      setError(null)
      return
    }
    if (!storesReady || storesError) {
      if (storesReady) setLoading(false)
      return
    }
    const targets = storeId === 'all' ? stores : stores.filter(store => store.id === storeId)
    if (targets.length === 0) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }
    const range = summaryPeriodQuery(queried)
    let cancelled = false
    setLoading(true)
    setLoadedExpenses(null)
    setExpenseError(null)
    setExpenseOpen(false)
    setError(null)
    void Promise.all(targets.map(async store => ({
      store,
      result: await window.hw.getAdminSummary({
        storeId: store.id,
        startIso: range.startIso,
        endIso: range.endIso,
      }),
    }))).then(loaded => {
      if (cancelled) return
      const failed = loaded.find(item => !item.result.ok)
      if (failed && !failed.result.ok) {
        setError(failed.result.error ?? 'No se pudo armar el resumen.')
        setData(null)
        setLoading(false)
        return
      }
      const shifts: Array<SummaryShiftCard & { storeId: string }> = []
      const visits: AdminSummaryResult['visits'] = []
      const chicken: ChickenVisit[] = []
      const purchases: SummaryPurchaseIntake[] = []
      const expenseLines: AdminSummaryResult['expenses'] = []
      const slices: SummaryFiadoSlice[] = []
      for (const item of loaded) {
        if (!item.result.ok) continue
        for (const shift of item.result.data.shifts) {
          shifts.push({ ...shift, storeName: item.store.name, storeId: item.store.id })
        }
        visits.push(...item.result.data.visits)
        purchases.push(...item.result.data.purchases ?? [])
        for (const visit of item.result.data.chicken ?? []) {
          chicken.push({ ...visit, storeName: item.store.name })
        }
        for (const expense of item.result.data.expenses ?? []) {
          expenseLines.push({ ...expense, storeName: item.store.name })
        }
        slices.push(item.result.data.fiado ?? EMPTY_FIADO)
      }
      setData({ shifts, visits, chicken, purchases, expenses: expenseLines, warning: null, fiado: combineFiadoSlices(slices) })
      setOpenDay(null)
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setError('No se pudo armar el resumen.')
      setData(null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [storesReady, storesError, stores, storeId, queried, refreshToken, previewOn])

  const previousMonth = summaryMonthStep(1)
  const dates = summaryPeriodDates(period)
  const caption = formatSummaryRange(dates.startYmd, dates.endYmd)
  const storeOptions: StoreRow[] = previewPack
    ? previewPack.stores.map(store => ({ id: store.id, name: store.name }))
    : stores
  const selected = previewPack ? summaryPreviewSelection(previewPack, storeId) : null

  const shownShifts = useMemo(() => {
    const shifts = selected?.shifts ?? data?.shifts ?? []
    if (!selected) {
      return period === 'today' ? shifts.filter(shift => onCivilDay(shift.startedAt, civilYmd())) : shifts
    }
    return shifts.filter(shift => ymdInRange(civilYmd(new Date(shift.startedAt)), dates.startYmd, dates.endYmd))
  }, [selected, data, period, dates.startYmd, dates.endYmd])

  const shownVisits = useMemo(() => {
    const visits: SummaryPreviewVisit[] | AdminSummaryResult['visits'] = selected?.visits ?? data?.visits ?? []
    if (!selected) return period === 'today' ? visits.filter(visit => visit.ymd === civilYmd()) : visits
    return visits.filter(visit => ymdInRange(visit.ymd, dates.startYmd, dates.endYmd))
  }, [selected, data, period, dates.startYmd, dates.endYmd])

  const shownChicken = useMemo(() => {
    if (selected) return []
    const rows = data?.chicken ?? []
    if (period === 'today') return rows.filter(visit => visit.ymd === civilYmd())
    return rows
  }, [selected, data, period])
  const chicken = chickenTotals(shownChicken)

  const providers = useMemo(() => mediaResProviders(shownVisits), [shownVisits])
  const providerFilter = provider && providers.includes(provider) ? provider : null
  const visits = useMemo(
    () => filterMediaResProvider(shownVisits, providerFilter),
    [shownVisits, providerFilter],
  )
  const account = useMemo(() => {
    const today = civilYmd()
    const intakes = selected
      ? shownVisits.map(visit => ({
          createdAt: visit.createdAt,
          lines: [{
            costTotal: visit.cost ?? 0,
            moneyRole: visit.cost != null && visit.cost > 0 ? 'informed' as const : 'none' as const,
            mediaRes: true,
          }],
        }))
      : (data?.purchases ?? []).filter(row => period !== 'today' || onCivilDay(row.createdAt, today))
    return coverageAccount({
      fichas: shownShifts.map(shift => ({
        soldTotal: shift.soldTotal,
        expenseTotal: shift.expenseTotal,
        providerExpenseTotal: shift.providerExpenseTotal ?? null,
      })),
      intakes,
    })
  }, [selected, shownVisits, data, period, shownShifts])
  const money = useMemo(() => summaryMoneyView(shownShifts), [shownShifts])
  const payment = useMemo(() => summaryPaymentBreakdown(shownShifts), [shownShifts])
  const expenseDetail = useMemo(() => {
    if (selected) return summarizeExpenses([], [])
    const ids = new Set(shownShifts.map(shift => shift.id))
    const byId = new Map<string, SummaryExpenseInput>()
    for (const line of data?.expenses ?? []) {
      if (ids.has(line.shiftId)) byId.set(line.id, line)
    }
    for (const line of loadedExpenses ?? []) {
      if (ids.has(line.shiftId)) byId.set(line.id, line)
    }
    return summarizeExpenses([...byId.values()], shownShifts)
  }, [selected, data, shownShifts, loadedExpenses])
  const expenseTally = expenseDetail.rowTotal == null
    ? null
    : `${expenseDetail.rows.length} ${expenseDetail.rows.length === 1 ? 'gasto' : 'gastos'} · ${formatARS(expenseDetail.rowTotal)}`

  function toggleExpenseDetail(): void {
    if (expenseOpen) {
      setExpenseOpen(false)
      return
    }
    setExpenseOpen(true)
    if (!previewOn) void loadExpenseDetail()
  }

  async function loadExpenseDetail(): Promise<void> {
    const shifts = shownShifts.flatMap(shift => {
      const storeId = (shift as SummaryShiftCard & { storeId?: string }).storeId ?? ''
      if (!storeId) return []
      return [{ id: shift.id, storeId, startedAt: shift.startedAt }]
    })
    setExpenseLoading(true)
    setExpenseError(null)
    try {
      const result = await window.hw.getSummaryExpenses({ shifts })
      if (!result.ok) {
        setExpenseError(result.error ?? 'No se pudieron leer los gastos.')
        return
      }
      setLoadedExpenses(result.data)
    } catch {
      setExpenseError('No se pudieron leer los gastos.')
    } finally {
      setExpenseLoading(false)
    }
  }
  const shown = summaryShownAmounts(money)
  const soldDays = useMemo(
    () => summarySoldByDay(shownShifts, dates.startYmd, dates.endYmd),
    [shownShifts, dates.startYmd, dates.endYmd],
  )
  const days = useMemo(() => groupMediaResByDay(visits), [visits])
  const totals = mediaResTotals(visits)
  const average = mediaResAverageKg(visits)
  const newDebt = summaryNewDebt(shownShifts)
  const fiado = selected?.fiado ?? data?.fiado ?? EMPTY_FIADO
  const collections = fiado.payments
    ? sumCollections(paymentsInCivilRange(fiado.payments, dates.startYmd, dates.endYmd))
    : null
  const note = collections ? collectionNote(collections.unshifted) : null
  const moneyReady = shown.vendio != null
  const showStore = storeId === 'all'
  const ready = previewOn
    ? !loading
    : !loading && !storesError && !error && data != null
  const showHours = period === 'today' && !previewOn
  const hourView = useMemo(
    () => summaryHoursView(shownShifts, showHours ? 'today' : 'average', showStore),
    [shownShifts, showHours, showStore],
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-app text-ink">
      <AdminSectionHeader
        title="Resumen"
        subtitle={caption}
        onBack={onBack}
        onLogout={onLogout}
        actions={(
          <Button variant="secondary" size="sm" onClick={() => setRefreshToken(token => token + 1)}>
            Actualizar
          </Button>
        )}
      />
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="flex w-full flex-col gap-8 px-6 py-5">
          <div className="space-y-3">
            <p className="text-sm font-medium text-ink">Filtros</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label className="mb-1 block text-xs text-muted" htmlFor="summary-store">Local</label>
                <HistoryStoreSelect
                  id="summary-store"
                  stores={storeOptions}
                  value={storeId}
                  onChange={setStoreId}
                />
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-xs text-muted" htmlFor="summary-period">Período</label>
                <select
                  id="summary-period"
                  value={period}
                  onChange={event => {
                    const value = event.target.value
                    if (value === 'today' || value === 'week' || value === 'month' || value === 'previous') {
                      setPeriod(value)
                    }
                  }}
                  className="h-9 w-full min-w-0 truncate rounded-lg border border-line bg-input px-2 text-sm text-ink focus:border-line-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  {PERIOD_OPTIONS.map(option => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                  <option value="previous">{previousMonth.name}</option>
                </select>
                <p className="mt-1 truncate text-xs text-muted" title={caption}>{caption}</p>
              </div>
            </div>
            {allowPreview && (
              <label className="flex w-fit items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={preview}
                  onChange={event => setPreview(event.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                Datos de prueba
              </label>
            )}
          </div>

          {!previewOn && storesReady && stores.length === 0 && !loading && !storesError && (
            <p className="text-sm text-ink">No hay locales.</p>
          )}
          {!previewOn && (storesError ?? error) && (
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 truncate text-sm text-danger" title={storesError ?? error ?? ''}>{storesError ?? error}</p>
              <button
                type="button"
                onClick={() => {
                  if (storesError) setStoresAttempt(attempt => attempt + 1)
                  else setRefreshToken(token => token + 1)
                }}
                className="shrink-0 text-sm text-ink underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                Reintentar
              </button>
            </div>
          )}
          {loading && !storesError && <p className="animate-pulse text-sm text-muted">Cargando…</p>}

          {ready && (
            <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <Stat label="Vendió" value={amountText(shown.vendio)} />
                <Stat label="Gastos" value={amountText(shown.gastos)} />
                <Stat label="Tarjeta y billetera" value={amountText(shown.tarjeta)} />
                <Stat
                  label="Medias"
                  value={`${totals.count} ${totals.count === 1 ? 'media' : 'medias'} · ${formatKg3(totals.kg)}`}
                />
              </div>

              <section className="space-y-2 rounded-xl border border-line bg-panel p-4">
                <h2 className="text-sm font-semibold text-ink">Cuenta</h2>
                <MoneyRow label="Ventas" amount={account.sales} empty="sin dato" />
                <MoneyRow label="Compras" amount={account.purchases} />
                <MoneyRow label="Otros gastos" amount={account.otherExpenses} empty="sin dato" />
                <MoneyRow
                  label="Ventas menos compras y gastos"
                  amount={account.difference}
                  empty={account.shiftsLeftOut > 0 ? 'incompleta' : 'sin dato'}
                />
                {account.shiftsLeftOut > 0 && (
                  <p className="text-sm text-muted">{shiftsLeftOutText(account.shiftsLeftOut)}</p>
                )}
                {account.mediaResWithoutPrice > 0 && (
                  <p className="text-sm text-muted">{mediaResUnpricedText(account.mediaResWithoutPrice)}</p>
                )}
              </section>

              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(17rem,1fr)]">
                <section className="min-w-0 space-y-3 rounded-xl border border-line bg-panel p-4">
                  <h2 className="text-sm font-semibold text-ink">{showHours ? 'Ventas por hora' : 'Ventas por día'}</h2>
                  {showHours ? (
                    <HourChart view={hourView} emptyLabel="No hay ventas en este día" showAverage={false} />
                  ) : (
                    <>
                      <SoldDayBars bars={soldDays} />
                      {!previewOn && (
                        <div className="space-y-2 border-t border-line pt-3">
                          <h3 className="text-sm font-semibold text-ink">Ventas por hora</h3>
                          <HourChart view={hourView} emptyLabel="No hay ventas en estos días" showAverage />
                        </div>
                      )}
                    </>
                  )}
                </section>
                <section className="min-w-0 space-y-4 rounded-xl border border-line bg-panel p-4">
                  <h2 className="text-sm font-semibold text-ink">Efectivo y tarjeta</h2>
                  <div className="space-y-2">
                    <MoneyRow label="Entró en efectivo" amount={shown.efectivo} />
                    <MoneyRow label="Tarjeta y billetera" amount={shown.tarjeta} />
                    <MoneyRow label="Gastos" amount={shown.gastos} />
                    <MoneyRow label="Efectivo por digital" amount={shown.digital} />
                    <MoneyRow label="Efectivo" amount={shown.efectivo} />
                    <MoneyRow label="Débito" amount={payment.debit} empty="sin dato" />
                    <MoneyRow label="Billetera virtual" amount={payment.wallet} empty="sin dato" />
                    <MoneyRow label="Crédito" amount={payment.credit} empty="sin dato" />
                    {payment.totalOnlyCount > 0 && (
                      <p className="text-sm text-muted">
                        {payment.totalOnlyCount === 1
                          ? '1 turno solo tiene el total'
                          : `${payment.totalOnlyCount} turnos solo tienen el total`}
                      </p>
                    )}
                    {payment.gaps.map(gap => {
                      const who = shownShifts.find(shift => shift.id === gap.shiftId)?.cashierName ?? 'Un turno'
                      const text = `${who}: diferencia ${formatARS(gap.difference)}. ${gap.cause}`
                      return (
                        <p key={gap.shiftId} className="min-w-0 truncate text-sm text-muted" title={text}>
                          {text}
                        </p>
                      )
                    })}
                  </div>
                  <SaleSplitChart pending={!moneyReady} cash={shown.efectivo ?? 0} card={shown.tarjeta ?? 0} />
                </section>
              </div>

              <section className="rounded-xl border border-line bg-panel p-4">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold text-ink">Detalle de gastos</h2>
                    {expenseTally && (
                      <p className="mt-0.5 truncate text-xs tabular-nums text-muted" title={expenseTally}>{expenseTally}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {expenseOpen && (
                      <>
                        <button
                          type="button"
                          onClick={() => setExpenseView('fecha')}
                          className={`rounded-lg px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${expenseView === 'fecha' ? 'bg-hover text-ink' : 'text-muted'}`}
                        >
                          Por fecha
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpenseView('grupo')}
                          className={`rounded-lg px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${expenseView === 'grupo' ? 'bg-hover text-ink' : 'text-muted'}`}
                        >
                          Agrupado
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      aria-expanded={expenseOpen}
                      onClick={toggleExpenseDetail}
                      disabled={!previewOn && (expenseLoading || shownShifts.length === 0)}
                      className="rounded-lg border border-line px-2 py-1 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
                    >
                      {expenseOpen ? 'Ocultar detalle' : 'Ver detalle de gastos'}
                    </button>
                  </div>
                </div>
                {expenseError && (
                  <p className="mt-3 min-w-0 truncate text-sm text-danger" title={expenseError}>{expenseError}</p>
                )}
                {expenseDetail.gap && (
                  <p className="mt-3 min-w-0 truncate text-sm text-muted" title={`${formatARS(expenseDetail.gap.difference)}. ${expenseDetail.gap.cause}`}>
                    {`Diferencia ${formatARS(expenseDetail.gap.difference)}. ${expenseDetail.gap.cause}`}
                  </p>
                )}
                <CollapseReveal open={expenseOpen} className="pt-3">
                  {expenseLoading && <p className="text-sm text-muted">Leyendo gastos…</p>}
                  {expenseDetail.rows.length === 0 ? (
                    expenseDetail.gap ? null : <p className="text-sm text-muted">No hay gastos en este período.</p>
                  ) : expenseView === 'fecha' ? (
                    <ExpenseChronological rows={expenseDetail.rows} showStore={showStore} />
                  ) : (
                    <ExpenseGrouped view={expenseDetail} />
                  )}
                </CollapseReveal>
              </section>

              <section className="space-y-3 rounded-xl border border-line bg-panel p-4">
                <div className="flex min-w-0 items-baseline justify-between gap-3">
                  <h2 className="text-sm font-semibold text-ink">Medias reses</h2>
                  <p className="min-w-0 truncate text-right text-sm font-semibold text-ink" title={mediaHeading(totals, average)}>
                    {mediaHeading(totals, average)}
                  </p>
                </div>
                {providers.length > 1 && (
                  <label className="block min-w-0">
                    <span className="sr-only">Proveedor</span>
                    <select
                      aria-label="Proveedor"
                      value={providerFilter ?? ''}
                      onChange={event => setProvider(event.target.value || null)}
                      className="h-9 w-full min-w-0 truncate rounded-lg border border-line bg-input px-2 text-sm text-ink focus:border-line-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      <option value="">Todos los proveedores</option>
                      {providers.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                )}
                {days.length === 0 ? (
                  <p className="text-sm text-muted">No hay medias en este período.</p>
                ) : (
                  <div>
                    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-2 px-1 text-xs font-medium text-muted">
                      <span>Día</span>
                      <span>Medias</span>
                      <span className="text-right">Kilos</span>
                    </div>
                    <ul>
                      {days.map(day => {
                        const open = openDay === day.ymd
                        const label = `${day.ymd.slice(8, 10)}/${day.ymd.slice(5, 7)}`
                        return (
                          <li key={day.ymd} className="border-t border-line">
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() => setOpenDay(open ? null : day.ymd)}
                              className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-2 px-1 py-2 text-left hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                            >
                              <span className="text-sm font-medium text-ink">{label}</span>
                              <span className="min-w-0 truncate text-sm text-muted">{day.count}</span>
                              <span className="text-right text-sm tabular-nums text-ink">{formatKg3(day.kg)}</span>
                            </button>
                            {open && (
                              <ul className="space-y-2 px-1 pb-2">
                                {day.visits.map(visit => (
                                  <li key={visit.id} className="min-w-0">
                                    <p className="truncate text-sm text-ink" title={`${visit.providerName} · ${visit.receivedByName}`}>
                                      {visit.providerName} · {visit.receivedByName}
                                    </p>
                                    {visit.pieces.length > 0 ? (
                                      <p className="text-sm text-muted">
                                        {visit.pieces.map(piece => formatKg3(piece.kg)).join(' · ')}
                                      </p>
                                    ) : (
                                      <p className="text-sm text-muted">{visit.count} · {formatKg3(visit.kg)}</p>
                                    )}
                                    <p className="text-sm text-muted">{mediaResPriceText(visit.cost)}</p>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </section>

              <section className="space-y-3 rounded-xl border border-line bg-panel p-4">
                <div className="flex min-w-0 items-baseline justify-between gap-3">
                  <h2 className="text-sm font-semibold text-ink">Pollo</h2>
                  {shownChicken.length > 0 && (
                    <p className="min-w-0 truncate text-right text-sm font-semibold text-ink" title={chickenHeading(chicken)}>
                      {chickenHeading(chicken)}
                    </p>
                  )}
                </div>
                {shownChicken.length === 0 ? (
                  <p className="text-sm text-muted">No hay pollo en este período.</p>
                ) : (
                  <div>
                    <div className="grid grid-cols-[4.5rem_minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] gap-2 px-1 text-xs font-medium text-muted">
                      <span>Fecha</span>
                      <span>Proveedor</span>
                      <span>Local</span>
                      <span className="text-right">Cajones</span>
                      <span className="text-right">Kilos brutos</span>
                    </div>
                    <ul>
                      {shownChicken.map(visit => {
                        const label = `${visit.ymd.slice(8, 10)}/${visit.ymd.slice(5, 7)}`
                        const storeLabel = visit.storeName?.trim() ?? ''
                        return (
                          <li
                            key={visit.id}
                            className="grid grid-cols-[4.5rem_minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] items-center gap-2 border-t border-line px-1 py-2"
                          >
                            <span className="text-sm font-medium text-ink">{label}</span>
                            <span className="min-w-0 truncate text-sm text-ink" title={visit.providerName}>
                              {visit.providerName}
                            </span>
                            <span className="min-w-0 truncate text-sm text-muted" title={storeLabel}>
                              {storeLabel}
                            </span>
                            <span className="text-right text-sm tabular-nums text-ink">{visit.crates}</span>
                            <span className="text-right text-sm tabular-nums text-ink">{formatKg3(visit.grossKg)}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </section>

              {SHOW_SUMMARY_BOXES && <section className="space-y-3 rounded-xl border border-line bg-panel p-4">
                <h2 className="text-sm font-semibold text-ink">Cajas</h2>
                {money.boxes.length === 0 ? (
                  <p className="text-sm text-muted">No hay turnos cerrados.</p>
                ) : (
                  <>
                    <p className="text-sm text-muted">
                      {summaryBoxTally(money.boxes.map(row => row.box))
                        .map(item => `${item.count} ${item.label}`)
                        .join(' · ')}
                    </p>
                    <ul className="space-y-1">
                      {money.boxes.map(row => {
                        const label = summaryBoxLabel(row, showStore)
                        const status = shiftCloseBoxText(row.box, formatARS)
                        const aporte = boxAporteAmount(row)
                        const detail = aporte == null ? status : `${status} · Aportes ${formatARS(aporte)}`
                        return (
                          <li key={row.id} className="flex min-w-0 items-baseline gap-2 py-1">
                            <span className="min-w-0 flex-1 truncate text-sm text-ink" title={label}>{label}</span>
                            <span className={`shrink-0 text-sm font-medium tabular-nums ${boxClass(row.box.kind)}`}>{detail}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
              </section>}

              <section className="space-y-2 rounded-xl border border-line bg-panel p-4">
                <h2 className="text-sm font-semibold text-ink">Fiados y cobranzas</h2>
                <MoneyRow label="Fiado nuevo" amount={newDebt} empty="todavía no llegó" />
                <MoneyRow label="Cobros del período" amount={collections ? collections.total : null} empty="pendiente" />
                {note && <p className="text-sm text-ink">{note}</p>}
                <MoneyRow label="Deuda de ahora" amount={fiado.debtNow} empty="pendiente" />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const EXPENSE_COLS = 'grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_9.25rem_7.5rem_minmax(0,0.9fr)_minmax(4.5rem,0.7fr)]'
const EXPENSE_COLS_ONE_STORE = 'grid-cols-[minmax(0,1.8fr)_minmax(0,1.15fr)_9.25rem_7.5rem_minmax(0,1fr)]'
const EXPENSE_AMOUNT_COL = 'grid-cols-[minmax(0,1fr)_9.25rem]'

function expenseDayLabel(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
}

function expenseDays(rows: ExpenseRow[]): { ymd: string; rows: ExpenseRow[] }[] {
  const days: { ymd: string; rows: ExpenseRow[] }[] = []
  for (const row of rows) {
    const last = days[days.length - 1]
    if (!last || last.ymd !== row.ymd) days.push({ ymd: row.ymd, rows: [row] })
    else last.rows.push(row)
  }
  return days
}

function ExpenseChronological({ rows, showStore }: { rows: ExpenseRow[]; showStore: boolean }) {
  const cols = showStore ? EXPENSE_COLS : EXPENSE_COLS_ONE_STORE
  return (
    <div className={cx('grid gap-x-3', cols)} role="table">
      <div className={cx('col-span-full grid grid-cols-subgrid items-end px-1 pb-1 text-xs font-medium text-muted')} role="row">
        <span>Concepto</span>
        <span>Proveedor</span>
        <span className="text-right">Monto</span>
        <span>Origen</span>
        <span>Nota</span>
        {showStore && <span>Local</span>}
      </div>
      {expenseDays(rows).map(day => (
        <div key={day.ymd} className="col-span-full grid grid-cols-subgrid">
          <p className="col-span-full border-t border-line px-1 pb-1 pt-2 text-xs font-medium tabular-nums text-muted">
            {expenseDayLabel(day.ymd)}
          </p>
          {day.rows.map(row => {
            const note = row.notes ?? ''
            return (
              <div
                key={row.id}
                role="row"
                className="col-span-full grid grid-cols-subgrid items-center border-t border-line px-1 py-1.5"
              >
                <span className="min-w-0 truncate text-sm text-ink" title={row.concept}>{row.concept}</span>
                <span className="min-w-0 truncate text-sm text-muted" title={row.providerName}>{row.providerName}</span>
                <span className="whitespace-nowrap text-right text-sm tabular-nums text-ink">{formatARS(row.amount)}</span>
                <span className="min-w-0 truncate text-sm text-ink" title={row.origin}>{row.origin}</span>
                <span className="min-w-0 truncate text-sm text-muted" title={note}>{note}</span>
                {showStore && (
                  <span className="min-w-0 truncate text-sm text-muted" title={row.storeName}>{row.storeName}</span>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function ExpenseGrouped({ view }: { view: ExpenseSummaryView }) {
  return (
    <div className="space-y-4">
      <ExpenseAmountList
        title="Por origen"
        rows={view.byOrigin.map(item => ({ key: item.origin, label: item.origin, amount: item.amount }))}
      />
      <ExpenseAmountList title="Por proveedor" rows={view.byProvider} />
      <ExpenseAmountList title="Por concepto" rows={view.byConcept} />
    </div>
  )
}

function ExpenseAmountList({
  title,
  rows,
}: {
  title: string
  rows: { key: string; label: string; amount: number }[]
}) {
  return (
    <div>
      <p className="mb-1 px-1 text-xs font-medium text-muted">{title}</p>
      <ul className={cx('grid gap-x-3', EXPENSE_AMOUNT_COL)}>
        {rows.map(row => (
          <li key={row.key} className="col-span-2 grid grid-cols-subgrid items-baseline border-t border-line px-1 py-1.5">
            <span className="min-w-0 truncate text-sm text-ink" title={row.label}>{row.label}</span>
            <span className="whitespace-nowrap text-right text-sm tabular-nums text-ink">{formatARS(row.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function incompleteDayText(count: number): string | null {
  if (count <= 0) return null
  if (count === 1) return '1 día no se contó por estar incompleto'
  return `${count} días no se contaron por estar incompletos`
}

function HourChart({
  view,
  emptyLabel,
  showAverage,
}: {
  view: SummaryHoursView
  emptyLabel: string
  showAverage: boolean
}) {
  const bars = view.buckets ? soldHourChartBars(view.buckets) : []
  const showChart = !view.missing && bars.length > 0
  const showEmpty = !view.missing && !showChart && (view.buckets != null || view.openNotices.length === 0)
  const peak = showAverage && view.peak && view.peak.amount > 0
    ? `Pico: ${view.peak.hour}h · ${formatARS(view.peak.amount)}`
    : null
  const incomplete = showAverage ? incompleteDayText(view.incompleteDayCount) : null
  return (
    <div className="space-y-2">
      {view.missing && <p className="text-sm text-muted">sin dato</p>}
      {showEmpty && <p className="text-sm text-muted">{emptyLabel}</p>}
      {showChart && (
        <>
          {showAverage && (
            <p className="text-sm text-muted">Cada hora es la media de los días completos</p>
          )}
          <SoldDayBars bars={bars} caption="Vendido por hora" />
        </>
      )}
      {peak && <p className="text-sm text-muted">{peak}</p>}
      {incomplete && <p className="text-sm text-muted">{incomplete}</p>}
      {view.openNotices.map(notice => (
        <p key={notice.id} className="min-w-0 truncate text-sm text-muted" title={notice.text}>
          {notice.text}
        </p>
      ))}
    </div>
  )
}

function amountText(amount: number | null): string {
  return amount == null ? 'todavía no llegó' : formatARS(amount)
}

function mediaResPriceText(cost: number | null | undefined): string {
  return cost != null && cost > 0 ? formatARS(cost) : 'sin precio'
}

function shiftsLeftOutText(count: number): string {
  if (count === 1) {
    return '1 turno quedó afuera: la ficha no tiene el dato de gastos a proveedores.'
  }
  return `${count} turnos quedaron afuera: las fichas no tienen el dato de gastos a proveedores.`
}

function mediaResUnpricedText(count: number): string {
  return count === 1
    ? '1 ingreso de media res sin precio no suma'
    : `${count} ingresos de media res sin precio no suman`
}

function chickenHeading(totals: { crates: number; grossKg: number }): string {
  const crates = `${totals.crates} ${totals.crates === 1 ? 'cajón' : 'cajones'}`
  return `${crates} · ${formatKg3(totals.grossKg)} brutos`
}

function mediaHeading(
  totals: { count: number; kg: number },
  average: number | null,
): string {
  const base = `${totals.count} ${totals.count === 1 ? 'media' : 'medias'} · ${formatKg3(totals.kg)}`
  if (average == null) return base
  return `${base} · promedio ${formatKg3(average)}`
}

function boxClass(kind: string): string {
  if (kind === 'matched') return 'text-success'
  if (kind === 'difference') return 'text-danger'
  return 'text-muted'
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-panel px-4 py-3">
      <p className="truncate text-xs font-medium text-muted" title={label}>{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums tracking-tight text-ink" title={value}>{value}</p>
    </div>
  )
}

function MoneyRow({
  label,
  amount,
  empty = 'todavía no llegó',
}: {
  label: string
  amount: number | null
  empty?: string
}) {
  const text = amount == null ? empty : formatARS(amount)
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <span className="min-w-0 flex-1 truncate text-sm text-ink" title={label}>{label}</span>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{text}</span>
    </div>
  )
}
