import { useState, useEffect, useCallback } from 'react'
import DevScaleTicketPanel from '../components/DevScaleTicketPanel'
import PaymentModal from '../components/PaymentModal'
import type { ScaleOrder, SalePaymentPayload, ShiftInfo, SessionInfo } from '../types/hw-api'
import { formatARS, formatKg as formatWeight } from '../lib/datetime'

interface Props {
  session: SessionInfo
  shift: ShiftInfo
  onLogout: () => void
}

/**
 * Extiende ScaleOrder con un `localId` siempre presente para interacciones de UI.
 * Si el main process asignó un DB-id, se usa ese. En caso contrario se genera uno
 * temporal (prefijo "tmp-") que no viaja al backend como scaleOrderId.
 */
interface LocalOrder extends ScaleOrder {
  localId: string
}

function toLocalOrder(order: ScaleOrder): LocalOrder {
  return { ...order, localId: order.id ?? `tmp-${crypto.randomUUID()}` }
}

export default function CashierScreen({ session, shift, onLogout }: Props) {
  const [orderQueue, setOrderQueue] = useState<LocalOrder[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastSaleId, setLastSaleId] = useState<string | null>(null)

  // Suscripción a pedidos de balanza
  useEffect(() => {
    const unsub = window.hw.onScaleOrder(order => {
      setOrderQueue(prev => [...prev, toLocalOrder(order)])
    })
    return unsub
  }, [])

  const selectedOrder = selectedOrderId
    ? orderQueue.find(o => o.localId === selectedOrderId) ?? null
    : null

  const cartTotal = selectedOrder?.total ?? 0

  const toggleSelect = useCallback((localId: string) => {
    setSelectedOrderId(prev => (prev === localId ? null : localId))
    setError('')
    setLastSaleId(null)
  }, [])

  const toggleExpand = useCallback((localId: string) => {
    setExpandedOrderId(prev => (prev === localId ? null : localId))
  }, [])

  function dismissOrder(localId: string) {
    setOrderQueue(prev => prev.filter(o => o.localId !== localId))
    if (selectedOrderId === localId) setSelectedOrderId(null)
    if (expandedOrderId === localId) setExpandedOrderId(null)
  }

  function clearSelection() {
    setSelectedOrderId(null)
    setError('')
    setLastSaleId(null)
  }

  async function handleConfirmSale(payments: SalePaymentPayload[]) {
    if (!selectedOrder) {
      setError('Seleccioná un pedido antes de confirmar.')
      return
    }

    setLoading(true)
    setError('')
    setShowPaymentModal(false)

    try {
      const result = await window.hw.createSale({
        items: selectedOrder.items.map(item => ({
          productId: item.productId ?? '00000000-0000-0000-0001-000000000099',
          quantity: item.weightKg,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
        })),
        payments,
        // Solo pasar scaleOrderId si es un ID real de DB (no temporal)
        scaleOrderId: selectedOrder.id,
      })

      if (!result.ok) {
        setError(result.error ?? 'Error al procesar la venta.')
        return
      }

      setLastSaleId(result.data.saleId)
      setOrderQueue(prev => prev.filter(o => o.localId !== selectedOrder.localId))
      setSelectedOrderId(null)
    } catch {
      setError('Error de comunicación. Reintentar.')
    } finally {
      setLoading(false)
    }
  }

  function openPaymentModal() {
    setError('')
    setLastSaleId(null)
    setShowPaymentModal(true)
  }

  const shiftLabel = shift.shiftType === 'morning' ? '🌅 Mañana' : '🌙 Tarde'
  const pendingCount = orderQueue.filter(o => o.localId !== selectedOrderId).length

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-amber-400">{shiftLabel}</span>
          <span className="text-xs text-gray-500">Turno abierto</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">
            {session.role === 'cashier' ? 'Cajera' : 'Admin'}
          </span>
          <button
            onClick={onLogout}
            className="rounded-md bg-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-600"
          >
            Salir
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Columna izquierda: cola de pedidos */}
        <div className="flex w-80 flex-col border-r border-gray-800 bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-200">Cola de pedidos</h2>
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                {pendingCount}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {orderQueue.length === 0 && (
              <p className="text-center text-xs text-gray-600 mt-8">
                Esperando pedidos de la balanza…
              </p>
            )}

            {orderQueue.map(order => {
              const isSelected = order.localId === selectedOrderId
              const isExpanded = order.localId === expandedOrderId

              return (
                <div
                  key={order.localId}
                  className={`rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                  }`}
                >
                  {/* Cabecera del pedido — clic selecciona para cobrar */}
                  <div
                    className="flex items-start p-3 cursor-pointer"
                    onClick={() => toggleSelect(order.localId)}
                  >
                    {/* Badge de canal */}
                    <span className="mr-2 mt-0.5 shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-[10px] font-bold text-gray-300">
                      {order.channel}
                    </span>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">
                        {order.items.length} producto{order.items.length !== 1 ? 's' : ''}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {order.items.map(i => i.productName ?? i.productCode).join(' · ')}
                      </p>
                    </div>

                    <div className="ml-2 shrink-0 text-right">
                      <p className="text-sm font-bold text-amber-400">{formatARS(order.total)}</p>
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="flex items-center justify-between border-t border-gray-700/50 px-3 py-1.5">
                    <button
                      onClick={e => { e.stopPropagation(); toggleExpand(order.localId) }}
                      className="text-xs text-gray-500 hover:text-gray-300"
                    >
                      {isExpanded ? 'Ocultar detalle ↑' : 'Ver detalle ↓'}
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); dismissOrder(order.localId) }}
                      className="text-xs text-gray-600 hover:text-red-400"
                    >
                      Descartar
                    </button>
                  </div>

                  {/* Detalle expandible */}
                  {isExpanded && (
                    <div className="border-t border-gray-700/50 px-3 pb-3 pt-2 space-y-1">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-gray-300 truncate mr-2">
                            {item.productName ?? item.productCode}
                          </span>
                          <span className="text-gray-400 shrink-0">
                            {formatWeight(item.weightKg)} · {formatARS(item.subtotal)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <DevScaleTicketPanel />
        </div>

        {/* Columna central: detalle del pedido seleccionado + acción de cobro */}
        <div className="flex flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-gray-800 px-6 py-3">
            <h2 className="text-sm font-semibold text-gray-200">
              {selectedOrder
                ? `Pedido canal ${selectedOrder.channel} — ${selectedOrder.items.length} ítem${selectedOrder.items.length !== 1 ? 's' : ''}`
                : 'Venta actual'}
            </h2>
            {selectedOrder && (
              <button onClick={clearSelection} className="text-xs text-gray-500 hover:text-red-400">
                Deseleccionar
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {!selectedOrder ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 space-y-2">
                <p className="text-4xl">🛒</p>
                <p className="text-sm">Seleccioná un pedido de la cola para cobrarlo</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-xs text-gray-500">
                    <th className="pb-2 text-left">Producto</th>
                    <th className="pb-2 text-right">Peso</th>
                    <th className="pb-2 text-right">Precio/kg</th>
                    <th className="pb-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedOrder.items.map((item, i) => (
                    <tr key={i} className="border-b border-gray-800/50">
                      <td className="py-2 text-gray-200">{item.productName ?? item.productCode}</td>
                      <td className="py-2 text-right text-gray-400">{formatWeight(item.weightKg)}</td>
                      <td className="py-2 text-right text-gray-400">{formatARS(item.unitPrice)}/kg</td>
                      <td className="py-2 text-right font-semibold text-white">{formatARS(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="pt-3 text-right text-sm font-bold text-gray-200">
                      Total
                    </td>
                    <td className="pt-3 text-right text-xl font-bold text-amber-400">
                      {formatARS(cartTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* Feedback + botón confirmar */}
          <div className="border-t border-gray-800 px-6 py-4 space-y-3">
            {error && (
              <p className="rounded-lg bg-red-900/40 px-4 py-2.5 text-xs text-red-300">{error}</p>
            )}
            {lastSaleId && (
              <p className="rounded-lg bg-green-900/40 px-4 py-2.5 text-xs text-green-300">
                ✓ Venta confirmada
              </p>
            )}
            <button
              onClick={openPaymentModal}
              disabled={loading || !selectedOrder}
              className="w-full rounded-xl bg-amber-500 py-4 font-bold text-white text-sm transition-colors hover:bg-amber-400 disabled:opacity-40"
            >
              {loading ? 'Procesando…' : `Confirmar venta · ${formatARS(cartTotal)}`}
            </button>
          </div>
        </div>
      </div>

      {/* Modal de cobro */}
      {showPaymentModal && selectedOrder && (
        <PaymentModal
          total={cartTotal}
          onConfirm={handleConfirmSale}
          onClose={() => setShowPaymentModal(false)}
        />
      )}
    </div>
  )
}
