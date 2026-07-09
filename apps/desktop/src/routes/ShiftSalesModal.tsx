/**
 * Vista ampliada de las ventas del turno — tabla tipo planilla.
 *
 * Muestra todas las ventas confirmadas del turno con desglose de efectivo/digital
 * y totales al pie. Las filas se pueden expandir para ver los productos.
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

  useEffect(() => {
    void window.hw.getShiftSales().then(r => {
      if (r.ok) setSales(r.data)
      else setError(r.error)
    })
  }, [])

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totals = (sales ?? []).reduce(
    (acc, s) => {
      acc.total += s.total
      acc.cash += s.cashAmount
      acc.digital += s.digitalAmount
      return acc
    },
    { total: 0, cash: 0, digital: 0 }
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-lg font-semibold">Ventas del turno</h2>
            <p className="text-xs text-gray-500">
              {sales ? `${sales.length} venta${sales.length !== 1 ? 's' : ''} confirmada${sales.length !== 1 ? 's' : ''}` : 'Cargando…'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
          >
            Cerrar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error ? (
            <p className="text-red-400 text-sm">{error}</p>
          ) : !sales ? (
            <p className="text-gray-500 text-sm animate-pulse">Cargando ventas…</p>
          ) : sales.length === 0 ? (
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
                </tr>
              </thead>
              <tbody>
                {sales.map(s => {
                  const isOpen = expanded.has(s.id)
                  return (
                    <>
                      <tr
                        key={s.id}
                        onClick={() => toggle(s.id)}
                        className="border-b border-gray-800/60 cursor-pointer hover:bg-gray-800/40"
                      >
                        <td className="py-2 pr-2 text-gray-600">{isOpen ? '▾' : '▸'}</td>
                        <td className="py-2 pr-3 text-gray-300">{formatTime(s.createdAt)}</td>
                        <td className="py-2 pr-3 text-gray-400">{s.items.length}</td>
                        <td className="py-2 pr-3">
                          <span className="text-gray-300">{summarizePaymentMethods(s.paymentMethods)}</span>
                          {s.manualEntry && (
                            <span className="ml-2 text-[10px] rounded bg-amber-900/50 px-1.5 py-0.5 text-amber-300">manual</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right text-emerald-400">
                          {s.cashAmount > 0 ? formatARS(s.cashAmount) : '—'}
                        </td>
                        <td className="py-2 pr-3 text-right text-sky-400">
                          {s.digitalAmount > 0 ? formatARS(s.digitalAmount) : '—'}
                        </td>
                        <td className="py-2 text-right font-semibold text-white">{formatARS(s.total)}</td>
                      </tr>
                      {isOpen && (
                        <tr key={`${s.id}-detail`} className="bg-gray-950/60">
                          <td></td>
                          <td colSpan={6} className="py-2 pr-3">
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

        {/* Totales al pie */}
        {sales && sales.length > 0 && (
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
