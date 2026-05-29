import { useState, useEffect, useCallback } from 'react'
import DevScaleTicketPanel from '../components/DevScaleTicketPanel'
import PaymentModal from '../components/PaymentModal'
import type { ScaleTicketData, SalePaymentPayload, ShiftInfo, SessionInfo } from '../types/hw-api'
import { formatARS, formatKg as formatWeight } from '../lib/datetime'

interface Props {
  session: SessionInfo
  shift: ShiftInfo
  onLogout: () => void
}

/**
 * Extiende ScaleTicketData con un `localId` siempre presente para interacciones de UI.
 * Si el main process asignó un DB-id, se usa ese. En caso contrario se genera uno temporal
 * (prefijo "tmp-") que no viaja al backend como scaleTicketId.
 */
interface LocalTicket extends ScaleTicketData {
  localId: string
}

function toLocalTicket(ticket: ScaleTicketData): LocalTicket {
  return {
    ...ticket,
    localId: ticket.id ?? `tmp-${crypto.randomUUID()}`,
  }
}

export default function CashierScreen({ session, shift, onLogout }: Props) {
  const [ticketQueue, setTicketQueue] = useState<LocalTicket[]>([])
  const [selectedLocalIds, setSelectedLocalIds] = useState<Set<string>>(new Set())
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastSaleId, setLastSaleId] = useState<string | null>(null)

  // Suscripción a tickets de balanza
  useEffect(() => {
    const unsub = window.hw.onScaleTicket(ticket => {
      setTicketQueue(prev => [...prev, toLocalTicket(ticket)])
    })
    return unsub
  }, [])

  // Tickets seleccionados = ítems de la venta
  const cartTickets = ticketQueue.filter(t => selectedLocalIds.has(t.localId))

  const cartTotal = cartTickets.reduce((s, t) => s + t.subtotal, 0)

  const toggleTicket = useCallback((localId: string) => {
    setSelectedLocalIds(prev => {
      const next = new Set(prev)
      if (next.has(localId)) next.delete(localId)
      else next.add(localId)
      return next
    })
  }, [])

  function dismissTicket(localId: string) {
    setTicketQueue(prev => prev.filter(t => t.localId !== localId))
    setSelectedLocalIds(prev => {
      const n = new Set(prev)
      n.delete(localId)
      return n
    })
  }

  function clearCart() {
    setSelectedLocalIds(new Set())
    setError('')
    setLastSaleId(null)
  }

  async function handleConfirmSale(payments: SalePaymentPayload[]) {
    if (cartTickets.length === 0) {
      setError('Agregá al menos un ítem al carrito.')
      return
    }

    setLoading(true)
    setError('')
    setShowPaymentModal(false)

    try {
      const result = await window.hw.createSale({
        items: cartTickets.map(t => ({
          productId: t.productId ?? '00000000-0000-0000-0001-000000000099',
          quantity: t.weightKg,
          unitPrice: t.unitPrice,
          subtotal: t.subtotal,
          // Solo pasar scaleTicketId si es un ID real de DB (no temporal)
          scaleTicketId: t.id,
        })),
        payments,
      })

      if (!result.ok) {
        setError(result.error ?? 'Error al procesar la venta.')
        return
      }

      setLastSaleId(result.data.saleId)
      const confirmedIds = new Set(cartTickets.map(t => t.localId))
      setTicketQueue(prev => prev.filter(t => !confirmedIds.has(t.localId)))
      setSelectedLocalIds(new Set())
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
  const pendingCount = ticketQueue.filter(t => !selectedLocalIds.has(t.localId)).length

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
        {/* Columna izquierda: cola de tickets */}
        <div className="flex w-80 flex-col border-r border-gray-800 bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-200">Cola de balanza</h2>
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                {pendingCount}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {ticketQueue.length === 0 && (
              <p className="text-center text-xs text-gray-600 mt-8">
                Esperando tickets de la balanza…
              </p>
            )}
            {ticketQueue.map(ticket => {
              const isSelected = selectedLocalIds.has(ticket.localId)
              return (
                <div
                  key={ticket.localId}
                  className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                  }`}
                  onClick={() => toggleTicket(ticket.localId)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {ticket.productName ?? ticket.productCode}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatWeight(ticket.weightKg)} · ${ticket.unitPrice.toFixed(2)}/kg
                      </p>
                    </div>
                    <div className="ml-2 text-right shrink-0">
                      <p className="text-sm font-bold text-amber-400">{formatARS(ticket.subtotal)}</p>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          dismissTicket(ticket.localId)
                        }}
                        className="text-xs text-gray-600 hover:text-red-400 mt-1"
                      >
                        Descartar
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <DevScaleTicketPanel />
        </div>

        {/* Columna central: carrito + acción de cobro */}
        <div className="flex flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-gray-800 px-6 py-3">
            <h2 className="text-sm font-semibold text-gray-200">
              Venta actual{' '}
              {cartTickets.length > 0 && `(${cartTickets.length} ítem${cartTickets.length > 1 ? 's' : ''})`}
            </h2>
            {cartTickets.length > 0 && (
              <button onClick={clearCart} className="text-xs text-gray-500 hover:text-red-400">
                Limpiar
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {cartTickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 space-y-2">
                <p className="text-4xl">🛒</p>
                <p className="text-sm">Seleccioná tickets de la cola para agregarlos a la venta</p>
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
                  {cartTickets.map(ticket => (
                    <tr key={ticket.localId} className="border-b border-gray-800/50">
                      <td className="py-2 text-gray-200">{ticket.productName ?? ticket.productCode}</td>
                      <td className="py-2 text-right text-gray-400">{formatWeight(ticket.weightKg)}</td>
                      <td className="py-2 text-right text-gray-400">${ticket.unitPrice.toFixed(2)}</td>
                      <td className="py-2 text-right font-semibold text-white">{formatARS(ticket.subtotal)}</td>
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

          {/* Feedback de venta + botón confirmar */}
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
              disabled={loading || cartTickets.length === 0}
              className="w-full rounded-xl bg-amber-500 py-4 font-bold text-white text-sm transition-colors hover:bg-amber-400 disabled:opacity-40"
            >
              {loading ? 'Procesando…' : `Confirmar venta · ${formatARS(cartTotal)}`}
            </button>
          </div>
        </div>
      </div>

      {/* Modal de cobro */}
      {showPaymentModal && (
        <PaymentModal
          total={cartTotal}
          onConfirm={handleConfirmSale}
          onClose={() => setShowPaymentModal(false)}
        />
      )}
    </div>
  )
}
