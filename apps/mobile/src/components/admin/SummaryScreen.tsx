/**
 * Resumen del admin en el celu. Arranca en todos los locales y en esta semana.
 * Hoy filtra esa semana, sin otra consulta. El mes corta por el lunes.
 * Cobros y deuda de ahora no se piden: no hay índice y no se baja el libro.
 * El modo de prueba solo existe con VITE_APP_ENV=dev y no consulta ni escribe.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  boxAporteAmount,
  civilYmd,
  collectionNote,
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
  type SummaryPeriod,
  type SummaryShiftCard,
} from '@carniceria/shared'
import { useBackLayer } from '../../lib/backStack'
import { formatMoney, type StoreDoc } from '../../lib/adminFirestore'
import { loadMobileSummary, type MobileSummary } from '../../lib/adminSummary'
import { ScreenHeader } from './shared'
import { SaleSplitChart, SoldDayBars } from './SummaryCharts'

/** Oculto hasta post 1.0. El bloque y la cuenta siguen en el código. Ver docs/POST_1.0.md. */
const SHOW_SUMMARY_BOXES = false

interface Props {
  onBack: () => void
  stores: StoreDoc[]
}

const PERIOD_OPTIONS: { id: SummaryPeriod; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Esta semana' },
  { id: 'month', label: 'Este mes' },
]

const FIELD = 'h-10 w-full min-w-0 truncate rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d4c]/40'

function devPreviewEnabled(): boolean {
  return import.meta.env.VITE_APP_ENV === 'dev'
}

export function SummaryScreen({ onBack, stores }: Props) {
  useBackLayer(true, onBack)
  const [storeId, setStoreId] = useState('')
  const [period, setPeriod] = useState<SummaryPeriod>('week')
  const [refreshToken, setRefreshToken] = useState(0)
  const [data, setData] = useState<MobileSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [openPieceDay, setOpenPieceDay] = useState<string | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)

  const allowPreview = devPreviewEnabled()
  const previewOn = allowPreview && preview
  const active = useMemo(() => stores.filter(store => !store.archivedAt), [stores])
  const queried: SummaryPeriod = period === 'today' ? 'week' : period
  const previewPack = useMemo(() => (previewOn ? summaryPreview() : null), [previewOn])

  useEffect(() => {
    if (previewPack) {
      if (storeId !== '' && !previewPack.stores.some(store => store.id === storeId)) setStoreId('')
      return
    }
    if (storeId === '') return
    if (active.some(store => store.id === storeId)) return
    setStoreId('')
  }, [storeId, active, previewPack])

  useEffect(() => {
    if (previewOn) {
      setLoading(false)
      setError(null)
      return
    }
    const targets = storeId === '' ? active : active.filter(store => store.id === storeId)
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
      result: await loadMobileSummary(store.id, range.startIso, range.endIso),
    }))).then(loaded => {
      if (cancelled) return
      const shifts: SummaryShiftCard[] = []
      const visits: MobileSummary['visits'] = []
      const delantero: MobileSummary['delantero'] = []
      for (const item of loaded) {
        for (const shift of item.result.shifts) {
          shifts.push({ ...shift, storeName: item.store.name })
        }
        visits.push(...item.result.visits)
        delantero.push(...(item.result.delantero ?? []))
      }
      setData({ shifts, visits, delantero, warning: null })
      setOpenDay(null)
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setError('No se pudo armar el resumen.')
      setData(null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [storeId, active, queried, refreshToken, previewOn])

  const previousMonth = summaryMonthStep(1)
  const dates = summaryPeriodDates(period)
  const caption = formatSummaryRange(dates.startYmd, dates.endYmd)
  const selected = previewPack ? summaryPreviewSelection(previewPack, storeId || 'all') : null
  const storeOptions = previewPack ? previewPack.stores : active

  const shownShifts = useMemo(() => {
    const shifts = selected?.shifts ?? data?.shifts ?? []
    if (!selected) {
      return period === 'today' ? shifts.filter(shift => onCivilDay(shift.startedAt, civilYmd())) : shifts
    }
    return shifts.filter(shift => ymdInRange(civilYmd(new Date(shift.startedAt)), dates.startYmd, dates.endYmd))
  }, [selected, data, period, dates.startYmd, dates.endYmd])
  const shownVisits = useMemo(() => {
    const visits = selected?.visits ?? data?.visits ?? []
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
  const shownDelantero = useMemo(() => {
    if (selected) return []
    const rows = data?.delantero ?? []
    if (period === 'today') return rows.filter(visit => visit.ymd === civilYmd())
    return rows
  }, [selected, data, period])
  const pieceDays = useMemo(() => groupMediaResByDay(shownDelantero), [shownDelantero])
  const pieceTotals = mediaResTotals(shownDelantero)
  const pieceAverage = mediaResAverageKg(shownDelantero)
  const newDebt = summaryNewDebt(shownShifts)
  const collections = previewOn && selected?.fiado.payments
    ? sumCollections(paymentsInCivilRange(selected.fiado.payments, dates.startYmd, dates.endYmd))
    : null
  const debtNow = previewOn ? (selected?.fiado.debtNow ?? null) : null
  const note = collections ? collectionNote(collections.unshifted) : null
  const moneyReady = shown.vendio != null
  const showStore = storeId === ''
  const ready = previewOn ? !loading : !loading && !error && data != null

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <ScreenHeader
        title="Resumen"
        subtitle={caption}
        onBack={onBack}
        action={(
          <button
            type="button"
            onClick={() => setRefreshToken(token => token + 1)}
            className="shrink-0 text-sm text-zinc-300"
          >
            Actualizar
          </button>
        )}
      />
      <main className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
        <div className="space-y-3">
          <p className="text-sm font-medium text-zinc-100">Filtros</p>
          <label className="block min-w-0" htmlFor="summary-store">
            <span className="mb-1 block text-xs text-zinc-400">Local</span>
            <select
              id="summary-store"
              value={storeId}
              onChange={event => setStoreId(event.target.value)}
              className={FIELD}
            >
              <option value="">Todos los locales</option>
              {storeOptions.map(store => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </label>
          <label className="block min-w-0" htmlFor="summary-period">
            <span className="mb-1 block text-xs text-zinc-400">Período</span>
            <select
              id="summary-period"
              value={period}
              onChange={event => {
                const value = event.target.value
                if (value === 'today' || value === 'week' || value === 'month' || value === 'previous') {
                  setPeriod(value)
                }
              }}
              className={FIELD}
            >
              {PERIOD_OPTIONS.map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
              <option value="previous">{previousMonth.name}</option>
            </select>
            <span className="mt-1 block truncate text-xs text-zinc-400" title={caption}>{caption}</span>
          </label>
          {allowPreview && (
            <label className="flex w-fit items-center gap-2 text-sm text-zinc-100">
              <input
                type="checkbox"
                checked={preview}
                onChange={event => setPreview(event.target.checked)}
                className="h-4 w-4 accent-[#e85d4c]"
              />
              Datos de prueba
            </label>
          )}
        </div>

        {!previewOn && active.length === 0 && <p className="text-sm text-zinc-100">No hay locales.</p>}
        {!previewOn && error && (
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 truncate text-sm text-red-400" title={error}>{error}</p>
            <button type="button" onClick={() => setRefreshToken(token => token + 1)} className="shrink-0 text-sm text-zinc-100 underline">
              Reintentar
            </button>
          </div>
        )}
        {loading && <p className="animate-pulse text-sm text-zinc-400">Cargando…</p>}
        {ready && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Vendió" value={amountText(shown.vendio)} />
              <Stat label="Gastos" value={amountText(shown.gastos)} />
              <Stat label="Tarjeta y billetera" value={amountText(shown.tarjeta)} />
              <Stat
                label="Medias"
                value={`${totals.count} ${totals.count === 1 ? 'media' : 'medias'} · ${formatKg3(totals.kg)}`}
              />
            </div>
            <section className="min-w-0 space-y-3 rounded-xl border border-zinc-700 bg-zinc-800 p-4">
              <h2 className="text-sm font-semibold text-zinc-100">Ventas por día</h2>
              <SoldDayBars bars={soldDays} />
            </section>
            <section className="space-y-4 rounded-xl border border-zinc-700 bg-zinc-800 p-4">
              <h2 className="text-sm font-semibold text-zinc-100">Efectivo y tarjeta</h2>
              <div className="space-y-2">
                <MoneyRow label="Entró en efectivo" amount={shown.efectivo} />
                <MoneyRow label="Tarjeta y billetera" amount={shown.tarjeta} />
                <MoneyRow label="Gastos" amount={shown.gastos} />
                <MoneyRow label="Efectivo por digital" amount={shown.digital} />
              </div>
              <SaleSplitChart pending={!moneyReady} cash={shown.efectivo ?? 0} card={shown.tarjeta ?? 0} />
            </section>
            <section className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-800 p-4">
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <h2 className="shrink-0 text-sm font-semibold text-zinc-100">Medias reses</h2>
                <p className="min-w-0 truncate text-right text-sm font-semibold text-zinc-100" title={mediaHeading(totals, average)}>
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
                    className={FIELD}
                  >
                    <option value="">Todos los proveedores</option>
                    {providers.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </label>
              )}
              {days.length === 0 ? (
                <p className="text-sm text-zinc-400">No hay medias en este período.</p>
              ) : (
                <ul className="space-y-1">
                  {days.map(day => {
                    const open = openDay === day.ymd
                    const label = `${day.ymd.slice(8, 10)}/${day.ymd.slice(5, 7)}`
                    return (
                      <li key={day.ymd} className="rounded-lg border border-zinc-700">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setOpenDay(open ? null : day.ymd)}
                          className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left"
                        >
                          <span className="shrink-0 text-sm font-medium text-zinc-100">{label}</span>
                          <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">
                            {day.count} {day.count === 1 ? 'media' : 'medias'}
                          </span>
                          <span className="shrink-0 text-sm text-zinc-100">{formatKg3(day.kg)}</span>
                        </button>
                        {open && (
                          <ul className="space-y-2 border-t border-zinc-700 px-3 py-2">
                            {day.visits.map(visit => (
                              <li key={visit.id} className="min-w-0">
                                <p className="truncate text-sm text-zinc-100" title={`${visit.providerName} · ${visit.receivedByName}`}>
                                  {visit.providerName} · {visit.receivedByName}
                                </p>
                                {visit.pieces.length > 0 ? (
                                  <p className="text-sm text-zinc-400">{visit.pieces.map(piece => formatKg3(piece.kg)).join(' · ')}</p>
                                ) : (
                                  <p className="text-sm text-zinc-400">{visit.count} · {formatKg3(visit.kg)}</p>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
            <section className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-800 p-4">
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <h2 className="shrink-0 text-sm font-semibold text-zinc-100">Delantero</h2>
                {(pieceTotals.count > 0 || pieceTotals.kg > 0) && (
                  <p className="min-w-0 truncate text-right text-sm font-semibold text-zinc-100" title={pieceHeading(pieceTotals, pieceAverage)}>
                    {pieceHeading(pieceTotals, pieceAverage)}
                  </p>
                )}
              </div>
              {pieceDays.length === 0 ? (
                <p className="text-sm text-zinc-400">No hay delantero en este período.</p>
              ) : (
                <ul className="space-y-1">
                  {pieceDays.map(day => {
                    const open = openPieceDay === day.ymd
                    const label = `${day.ymd.slice(8, 10)}/${day.ymd.slice(5, 7)}`
                    return (
                      <li key={day.ymd} className="rounded-lg border border-zinc-700">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setOpenPieceDay(open ? null : day.ymd)}
                          className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left"
                        >
                          <span className="shrink-0 text-sm font-medium text-zinc-100">{label}</span>
                          <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">
                            {day.count} {day.count === 1 ? 'pieza' : 'piezas'}
                          </span>
                          <span className="shrink-0 text-sm text-zinc-100">{formatKg3(day.kg)}</span>
                        </button>
                        {open && (
                          <ul className="space-y-2 border-t border-zinc-700 px-3 py-2">
                            {day.visits.map(visit => (
                              <li key={visit.id} className="min-w-0">
                                <p className="truncate text-sm text-zinc-100" title={`${visit.providerName} · ${visit.receivedByName}`}>
                                  {visit.providerName} · {visit.receivedByName}
                                </p>
                                {visit.pieces.length > 0 ? (
                                  <p className="text-sm text-zinc-400">{visit.pieces.map(piece => formatKg3(piece.kg)).join(' · ')}</p>
                                ) : (
                                  <p className="text-sm text-zinc-400">{visit.count} · {formatKg3(visit.kg)}</p>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
            {SHOW_SUMMARY_BOXES && <section className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-800 p-4">
              <h2 className="text-sm font-semibold text-zinc-100">Cajas</h2>
              {money.boxes.length === 0 ? (
                <p className="text-sm text-zinc-400">No hay turnos cerrados.</p>
              ) : (
                <>
                  <p className="text-sm text-zinc-400">
                    {summaryBoxTally(money.boxes.map(row => row.box)).map(item => `${item.count} ${item.label}`).join(' · ')}
                  </p>
                  <ul className="space-y-1">
                    {money.boxes.map(row => {
                      const label = summaryBoxLabel(row, showStore)
                      const status = shiftCloseBoxText(row.box, formatMoney)
                      const aporte = boxAporteAmount(row)
                      const detail = aporte == null ? status : `${status} · Aportes ${formatMoney(aporte)}`
                      return (
                        <li key={row.id} className="flex min-w-0 items-baseline gap-2 py-1">
                          <span className="min-w-0 flex-1 truncate text-sm text-zinc-100" title={label}>{label}</span>
                          <span className={`shrink-0 text-sm font-medium tabular-nums ${boxClass(row.box.kind)}`}>{detail}</span>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </section>}
            <section className="space-y-2 rounded-xl border border-zinc-700 bg-zinc-900 p-4">
              <h2 className="text-sm font-semibold text-zinc-100">Fiados y cobranzas</h2>
              <MoneyRow label="Fiado nuevo" amount={newDebt} empty="todavía no llegó" />
              <MoneyRow label="Cobros del período" amount={collections ? collections.total : null} empty="pendiente" />
              {note && <p className="text-sm text-zinc-100">{note}</p>}
              <MoneyRow label="Deuda de ahora" amount={debtNow} empty="pendiente" />
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function amountText(amount: number | null): string {
  return amount == null ? 'todavía no llegó' : formatMoney(amount)
}

function mediaHeading(
  totals: { count: number; kg: number },
  average: number | null,
): string {
  const base = `${totals.count} ${totals.count === 1 ? 'media' : 'medias'} · ${formatKg3(totals.kg)}`
  if (average == null) return base
  return `${base} · promedio ${formatKg3(average)}`
}

function pieceHeading(
  totals: { count: number; kg: number },
  average: number | null,
): string {
  const base = `${totals.count} ${totals.count === 1 ? 'pieza' : 'piezas'} · ${formatKg3(totals.kg)}`
  if (average == null) return base
  return `${base} · promedio ${formatKg3(average)}`
}

function boxClass(kind: string): string {
  if (kind === 'matched') return 'text-emerald-300'
  if (kind === 'difference') return 'text-red-400'
  return 'text-zinc-400'
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3">
      <p className="truncate text-xs font-medium text-zinc-400" title={label}>{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums text-zinc-100" title={value}>{value}</p>
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
  const text = amount == null ? empty : formatMoney(amount)
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-100" title={label}>{label}</span>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-100">{text}</span>
    </div>
  )
}
