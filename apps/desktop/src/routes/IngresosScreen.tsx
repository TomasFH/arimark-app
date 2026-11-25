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
  merchVisitTotal,
  mondayWeekRange,
} from '@carniceria/shared'
import type { MerchIntakeLineSnapshot } from '@carniceria/shared'
import { AdminSectionHeader } from '../components/AdminSectionHeader'
import HistoryStoreSelect from '../components/HistoryStoreSelect'
import NumericInput from '../components/NumericInput'
import { Button } from '../components/ui'
import { formatARS, toLocalDateTime } from '../lib/datetime'
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

  function toggleVisit(id: string) {
    setOpenKeys(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visits = useMemo(() => {
    const rows: Array<{
      providerName: string
      delivery: MerchWeekBookResult['providers'][number]['deliveries'][number]
    }> = []
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
            <div className="space-y-2">
              <div className="grid grid-cols-[8.5rem_minmax(0,1.2fr)_minmax(0,1fr)_5.5rem_5.5rem_6.5rem] gap-2 px-4 text-xs text-muted">
                <span>Fecha</span>
                <span>Proveedor</span>
                <span>Local</span>
                <span className="text-right">Total</span>
                <span className="text-right">Pagado</span>
                <span className="truncate text-right" title="Quedó debiendo">Quedó debiendo</span>
              </div>
            <ul className="space-y-2">
              {visits.map(({ providerName, delivery }) => {
                const open = openKeys.has(delivery.id)
                const total = merchVisitTotal(delivery.lines)
                const when = toLocalDateTime(delivery.createdAt)
                return (
                  <li key={delivery.id} className="rounded-2xl border border-line bg-panel">
                    <button
                      type="button"
                      className="grid w-full grid-cols-[8.5rem_minmax(0,1.2fr)_minmax(0,1fr)_5.5rem_5.5rem_6.5rem] items-center gap-2 px-4 py-3 text-left"
                      aria-expanded={open}
                      onClick={() => toggleVisit(delivery.id)}
                    >
                      <span className="truncate text-sm text-ink" title={when}>{when}</span>
                      <span className="min-w-0 truncate text-sm font-semibold text-ink" title={providerName}>
                        {providerName}
                      </span>
                      <span className="min-w-0 truncate text-sm text-muted" title={delivery.storeName}>
                        {delivery.storeName}
                      </span>
                      <span className="truncate text-right text-sm tabular-nums text-ink" title={formatARS(total)}>{formatARS(total)}</span>
                      <span className="truncate text-right text-sm tabular-nums text-muted" title={formatARS(delivery.paid)}>{formatARS(delivery.paid)}</span>
                      <span className="truncate text-right text-sm tabular-nums text-muted" title={formatARS(delivery.debt)}>{formatARS(delivery.debt)}</span>
                    </button>
                    {open && (
                      <div className="space-y-2 border-t border-line px-4 py-3">
                        <p className="min-w-0 truncate text-xs text-muted" title={delivery.createdByName}>
                          Recibió {delivery.createdByName}
                        </p>
                        <ul className="space-y-2">
                          {delivery.lines.map(line => {
                            const qty = formatMerchVisitQty(line)
                            const unit = line.unitCost > 0
                              ? `${formatARS(line.unitCost)}${line.costUnit ? ` ${formatMerchCostUnit(line.costUnit)}` : ''}`
                              : ''
                            return (
                              <li key={line.id} className="space-y-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="min-w-0 flex-1 truncate text-sm text-ink" title={line.rubroName}>
                                    {line.rubroName}
                                  </span>
                                  {qty && <span className="shrink-0 text-sm text-muted">{qty}</span>}
                                  {unit && <span className="shrink-0 text-sm tabular-nums text-ink">{unit}</span>}
                                  {line.costTotal > 0 && (
                                    <span className="shrink-0 text-sm tabular-nums text-ink">{formatARS(line.costTotal)}</span>
                                  )}
                                </div>
                                {canPriceMediaRes && isMediaResLine(line) && (
                                  <MediaResPaidEditor line={line} onSaved={() => setRevision(value => value + 1)} />
                                )}
                              </li>
                            )
                          })}
                        </ul>
                        {delivery.notes?.trim() && (
                          <p className="min-w-0 truncate text-sm text-muted" title={delivery.notes}>
                            {delivery.notes}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
