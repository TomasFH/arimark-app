/**
 * Vista ampliada de las ventas del turno — tabla tipo planilla.
 *
 * Muestra todas las ventas (confirmadas y canceladas) del turno.
 * Las canceladas aparecen en gris con texto tachado.
 * Cada venta confirmada tiene un botón para anularla (pide confirmación en un modal).
 */
import { useEffect, useState } from 'react'
import type { ShiftSaleRow } from '../types/hw-api'
import { formatARS, formatKg } from '../lib/datetime'
import { summarizePaymentMethods } from '../lib/paymentMethod'
import { Button, Modal } from '../components/ui'

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
  const totals = confirmedSales.reduce(
    (acc, s) => {
      acc.total += s.total
      acc.cash += s.cashAmount
      acc.digital += s.digitalAmount
      return acc
    },
    { total: 0, cash: 0, digital: 0 }
  )

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
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-ink">Ventas del turno</h2>
          <p className="text-xs text-muted">
            {sales
              ? `${confirmedSales.length} venta${confirmedSales.length !== 1 ? 's' : ''} confirmada${confirmedSales.length !== 1 ? 's' : ''}${cancelledCount > 0 ? ` · ${cancelledCount} anulada${cancelledCount !== 1 ? 's' : ''}` : ''}`
              : 'Cargando…'}
          </p>
        </div>
      }
    >

        {cancelError && !confirmCancel && (
          <div className="px-6 py-2 bg-danger/10 border-b border-danger/30">
            <p className="text-xs text-danger">{cancelError}</p>
          </div>
        )}

        {/* Tabla */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
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

                  return (
                    <>
                      <tr
                        key={s.id}
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
                              <span className="text-ink">{summarizePaymentMethods(s.paymentMethods)}</span>
                              {s.manualEntry && (
                                <span className="ml-2 text-[10px] rounded bg-amber-900/50 px-1.5 py-0.5 text-amber-300">manual</span>
                              )}
                            </>
                          )}
                        </td>
                        <td className={`py-2 pr-3 text-right ${isCancelled ? 'text-muted line-through' : 'text-success'}`}>
                          {s.cashAmount > 0 ? formatARS(s.cashAmount) : '—'}
                        </td>
                        <td className={`py-2 pr-3 text-right ${isCancelled ? 'text-muted line-through' : 'text-ink'}`}>
                          {s.digitalAmount > 0 ? formatARS(s.digitalAmount) : '—'}
                        </td>
                        <td className={`py-2 text-right font-semibold ${isCancelled ? 'text-muted line-through' : 'text-ink'}`}>
                          {formatARS(s.total)}
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
                    </>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Totales al pie (solo ventas confirmadas) */}
        {sales && confirmedSales.length > 0 && (
          <div className="border-t border-line bg-raised px-6 py-3 grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted">Total en efectivo</p>
              <p className="text-base font-semibold text-success">{formatARS(totals.cash)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Total digital</p>
              <p className="text-base font-semibold text-ink">{formatARS(totals.digital)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted">Total vendido</p>
              <p className="text-lg font-bold text-ink">{formatARS(totals.total)}</p>
            </div>
          </div>
        )}
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
