/**
 * Libro de ingresos de la semana — solo admin, solo PC.
 * Una semana en pantalla. No precarga las vecinas.
 */
import { useEffect, useState } from 'react'
import { formatMerchVisitQty, formatWeekRangeLabel, mondayWeekRange } from '@carniceria/shared'
import { AdminSectionHeader } from '../components/AdminSectionHeader'
import HistoryStoreSelect from '../components/HistoryStoreSelect'
import { Button } from '../components/ui'
import { formatARS, toLocalDateTime } from '../lib/datetime'
import type { MerchWeekBookResult, StoreRow } from '../types/hw-api'

const MIN_WEEK_OFFSET = -104

interface Props {
  onBack: () => void
  onLogout: () => void
}

function providerKey(providerId: string | null, providerName: string): string {
  return providerId ? `id:${providerId}` : `name:${providerName}`
}

export default function IngresosScreen({ onBack, onLogout }: Props) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [storeIdFilter, setStoreIdFilter] = useState('all')
  const [stores, setStores] = useState<StoreRow[]>([])
  const [book, setBook] = useState<MerchWeekBookResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set())

  const week = mondayWeekRange(weekOffset)
  const weekTitle = formatWeekRangeLabel(week.startYmd, week.endInclusiveYmd)

  useEffect(() => {
    void window.hw.getStores().then(result => {
      if (result.ok) setStores(result.data)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setBook(null)
    setOpenKeys(new Set())
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
  }, [weekOffset, storeIdFilter])

  function changeWeek(next: number) {
    const clamped = Math.max(MIN_WEEK_OFFSET, Math.min(0, next))
    if (clamped === weekOffset) return
    setWeekOffset(clamped)
  }

  function toggleProvider(key: string) {
    setOpenKeys(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const empty = book != null && book.providers.length === 0

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-app text-ink">
      <AdminSectionHeader
        title="Ingresos"
        subtitle="Mercadería que entró, por semana"
        onBack={onBack}
        onLogout={onLogout}
      />

      <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto w-full max-w-5xl space-y-5 px-8 py-5">
          {stores.length > 0 && (
            <div className="max-w-xs">
              <label className="mb-1 block text-xs text-muted" htmlFor="ingresos-store">Local</label>
              <HistoryStoreSelect
                id="ingresos-store"
                stores={stores}
                value={storeIdFilter}
                onChange={setStoreIdFilter}
              />
            </div>
          )}

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

          {book && !error && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <section className="rounded-2xl border border-line bg-panel p-4">
                  <h2 className="text-sm font-semibold text-ink">Entró</h2>
                  {book.rubros.length === 0 ? (
                    <p className="mt-3 text-sm text-muted">Esta semana no ingresó mercadería.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {book.rubros.map(rubro => (
                        <li key={rubro.rubroId} className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm text-ink" title={rubro.rubroName}>
                            {rubro.rubroName}
                          </span>
                          <span className="shrink-0 text-sm text-muted">{rubro.qtyLabel}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-2xl border border-line bg-panel p-4">
                  <h2 className="text-sm font-semibold text-ink">Plata de la semana</h2>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <dt className="min-w-0 flex-1 truncate text-muted" title="Pagado a proveedores">Pagado a proveedores</dt>
                      <dd className="shrink-0 font-medium text-ink">{formatARS(book.paid)}</dd>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <dt className="min-w-0 flex-1 truncate text-muted" title="Salió de caja">Salió de caja</dt>
                      <dd className="shrink-0 font-medium text-ink">{formatARS(book.cashOut)}</dd>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <dt className="min-w-0 flex-1 truncate text-muted" title="Deuda nueva">Deuda nueva</dt>
                      <dd className="shrink-0 font-medium text-ink">{formatARS(book.debt)}</dd>
                    </div>
                  </dl>
                </section>
              </div>

              {empty ? null : (
                <div className="space-y-2">
                  {book.providers.map(provider => {
                    const key = providerKey(provider.providerId, provider.providerName)
                    const open = openKeys.has(key)
                    return (
                      <section key={key} className="rounded-2xl border border-line bg-panel">
                        <button
                          type="button"
                          className="flex w-full min-w-0 items-center gap-2 px-4 py-3 text-left"
                          aria-expanded={open}
                          onClick={() => toggleProvider(key)}
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={provider.providerName}>
                            {provider.providerName}
                          </span>
                          <span className="shrink-0 text-xs text-muted">Pagado {formatARS(provider.paid)}</span>
                          <span className="shrink-0 text-xs text-muted">Salió de caja {formatARS(provider.cashOut)}</span>
                        </button>
                        {open && (
                          <ul className="space-y-4 border-t border-line px-4 py-3">
                            {provider.deliveries.map(delivery => (
                              <li key={delivery.id} className="space-y-1">
                                <p className="text-sm text-ink">{toLocalDateTime(delivery.createdAt)}</p>
                                <p className="min-w-0 truncate text-sm text-muted" title={delivery.createdByName}>
                                  Recibió {delivery.createdByName}
                                </p>
                                <ul className="space-y-1">
                                  {delivery.lines.map(line => {
                                    const qty = formatMerchVisitQty(line)
                                    return (
                                      <li key={line.id} className="flex min-w-0 items-center gap-2">
                                        <span className="min-w-0 flex-1 truncate text-sm text-ink" title={line.rubroName}>
                                          {line.rubroName}
                                        </span>
                                        {qty && <span className="shrink-0 text-sm text-muted">{qty}</span>}
                                      </li>
                                    )
                                  })}
                                </ul>
                                {delivery.notes?.trim() && (
                                  <p className="min-w-0 truncate text-sm text-muted" title={delivery.notes}>
                                    {delivery.notes}
                                  </p>
                                )}
                                {storeIdFilter === 'all' && (
                                  <p className="min-w-0 truncate text-sm text-muted" title={delivery.storeName}>
                                    {delivery.storeName}
                                  </p>
                                )}
                                <p className="text-xs text-muted">
                                  Pagado {formatARS(delivery.paid)}
                                  {' · '}
                                  Salió de caja {formatARS(delivery.cashOut)}
                                  {' · '}
                                  Quedó debiendo {formatARS(delivery.debt)}
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
