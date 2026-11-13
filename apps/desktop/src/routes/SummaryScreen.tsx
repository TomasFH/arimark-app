/**
 * Resumen del admin. Arranca en todos los locales y en esta semana.
 * Hoy filtra esa semana, sin otra consulta. El mes corta por el lunes.
 * El modo de prueba solo existe con VITE_APP_ENV=dev y no consulta ni escribe.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  boxAporteAmount,
  civilYmd,
  collectionNote,
  combineFiadoSlices,
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
  summaryPeriodDates,
  summaryPeriodQuery,
  ymdInRange,
  summaryPreview,
  summaryPreviewSelection,
  summaryShownAmounts,
  summarySoldByDay,
  sumCollections,
  type SummaryFiadoSlice,
  type SummaryPeriod,
  type SummaryPreviewVisit,
  type SummaryShiftCard,
} from '@carniceria/shared'
import HistoryStoreSelect from '../components/HistoryStoreSelect'
import { AdminSectionHeader } from '../components/AdminSectionHeader'
import { SaleSplitChart, SoldDayBars } from '../components/SummaryCharts'
import { Button } from '../components/ui'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [storesError, setStoresError] = useState<string | null>(null)
  const [openDay, setOpenDay] = useState<string | null>(null)
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
      const shifts: SummaryShiftCard[] = []
      const visits: AdminSummaryResult['visits'] = []
      const slices: SummaryFiadoSlice[] = []
      for (const item of loaded) {
        if (!item.result.ok) continue
        for (const shift of item.result.data.shifts) {
          shifts.push({ ...shift, storeName: item.store.name })
        }
        visits.push(...item.result.data.visits)
        slices.push(item.result.data.fiado ?? EMPTY_FIADO)
      }
      setData({ shifts, visits, warning: null, fiado: combineFiadoSlices(slices) })
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

  const providers = useMemo(() => mediaResProviders(shownVisits), [shownVisits])
  const providerFilter = provider && providers.includes(provider) ? provider : null
  const visits = useMemo(
    () => filterMediaResProvider(shownVisits, providerFilter),
    [shownVisits, providerFilter],
  )
  const money = useMemo(() => summaryMoneyView(shownShifts), [shownShifts])
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

              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(17rem,1fr)]">
                <section className="min-w-0 space-y-3 rounded-xl border border-line bg-panel p-4">
                  <h2 className="text-sm font-semibold text-ink">Ventas por día</h2>
                  <SoldDayBars bars={soldDays} />
                </section>
                <section className="min-w-0 space-y-4 rounded-xl border border-line bg-panel p-4">
                  <h2 className="text-sm font-semibold text-ink">Efectivo y tarjeta</h2>
                  <div className="space-y-2">
                    <MoneyRow label="Entró en efectivo" amount={shown.efectivo} />
                    <MoneyRow label="Tarjeta y billetera" amount={shown.tarjeta} />
                    <MoneyRow label="Gastos" amount={shown.gastos} />
                    <MoneyRow label="Efectivo por digital" amount={shown.digital} />
                  </div>
                  <SaleSplitChart pending={!moneyReady} cash={shown.efectivo ?? 0} card={shown.tarjeta ?? 0} />
                </section>
              </div>

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

function amountText(amount: number | null): string {
  return amount == null ? 'todavía no llegó' : formatARS(amount)
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
