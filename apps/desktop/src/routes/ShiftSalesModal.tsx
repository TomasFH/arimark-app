/**
 * Vista ampliada de las ventas del turno — tabla tipo planilla.
 *
 * Muestra todas las ventas (confirmadas y canceladas) del turno.
 * Las canceladas aparecen en gris con texto tachado.
 * Cada venta confirmada tiene un botón para anularla (pide confirmación inline).
 */
import { useEffect, useState } from 'react'
import type { ShiftSaleRow } from '../types/hw-api'
import { formatARS, formatKg } from '../lib/datetime'
import { summarizePaymentMethods } from '../lib/paymentMethod'

interface Props {
  onClose: () => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export default function ShiftSalesModal({ onClose }: Props) {
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
      setConfirmCancel(null)
      return
    }
    setConfirmCancel(null)
    loadSales()
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

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-gray-900 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-lg font-semibold">Ventas del turno</h2>
            <p className="text-xs text-gray-500">
              {sales
                ? `${confirmedSales.length} venta${confirmedSales.length !== 1 ? 's' : ''} confirmada${confirmedSales.length !== 1 ? 's' : ''}${cancelledCount > 0 ? ` · ${cancelledCount} anulada${cancelledCount !== 1 ? 's' : ''}` : ''}`
                : 'Cargando…'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
          >
            Cerrar
          </button>
        </div>

        {cancelError && (
          <div className="px-6 py-2 bg-red-900/30 border-b border-red-800">
            <p className="text-xs text-red-400">{cancelError}</p>
          </div>
        )}

        {/* Tabla */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error ? (
            <p className="text-red-400 text-sm">{error}</p>
          ) : !sales ? (
            <p className="text-gray-500 text-sm animate-pulse">Cargando ventas…</p>
          ) : allCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600 space-y-2">
              <p className="text-4xl">🧾</p>
              <p className="text-sm">Todavía no hay ventas en este turno</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-900">
                <tr className="border-b border-gray-800 text-xs text-gray-500 text-left">
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
                  const awaitingConfirm = confirmCancel === s.id

                  return (
                    <>
                      <tr
                        key={s.id}
                        onClick={() => !isCancelled && toggle(s.id)}
                        className={`border-b border-gray-800/60 ${
                          isCancelled
                            ? 'opacity-40 cursor-default'
                            : 'cursor-pointer hover:bg-gray-800/40'
                        }`}
                      >
                        <td className="py-2 pr-2 text-gray-600">
                          {isCancelled ? (
                            <span className="text-xs text-red-500">✕</span>
                          ) : (
                            isOpen ? '▾' : '▸'
                          )}
                        </td>
                        <td className={`py-2 pr-3 ${isCancelled ? 'line-through text-gray-500' : 'text-gray-300'}`}>
                          {formatTime(s.createdAt)}
                        </td>
                        <td className="py-2 pr-3 text-gray-400">{s.items.length}</td>
                        <td className="py-2 pr-3">
                          {isCancelled ? (
                            <span className="text-xs rounded bg-red-900/30 px-1.5 py-0.5 text-red-400">Anulada</span>
                          ) : (
                            <>
                              <span className="text-gray-300">{summarizePaymentMethods(s.paymentMethods)}</span>
                              {s.manualEntry && (
                                <span className="ml-2 text-[10px] rounded bg-amber-900/50 px-1.5 py-0.5 text-amber-300">manual</span>
                              )}
                            </>
                          )}
                        </td>
                        <td className={`py-2 pr-3 text-right ${isCancelled ? 'text-gray-600 line-through' : 'text-emerald-400'}`}>
                          {s.cashAmount > 0 ? formatARS(s.cashAmount) : '—'}
                        </td>
                        <td className={`py-2 pr-3 text-right ${isCancelled ? 'text-gray-600 line-through' : 'text-sky-400'}`}>
                          {s.digitalAmount > 0 ? formatARS(s.digitalAmount) : '—'}
                        </td>
                        <td className={`py-2 text-right font-semibold ${isCancelled ? 'text-gray-600 line-through' : 'text-white'}`}>
                          {formatARS(s.total)}
                        </td>
                        <td className="py-2 pl-3 text-right" onClick={e => e.stopPropagation()}>
                          {!isCancelled && !awaitingConfirm && (
                            <button
                              onClick={() => { setConfirmCancel(s.id); setCancelError(null) }}
                              className="text-xs text-red-500 hover:text-red-400 px-2 py-1 rounded hover:bg-red-900/20 transition-colors"
                            >
                              Anular
                            </button>
                          )}
                          {awaitingConfirm && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => void handleCancelSale(s.id)}
                                disabled={cancelling}
                                className="text-xs text-red-400 font-semibold hover:text-red-300 px-2 py-1 rounded bg-red-900/30 hover:bg-red-900/50 disabled:opacity-40 transition-colors"
                              >
                                {cancelling ? '…' : 'Confirmar'}
                              </button>
                              <button
                                onClick={() => setConfirmCancel(null)}
                                disabled={cancelling}
                                className="text-xs text-gray-500 hover:text-gray-300 px-1.5 py-1 rounded hover:bg-gray-700 disabled:opacity-40 transition-colors"
                              >
                                No
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {isOpen && !isCancelled && (
                        <tr key={`${s.id}-detail`} className="bg-gray-950/60">
                          <td></td>
                          <td colSpan={7} className="py-2 pr-3">
                            <ul className="space-y-1">
                              {s.items.map((it, idx) => (
                                <li key={idx} className="flex justify-between text-xs text-gray-400">
                                  <span>
                                    {it.productName}
                                    <span className="text-gray-600">
                                      {' · '}
                                      {it.unit === 'kg' ? formatKg(it.quantity) : `${it.quantity} u`}
                                      {' × '}
                                      {formatARS(it.unitPrice)}
                                    </span>
                                  </span>
                                  <span className="text-gray-300">{formatARS(it.subtotal)}</span>
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
          <div className="border-t border-gray-800 px-6 py-3 grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-500">Total en efectivo</p>
              <p className="text-base font-semibold text-emerald-400">{formatARS(totals.cash)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total digital</p>
              <p className="text-base font-semibold text-sky-400">{formatARS(totals.digital)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Total vendido</p>
              <p className="text-lg font-bold text-white">{formatARS(totals.total)}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
