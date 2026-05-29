import { useState, useEffect, useCallback } from 'react'
import type { ScaleTicketData, SalePaymentPayload, ShiftInfo, SessionInfo } from '../types/hw-api'
import { formatARS, formatKg as formatWeight } from '../lib/datetime'

interface Props {
  session: SessionInfo
  shift: ShiftInfo
  onLogout: () => void
}

type PaymentDraft = {
  cash: string
  debit: string
  wallet: string
}

export default function CashierScreen({ session, shift, onLogout }: Props) {
  const [ticketQueue, setTicketQueue] = useState<ScaleTicketData[]>([])
  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set())
  const [manualItems, setManualItems] = useState<{ productId: string; productName: string; quantity: number; unitPrice: number; subtotal: number }[]>([])
  const [payment, setPayment] = useState<PaymentDraft>({ cash: '', debit: '', wallet: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastSaleId, setLastSaleId] = useState<string | null>(null)

  // Suscribirse a tickets de balanza
  useEffect(() => {
    const unsub = window.hw.onScaleTicket(ticket => {
      setTicketQueue(prev => [...prev, ticket])
    })
    return unsub
  }, [])

  // Tickets seleccionados + items manuales = carrito de la venta
  const cartTickets = ticketQueue.filter(t => t.id && selectedTickets.has(t.id))
  const allItems = [
    ...cartTickets.map(t => ({
      productId: t.productId ?? '00000000-0000-0000-0001-000000000099',
      productName: t.productName ?? t.productCode,
      quantity: t.weightKg,
      unitPrice: t.unitPrice,
      subtotal: t.subtotal,
      scaleTicketId: t.id,
    })),
    ...manualItems.map(i => ({ ...i, scaleTicketId: undefined })),
  ]

  const cartTotal = allItems.reduce((s, i) => s + i.subtotal, 0)
  const cashAmount = parseFloat(payment.cash) || 0
  const debitAmount = parseFloat(payment.debit) || 0
  const walletAmount = parseFloat(payment.wallet) || 0
  const totalPaid = cashAmount + debitAmount + walletAmount
  const change = totalPaid - cartTotal

  const toggleTicket = useCallback((id: string | undefined) => {
    if (!id) return
    setSelectedTickets(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  function dismissTicket(id: string | undefined) {
    if (!id) return
    setTicketQueue(prev => prev.filter(t => t.id !== id))
    setSelectedTickets(prev => { const n = new Set(prev); n.delete(id ?? ''); return n })
  }

  function clearCart() {
    setSelectedTickets(new Set())
    setManualItems([])
    setPayment({ cash: '', debit: '', wallet: '' })
    setError('')
    setLastSaleId(null)
  }

  async function handleConfirmSale() {
    if (allItems.length === 0) {
      setError('Agregá al menos un ítem al carrito.')
      return
    }
    if (Math.abs(totalPaid - cartTotal) > 0.01) {
      setError(`El total pagado ($${totalPaid.toFixed(2)}) no coincide con el total ($${cartTotal.toFixed(2)}).`)
      return
    }

    const payments: SalePaymentPayload[] = []
    if (cashAmount > 0) payments.push({ paymentMethod: 'cash', amount: cashAmount })
    if (debitAmount > 0) payments.push({ paymentMethod: 'debit', amount: debitAmount })
    if (walletAmount > 0) payments.push({ paymentMethod: 'wallet', amount: walletAmount })

    if (payments.length === 0) {
      setError('Seleccioná al menos un método de pago.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const result = await window.hw.createSale({
        items: allItems.map(i => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          subtotal: i.subtotal,
          scaleTicketId: i.scaleTicketId,
        })),
        payments,
      })

      if (!result.ok) {
        setError(result.error ?? 'Error al procesar la venta.')
        return
      }

      setLastSaleId(result.data.saleId)
      // Remover tickets confirmados de la cola
      const confirmedIds = cartTickets.map(t => t.id).filter(Boolean) as string[]
      setTicketQueue(prev => prev.filter(t => !confirmedIds.includes(t.id ?? '')))
      setSelectedTickets(new Set())
      setManualItems([])
      setPayment({ cash: '', debit: '', wallet: '' })
    } catch {
      setError('Error de comunicación. Reintentar.')
    } finally {
      setLoading(false)
    }
  }

  const shiftLabel = shift.shiftType === 'morning' ? '🌅 Mañana' : '🌙 Tarde'
  const pendingCount = ticketQueue.filter(t => t.id && !selectedTickets.has(t.id)).length

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
              <p className="text-center text-xs text-gray-600 mt-8">Esperando tickets de la balanza…</p>
            )}
            {ticketQueue.map((ticket, idx) => {
              const isSelected = ticket.id ? selectedTickets.has(ticket.id) : false
              return (
                <div
                  key={ticket.id ?? idx}
                  className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                  }`}
                  onClick={() => toggleTicket(ticket.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {ticket.productName ?? ticket.productCode}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatWeight(ticket.weightKg)} kg · ${ticket.unitPrice.toFixed(2)}/kg
                      </p>
                    </div>
                    <div className="ml-2 text-right">
                      <p className="text-sm font-bold text-amber-400">{formatARS(ticket.subtotal)}</p>
                      <button
                        onClick={e => { e.stopPropagation(); dismissTicket(ticket.id) }}
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
        </div>

        {/* Columna central: carrito */}
        <div className="flex flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-gray-800 px-6 py-3">
            <h2 className="text-sm font-semibold text-gray-200">
              Venta actual {allItems.length > 0 && `(${allItems.length} ítem${allItems.length > 1 ? 's' : ''})`}
            </h2>
            {allItems.length > 0 && (
              <button onClick={clearCart} className="text-xs text-gray-500 hover:text-red-400">
                Limpiar
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {allItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 space-y-2">
                <p className="text-4xl">🛒</p>
                <p className="text-sm">Seleccioná tickets de la cola o agregá ítems manuales</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-xs text-gray-500">
                    <th className="pb-2 text-left">Producto</th>
                    <th className="pb-2 text-right">Cant.</th>
                    <th className="pb-2 text-right">Precio</th>
                    <th className="pb-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {allItems.map((item, i) => (
                    <tr key={i} className="border-b border-gray-800/50">
                      <td className="py-2 text-gray-200">{item.productName}</td>
                      <td className="py-2 text-right text-gray-400">{formatWeight(item.quantity)} kg</td>
                      <td className="py-2 text-right text-gray-400">${item.unitPrice.toFixed(2)}</td>
                      <td className="py-2 text-right font-semibold text-white">{formatARS(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="pt-3 text-right text-sm font-bold text-gray-200">Total</td>
                    <td className="pt-3 text-right text-lg font-bold text-amber-400">{formatARS(cartTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        {/* Columna derecha: pagos */}
        <div className="flex w-72 flex-col border-l border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-200">Cobro</h2>
          </div>

          <div className="flex-1 p-4 space-y-3">
            {/* Efectivo */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400">💵 Efectivo</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={payment.cash}
                  onChange={e => setPayment(p => ({ ...p, cash: e.target.value }))}
                  placeholder="0,00"
                  className="w-full rounded-lg bg-gray-800 pl-7 pr-3 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500 text-sm"
                />
              </div>
            </div>

            {/* Débito */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400">💳 Débito</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={payment.debit}
                  onChange={e => setPayment(p => ({ ...p, debit: e.target.value }))}
                  placeholder="0,00"
                  className="w-full rounded-lg bg-gray-800 pl-7 pr-3 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>

            {/* Billetera virtual */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400">📱 Billetera virtual</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={payment.wallet}
                  onChange={e => setPayment(p => ({ ...p, wallet: e.target.value }))}
                  placeholder="0,00"
                  className="w-full rounded-lg bg-gray-800 pl-7 pr-3 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500 text-sm"
                />
              </div>
            </div>

            {/* Resumen de pago */}
            {totalPaid > 0 && (
              <div className="rounded-lg bg-gray-800 p-3 space-y-1 text-sm">
                <div className="flex justify-between text-gray-400">
                  <span>Total venta</span>
                  <span>{formatARS(cartTotal)}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Cobrado</span>
                  <span>{formatARS(totalPaid)}</span>
                </div>
                {change > 0.005 && (
                  <div className="flex justify-between font-bold text-green-400 border-t border-gray-700 pt-1 mt-1">
                    <span>Vuelto</span>
                    <span>{formatARS(change)}</span>
                  </div>
                )}
                {change < -0.005 && (
                  <div className="flex justify-between font-bold text-red-400 border-t border-gray-700 pt-1 mt-1">
                    <span>Falta cobrar</span>
                    <span>{formatARS(Math.abs(change))}</span>
                  </div>
                )}
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-red-900/40 px-3 py-2 text-xs text-red-300">{error}</p>
            )}

            {lastSaleId && (
              <p className="rounded-lg bg-green-900/40 px-3 py-2 text-xs text-green-300">
                ✓ Venta confirmada
              </p>
            )}
          </div>

          {/* Botón confirmar */}
          <div className="border-t border-gray-800 p-4">
            <button
              onClick={handleConfirmSale}
              disabled={loading || allItems.length === 0}
              className="w-full rounded-lg bg-amber-500 py-3.5 font-bold text-white text-sm transition-colors hover:bg-amber-400 disabled:opacity-40"
            >
              {loading ? 'Procesando…' : `Confirmar venta · ${formatARS(cartTotal)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
