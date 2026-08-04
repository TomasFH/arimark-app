/**
 * Pantalla de deudas pendientes.
 * Muestra el listado de clientes con saldo activo, con opción de
 * registrar pagos parciales o totales y cancelar deudas.
 *
 * Accesible desde el panel de cajera (botón "📒 Fiados") y desde el Admin Hub.
 */
import { useState, useEffect, useCallback } from 'react'
import BackButton from '../components/BackButton'
import { formatARS, formatRelativeDate } from '../lib/datetime'
import type { CustomerDebtSummary, DebtEventRow, StoreRow } from '../types/hw-api'
import NumericInput from '../components/NumericInput'
import { parseNumericInput, formatIntegerWithDots } from '../lib/numericInput'
import StoreFilter from '../components/StoreFilter'

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
    created: 'text-zinc-400',
    partial_payment: 'text-zinc-300',
    paid: 'text-emerald-400/80',
    cancelled: 'text-zinc-600',
    reopened: 'text-zinc-400',
  }

  return (
    <ul className="divide-y divide-zinc-800/50 text-xs mt-2">
      {[...events].reverse().map(e => (
        <li key={e.id} className="flex items-start justify-between gap-2 py-2">
          <div className="flex-1 min-w-0">
            <span className={`font-medium ${eventColors[e.eventType]}`}>
              {eventLabels[e.eventType]}
            </span>
            {e.notes && (
              <span className="ml-1.5 text-zinc-500 truncate">— {e.notes}</span>
            )}
            {e.dueDate && (
              <span className="ml-1.5 text-amber-600/70">
                · vence {formatRelativeDate(e.dueDate)}
              </span>
            )}
            <span className="block text-zinc-600 text-[10px]">
              {new Date(e.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          </div>
          <span className={`shrink-0 font-semibold font-mono ${e.amount > 0 ? 'text-red-400/70' : 'text-emerald-400/70'}`}>
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
}

function DebtCard({ summary, onPayment, onCancel }: DebtCardProps) {
  const [expanded, setExpanded] = useState(false)

  // Due date más próxima sin saldar
  const nextDueDate = summary.events
    .filter(e => e.eventType === 'created' && e.dueDate)
    .sort((a, b) => (a.dueDate! > b.dueDate! ? 1 : -1))[0]?.dueDate

  const isDue = nextDueDate && new Date(nextDueDate) <= new Date()

  return (
    <div className={`rounded-xl border ${isDue ? 'border-red-900/50 bg-red-950/20' : 'border-zinc-700 bg-zinc-900'} overflow-hidden`}>
      {/* Cabecera */}
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white text-sm">{summary.customerName}</span>
            {isDue && (
              <span className="text-[10px] bg-red-950/60 text-red-400/80 border border-red-900/40 rounded px-1.5 py-0.5 shrink-0">
                Vencida
              </span>
            )}
          </div>
          {(summary.customerDni || summary.customerPhone) && (
            <p className="text-xs text-zinc-500 mt-0.5">
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
          <p className="text-lg font-bold text-zinc-100 font-mono">{formatARS(summary.balance)}</p>
          <p className="text-[10px] text-zinc-600">saldo pendiente</p>
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
          className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 py-1.5 text-xs font-semibold text-zinc-400 hover:text-red-400 hover:border-red-800/60 transition-colors"
        >
          Cancelar deuda
        </button>
        <button
          onClick={() => setExpanded(p => !p)}
          className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          title={expanded ? 'Ocultar historial' : 'Ver historial'}
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {/* Ledger expandible */}
      {expanded && (
        <div className="border-t border-zinc-800 px-4 pb-3">
          <p className="text-[10px] text-zinc-600 mt-2 mb-1">Historial de eventos</p>
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
      <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-700 shadow-2xl p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-300">Registrar pago</h3>
          <p className="text-lg font-bold text-white">{summary.customerName}</p>
          <p className="text-xs text-zinc-500">Saldo: {formatARS(summary.balance)}</p>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Monto cobrado</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">$</span>
            <NumericInput
              value={amountRaw}
              onChange={setAmountRaw}
              autoFocus
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 pl-7 pr-3 py-2.5 text-white focus:border-amber-500 focus:outline-none"
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
          <label className="block text-xs text-zinc-400 mb-1">Notas <span className="text-zinc-600">(opcional)</span></label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="ej. pagó mitad en efectivo…"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
          />
        </div>

        {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded px-3 py-2">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={loading} className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 py-2.5 text-sm text-zinc-400 hover:text-white transition-colors">
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
  isAdmin?: boolean
}

export default function DebtsScreen({ onBack, isAdmin = false }: Props) {
  const [debts, setDebts] = useState<CustomerDebtSummary[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [storeIdFilter, setStoreIdFilter] = useState<string>('all')
  const [availableStores, setAvailableStores] = useState<StoreRow[]>([])

  // Estado para modal de pago
  const [payTarget, setPayTarget] = useState<CustomerDebtSummary | null>(null)
  const [payLoading, setPayLoading] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  // Estado para cancelación con doble confirmación
  const [cancelTarget, setCancelTarget] = useState<CustomerDebtSummary | null>(null)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  // Cargar locales al montar (solo admin)
  useEffect(() => {
    if (!isAdmin) return
    window.hw.getStores().then(r => {
      if (r.ok) setAvailableStores(r.data)
    })
  }, [isAdmin])

  const loadDebts = useCallback(async () => {
    setLoadingList(true)
    setListError(null)
    const res = await window.hw.getDebts(isAdmin ? { storeIdFilter } : undefined)
    setLoadingList(false)
    if (res.ok) setDebts(res.data)
    else setListError(res.error ?? 'Error al cargar deudas.')
  }, [isAdmin, storeIdFilter])

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

  const normalizeStr = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

  const filteredDebts = search.trim()
    ? debts.filter(d => normalizeStr(d.customerName).includes(normalizeStr(search.trim())))
    : debts

  return (
    <div className="flex flex-col flex-1 h-full bg-zinc-950 text-white">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/50 px-6 py-3 shrink-0">
        {onBack && <BackButton onClick={onBack} />}
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-zinc-100">Fiados / Cuentas corrientes</h1>
          <p className="text-xs text-zinc-500">
            {debts.length === 0 ? 'Sin deudas pendientes' : `${debts.length} cliente${debts.length > 1 ? 's' : ''} con saldo activo`}
          </p>
        </div>
        {isAdmin && availableStores.length > 0 && (
          <StoreFilter
            stores={availableStores}
            value={storeIdFilter}
            onChange={v => setStoreIdFilter(v)}
          />
        )}
        <button
          onClick={loadDebts}
          disabled={loadingList}
          className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 rounded-lg px-3 py-1.5 transition-colors"
        >
          {loadingList ? '...' : '↺ Actualizar'}
        </button>
      </header>

      {/* Alerta de vencimientos */}
      {dueSoonDebts.length > 0 && (
        <div className="border-b border-zinc-800 bg-zinc-900/50 px-6 py-2.5">
          <p className="text-xs text-zinc-500">
            {dueSoonDebts.length} deuda{dueSoonDebts.length > 1 ? 's' : ''} vencida{dueSoonDebts.length > 1 ? 's' : ''}: {dueSoonDebts.map(d => d.customerName).join(', ')}
          </p>
        </div>
      )}

      {/* Buscador */}
      {!loadingList && debts.length > 0 && (
        <div className="px-6 pt-4">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filtrar por nombre de cliente..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
          />
        </div>
      )}

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {loadingList && (
          <p className="text-sm text-zinc-500 text-center mt-12">Cargando...</p>
        )}
        {listError && (
          <p className="text-sm text-red-400 text-center mt-12">{listError}</p>
        )}
        {!loadingList && !listError && debts.length === 0 && (
          <div className="text-center mt-12 space-y-2">
            <p className="text-4xl">✅</p>
            <p className="text-sm text-zinc-400">No hay deudas pendientes.</p>
          </div>
        )}
        {!loadingList && !listError && debts.length > 0 && filteredDebts.length === 0 && (
          <p className="text-sm text-zinc-500 text-center mt-8">
            Ningún cliente coincide con "<span className="text-white">{search}</span>".
          </p>
        )}
        {filteredDebts.map(d => (
          <DebtCard
            key={d.customerId}
            summary={d}
            onPayment={() => { setPayTarget(d); setPayError(null) }}
            onCancel={() => { setCancelTarget(d); setCancelConfirm(false); setCancelError(null) }}
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

      {/* Modal de cancelación con doble confirmación */}
      {cancelTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget && !cancelLoading) setCancelTarget(null) }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-700 shadow-2xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-red-400">Cancelar deuda</h3>
            <p className="text-sm text-zinc-300">
              ¿Cancelar la deuda de <strong>{cancelTarget.customerName}</strong> por{' '}
              <strong className="text-amber-400">{formatARS(cancelTarget.balance)}</strong>?
            </p>
            <p className="text-xs text-zinc-500">
              El saldo quedará en cero. La acción quedará registrada en el historial y no borrará los eventos anteriores.
            </p>

            {!cancelConfirm ? (
              <button
                onClick={() => setCancelConfirm(true)}
                className="w-full rounded-lg bg-red-950/40 border border-red-900/50 py-2.5 text-sm font-semibold text-red-400/80 hover:bg-red-950/60 transition-colors"
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
                    className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 py-2.5 text-sm text-zinc-400 hover:text-white transition-colors"
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
              className="w-full text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Volver sin cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
