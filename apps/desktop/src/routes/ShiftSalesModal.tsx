/**
 * Vista ampliada de las ventas del turno — tabla tipo planilla.
 *
 * Muestra todas las ventas (confirmadas y canceladas) del turno.
 * Las canceladas aparecen en gris con texto tachado.
 * Cada venta confirmada tiene un botón para anularla (pide confirmación en un modal).
 */
import { Fragment, useEffect, useState } from 'react'
import { exceptionalDiscountLabel } from '@carniceria/shared'
import type { ShiftSaleRow } from '../types/hw-api'
import { formatARS, formatKg } from '../lib/datetime'
import { summarizePaymentMethods, PAYMENT_LABELS } from '../lib/paymentMethod'
import { tallyShiftCollections, ventaCountLabel } from '../lib/shiftSaleTally'
import { Button, CollapseReveal, Modal, ModalCloseButton } from '../components/ui'

interface Props {
  onClose: () => void
  /** Se llama al anular una venta para que el POS refresque “en caja” al toque. */
  onCancelled?: () => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export default function ShiftSalesModal({ onClose, onCancelled }: Props) {
  const [sales, setSales] = useState<ShiftSaleRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  /** ID de la venta que está esperando confirmación de anulación. */
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [digitalOpen, setDigitalOpen] = useState(false)

  function loadSales() {
    void window.hw.getShiftSales().then(r => {
      if (r.ok) setSales(r.data)
      else setError(r.error)
    })
  }

  useEffect(() => {
    loadSales()
  }, [])

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleCancelSale(saleId: string) {
    setCancelling(true)
    setCancelError(null)
    const r = await window.hw.cancelSale(saleId)
    setCancelling(false)
    if (!r.ok) {
      setCancelError(r.error)
      return
    }
    setConfirmCancel(null)
    loadSales()
    onCancelled?.()
  }

  const confirmedSales = (sales ?? []).filter(s => s.status === 'confirmed')
  const tally = tallyShiftCollections(sales ?? [])

  const allCount = sales?.length ?? 0
  const cancelledCount = (sales ?? []).filter(s => s.status === 'cancelled').length
  const saleToCancel = confirmCancel ? (sales ?? []).find(s => s.id === confirmCancel) ?? null : null

  return (
    <>
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Ventas del turno"
      header={
        <>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-ink">Ventas del turno</h2>
          <p className="text-xs text-muted">
            {sales
              ? `${confirmedSales.length} venta${confirmedSales.length !== 1 ? 's' : ''} confirmada${confirmedSales.length !== 1 ? 's' : ''}${cancelledCount > 0 ? ` · ${cancelledCount} anulada${cancelledCount !== 1 ? 's' : ''}` : ''}`
              : 'Cargando…'}
          </p>
        </div>
        <ModalCloseButton onClick={onClose} />
        </>
      }
      footer={
        sales && confirmedSales.length > 0 ? (
          <div className="-mx-5 -my-3 min-w-0 flex-1 bg-raised px-6 py-3">
            <div className="grid grid-cols-3 gap-4">
              <div className="min-w-0">
                <p className="text-xs text-muted">Total en efectivo</p>
                <p className="truncate text-base font-semibold text-success" title={formatARS(tally.cashAmount)}>
                  {formatARS(tally.cashAmount)}
                </p>
                {tally.cashSales > 0 && (
                  <p className="text-[10px] text-muted">{ventaCountLabel(tally.cashSales)}</p>
                )}
              </div>
              <div className="min-w-0">
                {tally.digitalAmount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setDigitalOpen(open => !open)}
                    aria-expanded={digitalOpen}
                    className="text-left"
                  >
                    <span className="flex items-center gap-1 text-xs text-muted">
                      Total digital
                      <svg className={`h-3.5 w-3.5 transition-transform ${digitalOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="none" aria-hidden>
                        <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="block truncate text-base font-semibold text-ink" title={formatARS(tally.digitalAmount)}>
                      {formatARS(tally.digitalAmount)}
                    </span>
                    <span className="block text-[10px] text-muted">{ventaCountLabel(tally.digitalSales)}</span>
                  </button>
                ) : (
                  <>
                    <p className="text-xs text-muted">Total digital</p>
                    <p className="truncate text-base font-semibold text-ink">{formatARS(0)}</p>
                  </>
                )}
              </div>
              <div className="min-w-0 text-right">
                <p className="text-xs text-muted">Total vendido</p>
                <p className="truncate text-lg font-bold text-ink" title={formatARS(tally.total)}>
                  {formatARS(tally.total)}
                </p>
                <p className="text-[10px] text-muted">{ventaCountLabel(tally.saleCount)}</p>
              </div>
            </div>
            <CollapseReveal open={digitalOpen && tally.digitalAmount > 0}>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2">
                {(['debit', 'wallet', 'credit'] as const).flatMap(method => {
                  const slice = tally.byMethod[method]
                  if (slice.amount <= 0) return []
                  return [(
                    <p key={method} className="text-xs text-muted">
                      {PAYMENT_LABELS[method]}{' '}
                      <span className="font-medium tabular-nums text-ink">{formatARS(slice.amount)}</span>
                      <span className="text-subtle"> ({ventaCountLabel(slice.sales)})</span>
                    </p>
                  )]
                })}
              </div>
            </CollapseReveal>
          </div>
        ) : null
      }
    >

        {cancelError && !confirmCancel && (
          <div className="px-6 py-2 bg-danger/10 border-b border-danger/30">
            <p className="text-xs text-danger">{cancelError}</p>
          </div>
        )}

        {/* Tabla */}
        <div className="px-6 py-4">
          {error ? (
            <p className="text-danger text-sm">{error}</p>
          ) : !sales ? (
            <p className="text-muted text-sm animate-pulse">Cargando ventas…</p>
          ) : allCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted space-y-2">
              <p className="text-4xl">🧾</p>
              <p className="text-sm">Todavía no hay ventas en este turno</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-hover">
                <tr className="border-b border-line text-xs text-muted text-left">
                  <th className="pb-2 pr-2 w-8"></th>
                  <th className="pb-2 pr-3">Hora</th>
                  <th className="pb-2 pr-3">Ítems</th>
                  <th className="pb-2 pr-3">Medio</th>
                  <th className="pb-2 pr-3 text-right">Efectivo</th>
                  <th className="pb-2 pr-3 text-right">Digital</th>
                  <th className="pb-2 text-right">Total</th>
                  <th className="pb-2 pl-3 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {sales.map(s => {
                  const isCancelled = s.status === 'cancelled'
                  const isOpen = expanded.has(s.id)
                  const apartLabel = s.discountException
                    ? exceptionalDiscountLabel(s.discountPercent ?? 0)
                    : null
                  const listPrice = s.discountAmount > 0 ? s.total + s.discountAmount : null

                  return (
                    <Fragment key={s.id}>
                      <tr
                        onClick={() => !isCancelled && toggle(s.id)}
                        className={`border-b border-line ${
                          isCancelled
                            ? 'opacity-40 cursor-default'
                            : 'cursor-pointer hover:bg-hover'
                        }`}
                      >
                        <td className="py-2 pr-2 text-muted">
                          {isCancelled ? (
                            <span className="text-xs text-red-500">✕</span>
                          ) : (
                            isOpen ? '▾' : '▸'
                          )}
                        </td>
                        <td className={`py-2 pr-3 ${isCancelled ? 'line-through text-muted' : 'text-ink'}`}>
                          {formatTime(s.createdAt)}
                        </td>
                        <td className="py-2 pr-3 text-muted">{s.items.length}</td>
                        <td className="py-2 pr-3">
                          {isCancelled ? (
                            <span className="text-xs rounded bg-danger/10 px-1.5 py-0.5 text-danger">Anulada</span>
                          ) : (
                            <>
                              {s.isDebt && (
                                <span className="mr-1.5 inline-flex rounded-md border border-line bg-app px-1.5 py-0.5 text-[10px] font-medium text-ink">
                                  Fiado
                                </span>
                              )}
                              {!(s.isDebt && s.paymentMethods.length === 0) && (
                                <span className="text-ink">{summarizePaymentMethods(s.paymentMethods)}</span>
                              )}
                              {s.manualEntry && (
                                <span className="ml-2 text-[10px] rounded bg-amber-900/50 px-1.5 py-0.5 text-amber-300">manual</span>
                              )}
                            </>
                          )}
                          {apartLabel && (
                            <span
                              className="ml-2 inline-block max-w-[9.5rem] truncate align-middle text-[10px] text-muted"
                              title={apartLabel}
                            >
                              {apartLabel}
                            </span>
                          )}
                        </td>
                        <td className={`py-2 pr-3 text-right tabular-nums ${isCancelled ? 'text-muted line-through' : 'text-success'}`}>
                          {s.cashAmount > 0 ? formatARS(s.cashAmount) : '—'}
                        </td>
                        <td className={`py-2 pr-3 text-right tabular-nums ${isCancelled ? 'text-muted line-through' : 'text-pay-debit'}`}>
                          {s.digitalAmount > 0 ? formatARS(s.digitalAmount) : '—'}
                        </td>
                        <td className="py-2 text-right">
                          {listPrice != null && (
                            <p className="text-xs font-normal text-subtle line-through tabular-nums whitespace-nowrap">
                              {formatARS(listPrice)}
                            </p>
                          )}
                          <p className={`font-semibold tabular-nums whitespace-nowrap ${isCancelled ? 'text-muted line-through' : 'text-ink'}`}>
                            {formatARS(s.total)}
                          </p>
                        </td>
                        <td className="py-2 pl-3 text-right" onClick={e => e.stopPropagation()}>
                          {!isCancelled && (
                            <button
                              onClick={() => { setConfirmCancel(s.id); setCancelError(null) }}
                              className="text-xs text-danger hover:text-danger px-2 py-1 rounded hover:bg-danger/10 transition-colors"
                            >
                              Anular
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && !isCancelled && (
                        <tr key={`${s.id}-detail`} className="bg-hover">
                          <td></td>
                          <td colSpan={7} className="py-2 pr-3">
                            <ul className="space-y-1">
                              {s.items.map((it, idx) => (
                                <li key={idx} className="flex justify-between text-xs text-muted">
                                  <span>
                                    {it.productName}
                                    <span className="text-muted">
                                      {' · '}
                                      {it.unit === 'kg' ? formatKg(it.quantity) : `${it.quantity} u`}
                                      {' × '}
                                      {formatARS(it.unitPrice)}
                                    </span>
                                  </span>
                                  <span className="text-ink">{formatARS(it.subtotal)}</span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
    </Modal>

    <Modal
      open={Boolean(confirmCancel)}
      onClose={() => { if (!cancelling) { setConfirmCancel(null); setCancelError(null) } }}
      closeOnOverlay={!cancelling}
      closeOnEscape={!cancelling}
      size="sm"
      title="¿Seguro que querés anular esta venta?"
      footer={
        <>
          <Button variant="secondary" className="mr-auto" disabled={cancelling} onClick={() => { setConfirmCancel(null); setCancelError(null) }}>
            Cancelar
          </Button>
          <Button variant="danger" loading={cancelling} onClick={() => { if (confirmCancel) void handleCancelSale(confirmCancel) }}>
            Anular
          </Button>
        </>
      }
    >
      {saleToCancel ? (
        <p className="text-sm text-muted">
          Se va a anular la venta de {formatARS(saleToCancel.total)} de las {formatTime(saleToCancel.createdAt)}. El efectivo vuelve a caja.
        </p>
      ) : (
        <p className="text-sm text-muted">Esta acción no se puede deshacer desde acá.</p>
      )}
      {cancelError && (
        <p className="mt-3 text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg p-3">{cancelError}</p>
      )}
    </Modal>
    </>
  )
}
