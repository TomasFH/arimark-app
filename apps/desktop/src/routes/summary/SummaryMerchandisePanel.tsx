import { useState } from 'react'
import {
  boxAporteAmount,
  civilYmd,
  formatKg3,
  groupMediaResByDay,
  mediaResAverageKg,
  mediaResTotals,
  shiftCloseBoxText,
  storeTransferLabel,
  summaryBoxLabel,
  summaryBoxTally,
  type ChickenVisit,
  type MediaResDay,
  type MediaResVisit,
  type SummaryMoneyView,
} from '@carniceria/shared'
import { cx } from '../../components/ui'
import { formatARS } from '../../lib/datetime'
import type { StoreTransferRow } from '../../types/hw-api'

function mediaResPriceText(cost: number | null | undefined): string {
  return cost != null && cost > 0 ? formatARS(cost) : 'sin precio'
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

function pieceHeading(
  totals: { count: number; kg: number },
  average: number | null,
): string {
  const base = `${totals.count} ${totals.count === 1 ? 'pieza' : 'piezas'} · ${formatKg3(totals.kg)}`
  if (average == null) return base
  return `${base} · promedio ${formatKg3(average)}`
}

function boxClass(kind: string): string {
  if (kind === 'matched') return 'text-success'
  if (kind === 'difference') return 'text-danger'
  return 'text-muted'
}

function transferDayLabel(iso: string): string {
  const ymd = civilYmd(new Date(iso))
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
}

function transferQuantityText(quantity: number, unit: StoreTransferRow['unit']): string {
  if (unit === 'kg') return formatKg3(quantity)
  if (unit === 'u') return quantity === 1 ? '1 unidad' : `${quantity} unidades`
  return quantity === 1 ? '1 cajón' : `${quantity} cajones`
}

export function SummaryMerchandisePanel({
  providers,
  providerFilter,
  onProvider,
  days,
  openDay,
  onOpenDay,
  totals,
  average,
  chicken,
  delantero,
  chickenRows,
  showBoxes,
  money,
  showStore,
  showTransfers,
  pending,
  pendingShown,
  pendingLoading,
  pendingError,
  transferShown,
  transferDetail,
  transferDetailLoading,
  transferDetailError,
  storeName,
}: {
  providers: string[]
  providerFilter: string | null
  onProvider: (name: string | null) => void
  days: MediaResDay[]
  openDay: string | null
  onOpenDay: (ymd: string | null) => void
  totals: { count: number; kg: number }
  average: number | null
  chicken: { crates: number; grossKg: number }
  delantero: MediaResVisit[]
  chickenRows: ChickenVisit[]
  showBoxes: boolean
  money: SummaryMoneyView
  showStore: boolean
  showTransfers: boolean
  pending: { rows: StoreTransferRow[]; incomplete: boolean } | null
  pendingShown: StoreTransferRow[]
  pendingLoading: boolean
  pendingError: string | null
  transferShown: StoreTransferRow[]
  transferDetail: StoreTransferRow[] | null
  transferDetailLoading: boolean
  transferDetailError: string | null
  storeName: Map<string, string>
}) {
  const [openPieceDay, setOpenPieceDay] = useState<string | null>(null)
  const pieceDays = groupMediaResByDay(delantero)
  const pieceTotals = mediaResTotals(delantero)
  const pieceAverage = mediaResAverageKg(delantero)
  return (
    <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
      <section className="min-w-0 space-y-3 rounded-xl border border-line bg-panel p-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="shrink-0 text-sm font-semibold text-ink">Medias reses</h2>
          <p className="min-w-0 truncate text-sm font-semibold text-ink" title={mediaHeading(totals, average)}>
            {mediaHeading(totals, average)}
          </p>
        </div>
        {providers.length > 1 && (
          <label className="block min-w-0">
            <span className="sr-only">Proveedor</span>
            <select
              aria-label="Proveedor"
              value={providerFilter ?? ''}
              onChange={event => onProvider(event.target.value || null)}
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
                      onClick={() => onOpenDay(open ? null : day.ymd)}
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

      <section className="min-w-0 space-y-3 rounded-xl border border-line bg-panel p-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="shrink-0 text-sm font-semibold text-ink">Delantero</h2>
          {(pieceTotals.count > 0 || pieceTotals.kg > 0) && (
            <p className="min-w-0 truncate text-sm font-semibold text-ink" title={pieceHeading(pieceTotals, pieceAverage)}>
              {pieceHeading(pieceTotals, pieceAverage)}
            </p>
          )}
        </div>
        {pieceDays.length === 0 ? (
          <p className="text-sm text-muted">No hay delantero en este período.</p>
        ) : (
          <div>
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-2 px-1 text-xs font-medium text-muted">
              <span>Día</span>
              <span>Piezas</span>
              <span className="text-right">Kilos</span>
            </div>
            <ul>
              {pieceDays.map(day => {
                const open = openPieceDay === day.ymd
                const label = `${day.ymd.slice(8, 10)}/${day.ymd.slice(5, 7)}`
                return (
                  <li key={day.ymd} className="border-t border-line">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenPieceDay(open ? null : day.ymd)}
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

      <section className="min-w-0 space-y-3 rounded-xl border border-line bg-panel p-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="shrink-0 text-sm font-semibold text-ink">Pollo</h2>
          {chickenRows.length > 0 && (
            <p className="min-w-0 truncate text-sm font-semibold text-ink" title={chickenHeading(chicken)}>
              {chickenHeading(chicken)}
            </p>
          )}
        </div>
        {chickenRows.length === 0 ? (
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
              {chickenRows.map(visit => {
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

      {showBoxes && (
        <section className="min-w-0 space-y-3 rounded-xl border border-line bg-panel p-4">
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
        </section>
      )}

      {showTransfers && (pending || pendingLoading || pendingError) && (
        <section className="min-w-0 space-y-2 rounded-xl border border-line bg-panel p-4">
          <h2 className="text-sm font-semibold text-ink">Pendiente entre locales</h2>
          {pendingError && <p className="truncate text-sm text-danger" title={pendingError}>{pendingError}</p>}
          {pendingLoading && !pendingError && <p className="text-sm text-muted">Cargando…</p>}
          {pending && !pendingLoading && !pendingError && pendingShown.length === 0 && (
            <p className="text-sm text-muted">No hay mercadería pendiente.</p>
          )}
          <ul className="space-y-2">
            {pendingShown.map(row => {
              const route = `${storeName.get(row.fromStoreId) ?? row.fromStoreId} → ${storeName.get(row.toStoreId) ?? row.toStoreId}`
              return (
                <li key={row.id} className="space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={row.productName}>{row.productName}</p>
                    <span className="shrink-0 text-xs text-muted">{storeTransferLabel(row)}</span>
                  </div>
                  <p className="truncate text-sm text-muted" title={route}>{`${transferQuantityText(row.quantity, row.unit)} · ${route}`}</p>
                  {row.estimatedValue != null && (
                    <p className="text-sm text-ink">{`Valor estimado ${formatARS(row.estimatedValue)}`}</p>
                  )}
                </li>
              )
            })}
          </ul>
          {pending?.incomplete && <p className="text-sm text-muted">incompleta</p>}
        </section>
      )}
      {showTransfers && (transferDetail || transferDetailLoading || transferDetailError) && (
        <section className="min-w-0 space-y-2 rounded-xl border border-line bg-panel p-4">
          <h2 className="text-sm font-semibold text-ink">Detalle de transferencias</h2>
          {transferDetailError && (
            <p className="truncate text-sm text-danger" title={transferDetailError}>{transferDetailError}</p>
          )}
          {transferDetailLoading && !transferDetailError && <p className="text-sm text-muted">Cargando…</p>}
          {transferDetail && !transferDetailLoading && !transferDetailError && transferShown.length === 0 && (
            <p className="text-sm text-muted">No hay movimientos en este período.</p>
          )}
          <ul className="space-y-2">
            {transferShown.map(row => {
              const from = storeName.get(row.fromStoreId) ?? row.fromStoreId
              const to = storeName.get(row.toStoreId) ?? row.toStoreId
              const line = `${transferDayLabel(row.occurredAt)} · ${row.productName} · ${transferQuantityText(row.quantity, row.unit)} · ${from} → ${to} · ${storeTransferLabel(row)}`
              return (
                <li key={row.id} className={cx('space-y-1', row.status === 'cancelled' && 'line-through')}>
                  <p className="min-w-0 truncate text-sm text-ink" title={line}>{line}</p>
                  {row.hasDifference && row.receivedQuantity != null && (
                    <p className="text-sm text-muted">{`Recibida ${transferQuantityText(row.receivedQuantity, row.unit)}`}</p>
                  )}
                  {row.estimatedValue != null && (
                    <p className="text-sm text-ink">{`Valor estimado ${formatARS(row.estimatedValue)}`}</p>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
