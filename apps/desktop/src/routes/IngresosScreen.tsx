/**
 * Mercadería recibida: una fila por visita, con el precio de cada producto.
 * La cajera entra en solo lectura y el proceso principal ya le sacó el monto de la media res.
 * Una semana en pantalla. No precarga las vecinas.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  formatMerchCostUnit,
  formatMerchVisitQty,
  formatWeekRangeLabel,
  isMediaResLine,
  mondayWeekRange,
} from '@carniceria/shared'
import type { MerchIntakeLineSnapshot } from '@carniceria/shared'
import { AdminSectionHeader } from '../components/AdminSectionHeader'
import HistoryStoreSelect from '../components/HistoryStoreSelect'
import NumericInput from '../components/NumericInput'
import { Button } from '../components/ui'
import { formatARS, toVisitDayLabel, toVisitTime, utcToLocalYmd } from '../lib/datetime'
import { formatNumericInputValue, parseNumericInput } from '../lib/numericInput'
import type { MerchWeekBookResult, StoreRow } from '../types/hw-api'

const MIN_WEEK_OFFSET = -104

interface Props {
  onBack: () => void
  onLogout: () => void
  /** El admin anota el monto de la media res. La cajera no lo ve ni lo edita. */
  canPriceMediaRes: boolean
}

function providerKey(providerId: string | null, providerName: string): string {
  return providerId ? `id:${providerId}` : `name:${providerName}`
}

/** 0 no es un precio: es un monto que todavía no se cargó. */
function priceText(amount: number): string {
  return amount > 0 ? formatARS(amount) : 'sin precio'
}

function visitCost(lines: MerchIntakeLineSnapshot[]): number {
  return lines.reduce((sum, line) => sum + (line.costTotal > 0 ? Math.round(line.costTotal) : 0), 0)
}

type VisitRow = {
  providerName: string
  delivery: MerchWeekBookResult['providers'][number]['deliveries'][number]
}

interface DayGroup {
  ymd: string
  label: string
  total: number
  paid: number
  debt: number
  unpriced: number
  visits: VisitRow[]
}

/** Una entrega sin precio no entra en el total del día. Pagado y deuda sí, porque son montos. */
function groupVisitsByDay(visits: VisitRow[]): DayGroup[] {
  const groups = new Map<string, DayGroup>()
  for (const row of visits) {
    const ymd = utcToLocalYmd(row.delivery.createdAt)
    let group = groups.get(ymd)
    if (!group) {
      group = {
        ymd,
        label: toVisitDayLabel(row.delivery.createdAt),
        total: 0,
        paid: 0,
        debt: 0,
        unpriced: 0,
        visits: [],
      }
      groups.set(ymd, group)
    }
    const cost = visitCost(row.delivery.lines)
    if (cost > 0) group.total += cost
    else group.unpriced += 1
    group.paid += row.delivery.paid
    group.debt += row.delivery.debt
    group.visits.push(row)
  }
  return [...groups.values()].sort((a, b) => b.ymd.localeCompare(a.ymd))
}

function unpricedLabel(count: number): string | null {
  if (count <= 0) return null
  return count === 1 ? '1 sin precio' : `${count} sin precio`
}

function DayChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-150 ease-out ${open ? 'rotate-90' : ''}`}
    >
      <path
        d="M6 3.5 11 8 6 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const VISIT_GRID = 'grid w-full min-w-max grid-cols-[max-content_max-content_max-content_minmax(7rem,1fr)_minmax(7rem,1fr)_minmax(8.5rem,1fr)] gap-x-6'

function MediaResPaidEditor({
  line,
  onSaved,
}: {
  line: MerchIntakeLineSnapshot
  onSaved: () => void
}) {
  const priced = line.moneyRole !== 'none' && line.costTotal > 0
  const [raw, setRaw] = useState(() => (priced ? formatNumericInputValue(String(line.costTotal)) : ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRaw(priced ? formatNumericInputValue(String(line.costTotal)) : '')
    setError(null)
  }, [line.id, line.costTotal, line.moneyRole, priced])

  async function save(): Promise<void> {
    const parsed = parseNumericInput(raw)
    setSaving(true)
    setError(null)
    const result = await window.hw.setMediaResDeliveryPaid({
      lineId: line.id,
      amount: parsed != null && parsed > 0 ? parsed : null,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error ?? 'No se pudo guardar el monto.')
      return
    }
    onSaved()
  }

  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="text-xs text-muted">Monto pagado por la entrega</span>
        <NumericInput
          value={raw}
          onChange={setRaw}
          disabled={saving}
          className="w-full rounded-lg border border-line bg-app px-3 py-2 text-sm text-ink"
        />
      </label>
      <p className="text-xs text-muted">{priced ? 'Costo informado. No sale de caja.' : 'Sin precio. No sale de caja.'}</p>
      {error && <p className="truncate text-xs text-danger" title={error}>{error}</p>}
      <Button variant="secondary" disabled={saving} onClick={() => { void save() }}>
        Guardar monto
      </Button>
    </div>
  )
}

export default function IngresosScreen({ onBack, onLogout, canPriceMediaRes }: Props) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [storeIdFilter, setStoreIdFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [stores, setStores] = useState<StoreRow[]>([])
  const [book, setBook] = useState<MerchWeekBookResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set())
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set())
  const [revision, setRevision] = useState(0)

  const week = mondayWeekRange(weekOffset)
  const weekTitle = formatWeekRangeLabel(week.startYmd, week.endInclusiveYmd)

  useEffect(() => {
    void window.hw.getStores().then(result => {
      if (result.ok) setStores(result.data)
    })
  }, [])

  useEffect(() => {
    setBook(null)
    setOpenKeys(new Set())
  }, [weekOffset, storeIdFilter])

  useEffect(() => {
    if (!book || providerFilter === 'all') return
    const keys = book.providers.map(provider => providerKey(provider.providerId, provider.providerName))
    if (!keys.includes(providerFilter)) setProviderFilter('all')
  }, [book, providerFilter])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void window.hw.listMerchWeek({ weekOffset, storeIdFilter }).then(result => {
      if (cancelled) return
      setLoading(false)
      if (!result.ok) {
        setError(result.error)
        setBook(null)
        return
      }
      setBook(result.data)
    })
    return () => { cancelled = true }
  }, [weekOffset, storeIdFilter, revision])

  function changeWeek(next: number) {
    const clamped = Math.max(MIN_WEEK_OFFSET, Math.min(0, next))
    if (clamped === weekOffset) return
    setWeekOffset(clamped)
  }

  function toggleDay(ymd: string) {
    setOpenDays(current => {
      const next = new Set(current)
      if (next.has(ymd)) next.delete(ymd)
      else next.add(ymd)
      return next
    })
  }

  function toggleVisit(id: string) {
    setOpenKeys(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visits = useMemo(() => {
    const rows: VisitRow[] = []
    for (const provider of book?.providers ?? []) {
      const key = providerKey(provider.providerId, provider.providerName)
      if (providerFilter !== 'all' && key !== providerFilter) continue
      for (const delivery of provider.deliveries) {
        rows.push({ providerName: provider.providerName, delivery })
      }
    }
    rows.sort((a, b) => b.delivery.createdAt.localeCompare(a.delivery.createdAt))
    return rows
  }, [book, providerFilter])

  const dayGroups = useMemo(() => groupVisitsByDay(visits), [visits])
  const daySignature = dayGroups.map(day => day.ymd).join('|')

  useEffect(() => {
    const newest = daySignature.split('|')[0] ?? ''
    setOpenDays(newest ? new Set([newest]) : new Set())
  }, [daySignature])

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-app text-ink">
      <AdminSectionHeader
        title="Mercadería recibida"
        subtitle="Una fila por visita"
        onBack={onBack}
        onLogout={onLogout}
      />

      <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto w-full max-w-5xl space-y-5 px-8 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {stores.length > 0 && (
              <div className="min-w-0">
                <label className="mb-1 block text-xs text-muted" htmlFor="ingresos-store">Local</label>
                <HistoryStoreSelect
                  id="ingresos-store"
                  stores={stores}
                  value={storeIdFilter}
                  onChange={setStoreIdFilter}
                />
              </div>
            )}
            <div className="min-w-0">
              <label className="mb-1 block text-xs text-muted" htmlFor="ingresos-provider">Proveedor</label>
              <select
                id="ingresos-provider"
                value={providerFilter}
                onChange={event => setProviderFilter(event.target.value)}
                className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink focus:border-line-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <option value="all">Todos</option>
                {(book?.providers ?? []).map(provider => {
                  const key = providerKey(provider.providerId, provider.providerName)
                  return (
                    <option key={key} value={key}>{provider.providerName}</option>
                  )
                })}
              </select>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => changeWeek(weekOffset - 1)}
              disabled={weekOffset <= MIN_WEEK_OFFSET}
            >
              ← Anterior
            </Button>
            <p className="min-w-0 flex-1 truncate text-center text-xs text-muted" title={weekTitle}>
              {weekTitle}
              {weekOffset === 0 ? ' (actual)' : ''}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => changeWeek(weekOffset + 1)}
              disabled={weekOffset === 0}
            >
              Siguiente →
            </Button>
          </div>

          {book?.warning && (
            <p className="rounded-xl border border-line bg-panel px-4 py-3 text-sm text-ink">
              {book.warning}
            </p>
          )}

          {error && (
            <p className="py-8 text-center text-sm text-danger">{error}</p>
          )}

          {loading && !error && (
            <p className="py-8 text-center text-sm text-muted">Cargando…</p>
          )}

          {book && !error && visits.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">No hay visitas en este filtro.</p>
          )}

          {book && !error && visits.length > 0 && (
            <div className="overflow-x-auto">
              <div className={`${VISIT_GRID} gap-y-2`}>
                <div className="col-span-6 grid grid-cols-subgrid items-end px-4 text-xs text-muted">
                  <span className="whitespace-nowrap">Hora</span>
                  <span className="whitespace-nowrap">Proveedor</span>
                  <span className="whitespace-nowrap">Local</span>
                  <span className="whitespace-nowrap text-right">Total</span>
                  <span className="whitespace-nowrap text-right">Pagado</span>
                  <span className="whitespace-nowrap text-right">Quedó debiendo</span>
                </div>
                {dayGroups.map((day, index) => {
                  const dayOpen = openDays.has(day.ymd)
                  const dayTotal = priceText(day.total)
                  const missing = unpricedLabel(day.unpriced)
                  return (
                    <div
                      key={day.ymd}
                      className={`col-span-6 grid grid-cols-subgrid gap-y-2 ${index > 0 ? 'mt-4' : ''}`}
                    >
                      <button
                        type="button"
                        className="col-span-6 grid grid-cols-subgrid items-center rounded-lg px-4 py-2 text-left hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                        aria-expanded={dayOpen}
                        onClick={() => toggleDay(day.ymd)}
                      >
                        <span className="col-span-3 flex min-w-0 items-center gap-2">
                          <DayChevron open={dayOpen} />
                          <span className="whitespace-nowrap text-sm font-semibold text-ink">{day.label}</span>
                          {missing && (
                            <span className="whitespace-nowrap text-xs text-muted">{missing}</span>
                          )}
                        </span>
                        <span className={`whitespace-nowrap text-right text-sm font-semibold tabular-nums ${day.total > 0 ? 'text-ink' : 'text-muted'}`}>
                          {dayTotal}
                        </span>
                        <span className="whitespace-nowrap text-right text-sm tabular-nums text-muted">{formatARS(day.paid)}</span>
                        <span className="whitespace-nowrap text-right text-sm tabular-nums text-muted">{formatARS(day.debt)}</span>
                      </button>
                      {dayOpen && day.visits.map(({ providerName, delivery }) => {
                  const open = openKeys.has(delivery.id)
                  const total = visitCost(delivery.lines)
                  const totalLabel = priceText(total)
                  const when = toVisitTime(delivery.createdAt)
                  return (
                    <div key={delivery.id} className="col-span-6 grid grid-cols-subgrid overflow-hidden rounded-2xl border border-line bg-panel">
                      <button
                        type="button"
                        className={`col-span-6 grid grid-cols-subgrid items-center px-4 py-3 text-left hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${open ? 'rounded-t-2xl' : 'rounded-2xl'}`}
                        aria-expanded={open}
                        onClick={() => toggleVisit(delivery.id)}
                      >
                        <span className="whitespace-nowrap text-sm text-ink">{when}</span>
                        <span className="whitespace-nowrap text-sm font-semibold text-ink" title={providerName}>
                          {providerName}
                        </span>
                        <span className="whitespace-nowrap text-sm text-muted" title={delivery.storeName}>
                          {delivery.storeName}
                        </span>
                        <span className={`whitespace-nowrap text-right text-sm tabular-nums ${total > 0 ? 'text-ink' : 'text-muted'}`}>
                          {totalLabel}
                        </span>
                        <span className="whitespace-nowrap text-right text-sm tabular-nums text-muted">{formatARS(delivery.paid)}</span>
                        <span className="whitespace-nowrap text-right text-sm tabular-nums text-muted">{formatARS(delivery.debt)}</span>
                      </button>
                      {open && (
                        <div className="col-span-6 space-y-3 border-t border-line px-4 py-3">
                          <p className="whitespace-nowrap text-xs text-muted" title={delivery.createdByName}>
                            Recibió {delivery.createdByName}
                          </p>
                          <div className="inline-grid grid-cols-[max-content_max-content_max-content_max-content] gap-x-6 gap-y-2">
                            <span className="text-xs text-muted">Producto</span>
                            <span className="text-xs text-muted">Cantidad</span>
                            <span className="text-right text-xs text-muted">Precio</span>
                            <span className="text-right text-xs text-muted">Subtotal</span>
                            {delivery.lines.map(line => {
                              const qty = formatMerchVisitQty(line)
                              const unit = line.unitCost > 0
                                ? `${formatARS(line.unitCost)}${line.costUnit ? ` ${formatMerchCostUnit(line.costUnit)}` : ''}`
                                : 'sin precio'
                              const subtotal = priceText(line.costTotal)
                              return (
                                <div key={line.id} className="col-span-4 grid grid-cols-subgrid items-baseline">
                                  <span className="whitespace-nowrap text-sm text-ink" title={line.rubroName}>{line.rubroName}</span>
                                  <span className="whitespace-nowrap text-sm tabular-nums text-muted">{qty || '—'}</span>
                                  <span className={`whitespace-nowrap text-right text-sm tabular-nums ${line.unitCost > 0 ? 'text-ink' : 'text-muted'}`}>{unit}</span>
                                  <span className={`whitespace-nowrap text-right text-sm tabular-nums ${line.costTotal > 0 ? 'text-ink' : 'text-muted'}`}>{subtotal}</span>
                                  {canPriceMediaRes && isMediaResLine(line) && (
                                    <div className="col-span-4 pt-1">
                                      <MediaResPaidEditor line={line} onSaved={() => setRevision(value => value + 1)} />
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                          {delivery.notes?.trim() && (
                            <p className="max-w-xl text-sm text-muted" title={delivery.notes}>
                              {delivery.notes}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
