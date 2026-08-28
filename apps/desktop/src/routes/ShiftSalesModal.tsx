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
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-zinc-800 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-xl border border-zinc-700">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700">
          <div>
            <h2 className="text-lg font-semibold">Ventas del turno</h2>
            <p className="text-xs text-zinc-500">
              {sales
                ? `${confirmedSales.length} venta${confirmedSales.length !== 1 ? 's' : ''} confirmada${confirmedSales.length !== 1 ? 's' : ''}${cancelledCount > 0 ? ` · ${cancelledCount} anulada${cancelledCount !== 1 ? 's' : ''}` : ''}`
                : 'Cargando…'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-600 bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-600"
          >
            Cerrar
          </button>
        </div>

        {cancelError && !confirmCancel && (
          <div className="px-6 py-2 bg-red-900/30 border-b border-red-800">
            <p className="text-xs text-red-400">{cancelError}</p>
          </div>
        )}

        {/* Tabla */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error ? (
            <p className="text-red-400 text-sm">{error}</p>
          ) : !sales ? (
            <p className="text-zinc-500 text-sm animate-pulse">Cargando ventas…</p>
          ) : allCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500 space-y-2">
              <p className="text-4xl">🧾</p>
              <p className="text-sm">Todavía no hay ventas en este turno</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-700">
                <tr className="border-b border-zinc-600 text-xs text-zinc-400 text-left">
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
                        className={`border-b border-zinc-700/60 ${
                          isCancelled
                            ? 'opacity-40 cursor-default'
                            : 'cursor-pointer hover:bg-zinc-700/70'
                        }`}
                      >
                        <td className="py-2 pr-2 text-zinc-500">
                          {isCancelled ? (
                            <span className="text-xs text-red-500">✕</span>
                          ) : (
                            isOpen ? '▾' : '▸'
                          )}
                        </td>
                        <td className={`py-2 pr-3 ${isCancelled ? 'line-through text-zinc-500' : 'text-zinc-200'}`}>
                          {formatTime(s.createdAt)}
                        </td>
                        <td className="py-2 pr-3 text-zinc-400">{s.items.length}</td>
                        <td className="py-2 pr-3">
                          {isCancelled ? (
                            <span className="text-xs rounded bg-red-900/30 px-1.5 py-0.5 text-red-400">Anulada</span>
                          ) : (
                            <>
                              <span className="text-zinc-300">{summarizePaymentMethods(s.paymentMethods)}</span>
                              {s.manualEntry && (
                                <span className="ml-2 text-[10px] rounded bg-amber-900/50 px-1.5 py-0.5 text-amber-300">manual</span>
                              )}
                            </>
                          )}
                        </td>
                        <td className={`py-2 pr-3 text-right ${isCancelled ? 'text-zinc-500 line-through' : 'text-emerald-400'}`}>
                          {s.cashAmount > 0 ? formatARS(s.cashAmount) : '—'}
                        </td>
                        <td className={`py-2 pr-3 text-right ${isCancelled ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
                          {s.digitalAmount > 0 ? formatARS(s.digitalAmount) : '—'}
                        </td>
                        <td className={`py-2 text-right font-semibold ${isCancelled ? 'text-zinc-500 line-through' : 'text-white'}`}>
                          {formatARS(s.total)}
                        </td>
                        <td className="py-2 pl-3 text-right" onClick={e => e.stopPropagation()}>
                          {!isCancelled && (
                            <button
                              onClick={() => { setConfirmCancel(s.id); setCancelError(null) }}
                              className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-900/20 transition-colors"
                            >
                              Anular
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && !isCancelled && (
                        <tr key={`${s.id}-detail`} className="bg-zinc-700/50">
                          <td></td>
                          <td colSpan={7} className="py-2 pr-3">
                            <ul className="space-y-1">
                              {s.items.map((it, idx) => (
                                <li key={idx} className="flex justify-between text-xs text-zinc-400">
                                  <span>
                                    {it.productName}
                                    <span className="text-zinc-500">
                                      {' · '}
                                      {it.unit === 'kg' ? formatKg(it.quantity) : `${it.quantity} u`}
                                      {' × '}
                                      {formatARS(it.unitPrice)}
                                    </span>
                                  </span>
                                  <span className="text-zinc-200">{formatARS(it.subtotal)}</span>
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
          <div className="border-t border-zinc-700 bg-zinc-700/30 px-6 py-3 grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-zinc-500">Total en efectivo</p>
              <p className="text-base font-semibold text-emerald-400">{formatARS(totals.cash)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Total digital</p>
              <p className="text-base font-semibold text-zinc-200">{formatARS(totals.digital)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-zinc-500">Total vendido</p>
              <p className="text-lg font-bold text-white">{formatARS(totals.total)}</p>
            </div>
          </div>
        )}
      </div>

      {confirmCancel && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget && !cancelling) { setConfirmCancel(null); setCancelError(null) } }}
        >
          <div className="bg-zinc-800 rounded-2xl border border-zinc-700 w-full max-w-sm p-6 space-y-4 shadow-xl">
            <h2 className="text-base font-semibold text-white">¿Seguro que querés anular esta venta?</h2>
            {saleToCancel ? (
              <p className="text-sm text-zinc-400">
                Se va a anular la venta de {formatARS(saleToCancel.total)} de las {formatTime(saleToCancel.createdAt)}. El efectivo vuelve a caja.
              </p>
            ) : (
              <p className="text-sm text-zinc-400">Esta acción no se puede deshacer desde acá.</p>
            )}
            {cancelError && (
              <p className="text-sm text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg p-3">{cancelError}</p>
            )}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => { setConfirmCancel(null); setCancelError(null) }}
                disabled={cancelling}
                className="flex-1 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleCancelSale(confirmCancel)}
                disabled={cancelling}
                className="flex-1 py-2 rounded-xl bg-red-900/60 hover:bg-red-900/80 border border-red-900/50 text-red-200 font-semibold transition-colors disabled:opacity-40"
              >
                {cancelling ? 'Anulando…' : 'Anular'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
