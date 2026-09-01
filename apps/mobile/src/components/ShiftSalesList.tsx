/**
 * Lista de ventas del turno (espejo simplificado de ShiftSalesModal de desktop).
 * Confirmadas + anuladas tachadas. Anular pide confirmación.
 */
import { useState } from 'react'
import { useBackLayer } from '../lib/backStack'
import { cashFromPayments, resolvedSaleStatus } from '../lib/shiftCash'
import type { LocalSale, SalePaymentDraft } from '../types/pos'

interface Props {
  sales: LocalSale[]
  onCancelSale: (sale: LocalSale) => Promise<void>
  onClose: () => void
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(n)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  debit: 'Débito',
  wallet: 'Billetera',
  credit: 'Crédito',
}

function summarizePayments(payments: SalePaymentDraft[], isDebt: boolean): string {
  const parts = payments
    .filter(p => p.amount > 0)
    .map(p => METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod)
  if (parts.length === 0) return isDebt ? 'Fiado' : '—'
  if (isDebt) return `${parts.join(' + ')} · fiado`
  return parts.join(' + ')
}

export function ShiftSalesList({ sales, onCancelSale, onClose }: Props) {
  const [confirmSale, setConfirmSale] = useState<LocalSale | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useBackLayer(true, onClose)
  useBackLayer(Boolean(confirmSale), () => {
    if (!cancelling) {
      setConfirmSale(null)
      setCancelError(null)
    }
  })

  const ordered = [...sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const confirmed = ordered.filter(s => resolvedSaleStatus(s) === 'confirmed')
  const cancelledCount = ordered.length - confirmed.length

  async function handleCancel() {
    if (!confirmSale) return
    setCancelling(true)
    setCancelError(null)
    try {
      await onCancelSale(confirmSale)
      setConfirmSale(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo anular la venta.'
      setCancelError(msg)
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/80">
      <div className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-gray-900">
        <div className="flex items-center justify-between gap-2 border-b border-gray-800 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-white" title="Ventas de este turno">
              Ventas de este turno
            </h2>
            <p className="truncate text-xs text-gray-400">
              {confirmed.length} confirmada{confirmed.length !== 1 ? 's' : ''}
              {cancelledCount > 0 ? ` · ${cancelledCount} anulada${cancelledCount !== 1 ? 's' : ''}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300"
          >
            Cerrar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {ordered.length === 0 ? (
            <div className="py-16 text-center text-gray-500">
              <p className="mb-2 text-4xl">🧾</p>
              <p className="text-sm">Todavía no hay ventas en este turno</p>
            </div>
          ) : (
            ordered.map(sale => {
              const isCancelled = resolvedSaleStatus(sale) === 'cancelled'
              const cash = cashFromPayments(sale.payments)
              const summary = summarizePayments(sale.payments, sale.isDebt === true)
              return (
                <div
                  key={sale.id}
                  className={`rounded-xl bg-gray-800 px-4 py-3 ${isCancelled ? 'opacity-50' : ''}`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm font-semibold ${isCancelled ? 'text-gray-500 line-through' : 'text-white'}`}
                        title={formatTime(sale.createdAt)}
                      >
                        {formatTime(sale.createdAt)}
                        {sale.isDebt && !isCancelled ? ' · Fiado' : ''}
                      </p>
                      <p
                        className={`truncate text-xs ${isCancelled ? 'text-gray-500 line-through' : 'text-gray-400'}`}
                        title={
                          isCancelled
                            ? (sale.customerName ? `Anulada · ${sale.customerName}` : 'Anulada')
                            : (sale.customerName ? `${summary} · ${sale.customerName}` : summary)
                        }
                      >
                        {isCancelled ? 'Anulada' : summary}
                        {sale.customerName ? ` · ${sale.customerName}` : ''}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 font-bold ${isCancelled ? 'text-gray-500 line-through' : 'text-white'}`}
                    >
                      {formatARS(sale.total)}
                    </span>
                  </div>
                  {!isCancelled && cash > 0 && (
                    <p className="mt-1 text-xs text-emerald-400">Efectivo {formatARS(cash)}</p>
                  )}
                  {!isCancelled && (
                    <button
                      type="button"
                      onClick={() => { setConfirmSale(sale); setCancelError(null) }}
                      className="mt-2 w-full rounded-lg border border-red-900/50 py-2 text-sm font-semibold text-red-400 hover:bg-red-950/40"
                    >
                      Anular
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {confirmSale && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-gray-900 p-5">
            <h2 className="text-lg font-bold text-white">¿Anular esta venta?</h2>
            <p className="text-sm text-gray-400">
              Se va a anular la venta de {formatARS(confirmSale.total)} de las {formatTime(confirmSale.createdAt)}.
              El efectivo deja de contar en caja.
            </p>
            {cancelError && (
              <p className="rounded-lg border border-red-900/40 bg-red-950/30 p-3 text-sm text-red-400">
                {cancelError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={cancelling}
                onClick={() => { setConfirmSale(null); setCancelError(null) }}
                className="rounded-xl bg-gray-800 py-3 font-semibold text-white disabled:opacity-40"
              >
                Volver
              </button>
              <button
                type="button"
                disabled={cancelling}
                onClick={() => void handleCancel()}
                className="rounded-xl bg-red-700 py-3 font-bold text-white disabled:opacity-40"
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
