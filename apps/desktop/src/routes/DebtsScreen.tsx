/**
 * Pantalla de deudas pendientes.
 * Muestra el listado de clientes con saldo activo, con opción de
 * registrar pagos parciales o totales y cancelar deudas.
 *
 * Accesible desde el panel de cajera (botón "📒 Fiados") y desde el Admin Hub.
 */
import { useState, useEffect, useCallback } from 'react'
import { formatARS, formatRelativeDate } from '../lib/datetime'
import type { CustomerDebtSummary, DebtEventRow } from '../types/hw-api'
import NumericInput from '../components/NumericInput'
import { parseNumericInput, formatIntegerWithDots } from '../lib/numericInput'
import CustomerPricesModal from '../components/CustomerPricesModal'

// ---------------------------------------------------------------------------
// Sub-componente: ledger de eventos de un cliente
// ---------------------------------------------------------------------------

function DebtLedger({ events }: { events: DebtEventRow[] }) {
  const eventLabels: Record<DebtEventRow['eventType'], string> = {
    created: 'Deuda registrada',
    partial_payment: 'Pago parcial',
    paid: 'Pago total',
    cancelled: 'Deuda cancelada',
    reopened: 'Deuda reabierta',
  }
  const eventColors: Record<DebtEventRow['eventType'], string> = {
    created: 'text-amber-400',
    partial_payment: 'text-blue-400',
    paid: 'text-green-400',
    cancelled: 'text-gray-500',
    reopened: 'text-orange-400',
  }

  return (
    <ul className="divide-y divide-gray-800/50 text-xs mt-2">
      {[...events].reverse().map(e => (
        <li key={e.id} className="flex items-start justify-between gap-2 py-2">
          <div className="flex-1 min-w-0">
            <span className={`font-medium ${eventColors[e.eventType]}`}>
              {eventLabels[e.eventType]}
            </span>
            {e.notes && (
              <span className="ml-1.5 text-gray-500 truncate">— {e.notes}</span>
            )}
            {e.dueDate && (
              <span className="ml-1.5 text-amber-600/70">
                · vence {formatRelativeDate(e.dueDate)}
              </span>
            )}
            <span className="block text-gray-600 text-[10px]">
              {new Date(e.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          </div>
          <span className={`shrink-0 font-semibold ${e.amount > 0 ? 'text-red-400' : 'text-green-400'}`}>
            {e.amount > 0 ? '+' : ''}{formatARS(Math.abs(e.amount))}
          </span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Sub-componente: tarjeta de un cliente con deuda
// ---------------------------------------------------------------------------

interface DebtCardProps {
  summary: CustomerDebtSummary
  onPayment: () => void
  onCancel: () => void
  onEditPrices?: () => void
}

function DebtCard({ summary, onPayment, onCancel, onEditPrices }: DebtCardProps) {
  const [expanded, setExpanded] = useState(false)

  // Due date más próxima sin saldar
  const nextDueDate = summary.events
    .filter(e => e.eventType === 'created' && e.dueDate)
    .sort((a, b) => (a.dueDate! > b.dueDate! ? 1 : -1))[0]?.dueDate

  const isDue = nextDueDate && new Date(nextDueDate) <= new Date()

  return (
    <div className={`rounded-xl border ${isDue ? 'border-red-700/60 bg-red-950/20' : 'border-gray-700 bg-gray-900'} overflow-hidden`}>
      {/* Cabecera */}
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white text-sm">{summary.customerName}</span>
            {isDue && (
              <span className="text-[10px] bg-red-800/60 text-red-300 rounded px-1.5 py-0.5 shrink-0">
                Vencida
              </span>
            )}
          </div>
          {(summary.customerDni || summary.customerPhone) && (
            <p className="text-xs text-gray-500 mt-0.5">
              {[summary.customerDni, summary.customerPhone].filter(Boolean).join(' · ')}
            </p>
          )}
          {nextDueDate && (
            <p className={`text-xs mt-0.5 ${isDue ? 'text-red-400' : 'text-amber-500/70'}`}>
              Fecha acordada: {new Date(nextDueDate).toLocaleDateString('es-AR')}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold text-amber-400">{formatARS(summary.balance)}</p>
          <p className="text-[10px] text-gray-600">saldo pendiente</p>
        </div>
      </div>

      {/* Acciones */}
      <div className="flex gap-2 px-4 pb-3">
        <button
          onClick={onPayment}
          className="flex-1 rounded-lg bg-green-700/30 border border-green-700/50 py-1.5 text-xs font-semibold text-green-300 hover:bg-green-700/50 transition-colors"
        >
          💰 Registrar pago
        </button>
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg bg-gray-800 border border-gray-700 py-1.5 text-xs font-semibold text-gray-400 hover:text-red-400 hover:border-red-800/60 transition-colors"
        >
          Cancelar deuda
        </button>
        {onEditPrices && (
          <button
            onClick={onEditPrices}
            className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-xs text-gray-500 hover:text-amber-400 hover:border-amber-700/60 transition-colors"
            title="Precios especiales"
          >
            🏷️
          </button>
        )}
        <button
          onClick={() => setExpanded(p => !p)}
          className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          title={expanded ? 'Ocultar historial' : 'Ver historial'}
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {/* Ledger expandible */}
      {expanded && (
        <div className="border-t border-gray-800 px-4 pb-3">
          <p className="text-[10px] text-gray-600 mt-2 mb-1">Historial de eventos</p>
          <DebtLedger events={summary.events} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal: registrar pago
// ---------------------------------------------------------------------------

interface PaymentModalProps {
  summary: CustomerDebtSummary
  onConfirm: (amount: number, notes?: string) => void
  onClose: () => void
  loading: boolean
  error: string | null
}

function DebtPaymentModal({ summary, onConfirm, onClose, loading, error }: PaymentModalProps) {
  const [amountRaw, setAmountRaw] = useState(formatIntegerWithDots(String(Math.round(summary.balance))))
  const [notes, setNotes] = useState('')

  const amount = parseNumericInput(amountRaw) ?? 0
  const isValid = amount > 0 && amount <= summary.balance + 0.01

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget && !loading) onClose() }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 shadow-2xl p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-300">Registrar pago</h3>
          <p className="text-lg font-bold text-white">{summary.customerName}</p>
          <p className="text-xs text-gray-500">Saldo: {formatARS(summary.balance)}</p>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Monto cobrado</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
            <NumericInput
              value={amountRaw}
              onChange={setAmountRaw}
              autoFocus
              className="w-full rounded-lg border border-gray-700 bg-gray-800 pl-7 pr-3 py-2.5 text-white focus:border-amber-500 focus:outline-none"
            />
          </div>
          <button
            onClick={() => setAmountRaw(formatIntegerWithDots(String(Math.round(summary.balance))))}
            className="mt-1 text-xs text-amber-500 hover:text-amber-300 transition-colors"
          >
            Paga el total · {formatARS(summary.balance)}
          </button>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Notas <span className="text-gray-600">(opcional)</span></label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="ej. pagó mitad en efectivo…"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
          />
        </div>

        {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded px-3 py-2">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={loading} className="flex-1 rounded-lg bg-gray-800 border border-gray-700 py-2.5 text-sm text-gray-400 hover:text-white transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(amount, notes.trim() || undefined)}
            disabled={!isValid || loading}
            className="flex-1 rounded-lg bg-green-600 py-2.5 text-sm font-bold text-white hover:bg-green-500 transition-colors disabled:opacity-40"
          >
            {loading ? 'Registrando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pantalla principal
// ---------------------------------------------------------------------------

interface Props {
  onBack?: () => void
  /** Si se pasa, muestra el botón de precios especiales y solo es accesible para admins */
  isAdmin?: boolean
  storeId?: string
}

export default function DebtsScreen({ onBack, isAdmin = false, storeId }: Props) {
  const [debts, setDebts] = useState<CustomerDebtSummary[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  // Estado para modal de pago
  const [payTarget, setPayTarget] = useState<CustomerDebtSummary | null>(null)
  const [payLoading, setPayLoading] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  // Estado para cancelación con doble confirmación
  const [cancelTarget, setCancelTarget] = useState<CustomerDebtSummary | null>(null)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  // Estado para precios especiales (solo admins)
  const [pricesTarget, setPricesTarget] = useState<CustomerDebtSummary | null>(null)

  const loadDebts = useCallback(async () => {
    setLoadingList(true)
    setListError(null)
    const res = await window.hw.getDebts()
    setLoadingList(false)
    if (res.ok) setDebts(res.data)
    else setListError(res.error ?? 'Error al cargar deudas.')
  }, [])

  useEffect(() => { loadDebts() }, [loadDebts])

  async function handlePayment(amount: number, notes?: string) {
    if (!payTarget) return
    setPayLoading(true)
    setPayError(null)
    const res = await window.hw.addDebtPayment({ customerId: payTarget.customerId, amount, notes })
    setPayLoading(false)
    if (!res.ok) {
      setPayError(res.error ?? 'Error al registrar el pago.')
      return
    }
    setPayTarget(null)
    loadDebts()
  }

  async function handleCancelDebt() {
    if (!cancelTarget) return
    setCancelLoading(true)
    setCancelError(null)
    const res = await window.hw.cancelDebt({ customerId: cancelTarget.customerId })
    setCancelLoading(false)
    if (!res.ok) {
      setCancelError(res.error ?? 'Error al cancelar la deuda.')
      return
    }
    setCancelTarget(null)
    setCancelConfirm(false)
    loadDebts()
  }

  // Alertas de vencimiento: deudas vencidas o que vencen hoy
  const today = new Date().toISOString().slice(0, 10)
  const dueSoonDebts = debts.filter(d =>
    d.events.some(e => e.eventType === 'created' && e.dueDate && e.dueDate.slice(0, 10) <= today)
  )

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-gray-800 bg-gray-900 px-6 py-4">
        {onBack && (
          <button
            onClick={onBack}
            className="rounded-lg p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          >
            ←
          </button>
        )}
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-white">📒 Fiados / Cuentas corrientes</h1>
          <p className="text-xs text-gray-500">
            {debts.length === 0 ? 'Sin deudas pendientes' : `${debts.length} cliente${debts.length > 1 ? 's' : ''} con saldo activo`}
          </p>
        </div>
        <button
          onClick={loadDebts}
          disabled={loadingList}
          className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
        >
          {loadingList ? '...' : '↺ Actualizar'}
        </button>
      </header>

      {/* Alerta de vencimientos */}
      {dueSoonDebts.length > 0 && (
        <div className="border-b border-red-800/60 bg-red-950/30 px-6 py-3">
          <p className="text-xs font-semibold text-red-400">
            ⚠️ {dueSoonDebts.length} deuda{dueSoonDebts.length > 1 ? 's' : ''} vencida{dueSoonDebts.length > 1 ? 's' : ''}: {dueSoonDebts.map(d => d.customerName).join(', ')}
          </p>
        </div>
      )}

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {loadingList && (
          <p className="text-sm text-gray-500 text-center mt-12">Cargando...</p>
        )}
        {listError && (
          <p className="text-sm text-red-400 text-center mt-12">{listError}</p>
        )}
        {!loadingList && !listError && debts.length === 0 && (
          <div className="text-center mt-12 space-y-2">
            <p className="text-4xl">✅</p>
            <p className="text-sm text-gray-400">No hay deudas pendientes.</p>
          </div>
        )}
        {debts.map(d => (
          <DebtCard
            key={d.customerId}
            summary={d}
            onPayment={() => { setPayTarget(d); setPayError(null) }}
            onCancel={() => { setCancelTarget(d); setCancelConfirm(false); setCancelError(null) }}
            onEditPrices={isAdmin ? () => setPricesTarget(d) : undefined}
          />
        ))}
      </div>

      {/* Modal de pago */}
      {payTarget && (
        <DebtPaymentModal
          summary={payTarget}
          onConfirm={handlePayment}
          onClose={() => setPayTarget(null)}
          loading={payLoading}
          error={payError}
        />
      )}

      {/* Modal de precios especiales (solo admins) */}
      {pricesTarget && storeId && (
        <CustomerPricesModal
          customerId={pricesTarget.customerId}
          customerName={pricesTarget.customerName}
          storeId={storeId}
          onClose={() => setPricesTarget(null)}
        />
      )}

      {/* Modal de cancelación con doble confirmación */}
      {cancelTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget && !cancelLoading) setCancelTarget(null) }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 shadow-2xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-red-400">Cancelar deuda</h3>
            <p className="text-sm text-gray-300">
              ¿Cancelar la deuda de <strong>{cancelTarget.customerName}</strong> por{' '}
              <strong className="text-amber-400">{formatARS(cancelTarget.balance)}</strong>?
            </p>
            <p className="text-xs text-gray-500">
              El saldo quedará en cero. La acción quedará registrada en el historial y no borrará los eventos anteriores.
            </p>

            {!cancelConfirm ? (
              <button
                onClick={() => setCancelConfirm(true)}
                className="w-full rounded-lg bg-red-800/40 border border-red-700/60 py-2.5 text-sm font-semibold text-red-300 hover:bg-red-800/60 transition-colors"
              >
                Cancelar la deuda
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-red-400 font-medium text-center">¿Confirmás? Esta acción no se puede revertir.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCancelConfirm(false)}
                    disabled={cancelLoading}
                    className="flex-1 rounded-lg bg-gray-800 border border-gray-700 py-2.5 text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    No, volver
                  </button>
                  <button
                    onClick={handleCancelDebt}
                    disabled={cancelLoading}
                    className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-500 transition-colors disabled:opacity-40"
                  >
                    {cancelLoading ? 'Cancelando...' : 'Sí, cancelar'}
                  </button>
                </div>
              </div>
            )}

            {cancelError && <p className="text-xs text-red-400">{cancelError}</p>}

            <button
              onClick={() => setCancelTarget(null)}
              disabled={cancelLoading}
              className="w-full text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              Volver sin cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
