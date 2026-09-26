/**
 * Pantalla de deudas pendientes.
 * Muestra el listado de clientes con saldo activo, con opción de
 * registrar pagos parciales o totales y cancelar deudas.
 *
 * Accesible desde el panel de cajera (botón "📒 Fiados") y desde el Admin Hub.
 */
import { useState, useEffect, useCallback } from 'react'
import { formatARS, formatRelativeDate } from '../lib/datetime'
import { ActionMenu, Button, Modal, ScreenHeader } from '../components/ui'
import type { CustomerDebtSummary, DebtEventRow, StoreRow } from '../types/hw-api'
import NumericInput from '../components/NumericInput'
import { parseNumericInput, formatIntegerWithDots } from '../lib/numericInput'
import StoreFilter from '../components/StoreFilter'

const PAYMENT_METHOD_LABELS: Record<NonNullable<DebtEventRow['paymentMethod']>, string> = {
  cash: 'Efectivo',
  debit: 'Débito',
  wallet: 'Billetera Virtual',
  credit: 'Crédito',
}

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
    created: 'text-muted',
    partial_payment: 'text-ink',
    paid: 'text-success',
    cancelled: 'text-subtle',
    reopened: 'text-muted',
  }

  return (
    <ul className="divide-y divide-line text-xs mt-2">
      {[...events].reverse().map(e => (
        <li key={e.id} className="flex items-start justify-between gap-2 py-2">
          <div className="flex-1 min-w-0">
            <span className={`font-medium ${eventColors[e.eventType]}`}>
              {eventLabels[e.eventType]}
            </span>
            {e.paymentMethod && (
              <span className="ml-1.5 text-muted">
                · {PAYMENT_METHOD_LABELS[e.paymentMethod]}
              </span>
            )}
            {e.notes && (
              <span className="ml-1.5 text-muted truncate">— {e.notes}</span>
            )}
            {e.dueDate && (
              <span className="ml-1.5 text-amber-600/70">
                · vence {formatRelativeDate(e.dueDate)}
              </span>
            )}
            <span className="block text-subtle text-[10px]">
              {new Date(e.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          </div>
          <span className={`shrink-0 font-semibold font-mono ${e.amount > 0 ? 'text-danger' : 'text-success'}`}>
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
    <div className={`overflow-hidden rounded-2xl border ${isDue ? 'border-danger/40 bg-danger/5' : 'border-line bg-panel'}`}>
      <button
        type="button"
        onClick={() => setExpanded(p => !p)}
        className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left hover:bg-hover"
        aria-expanded={expanded}
        title={expanded ? 'Ocultar historial' : 'Ver historial'}
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-ink" title={summary.customerName}>{summary.customerName}</span>
            {isDue && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-danger ring-1 ring-danger/30">
                Vencida
              </span>
            )}
          </div>
          {(summary.customerDni || summary.customerPhone) && (
            <p className="mt-0.5 truncate text-xs text-muted">
              {[summary.customerDni, summary.customerPhone].filter(Boolean).join(' · ')}
            </p>
          )}
          {nextDueDate && (
            <p className={`mt-0.5 text-xs ${isDue ? 'text-danger' : 'text-amber-600'}`}>
              Fecha acordada: {new Date(nextDueDate).toLocaleDateString('es-AR')}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-lg font-bold text-ink">{formatARS(summary.balance)}</p>
          <p className="text-[10px] text-subtle">saldo pendiente</p>
        </div>
        <svg
          className={`mt-1 h-4 w-4 shrink-0 text-subtle transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <div className="flex items-center gap-2 px-4 py-3">
        <Button size="sm" onClick={onPayment}>Registrar pago</Button>
        <ActionMenu
          items={[{ id: 'cancel', label: 'Cancelar deuda', danger: true, onSelect: onCancel }]}
        />
      </div>

      {expanded && (
        <div className="border-t border-line px-4 pb-3">
          <p className="mb-1 mt-2 text-[10px] text-subtle">Historial de eventos</p>
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
  onConfirm: (amount: number, paymentMethod: NonNullable<DebtEventRow['paymentMethod']>, notes?: string) => void
  onClose: () => void
  loading: boolean
  error: string | null
}

function DebtPaymentModal({ summary, onConfirm, onClose, loading, error }: PaymentModalProps) {
  const [amountRaw, setAmountRaw] = useState(formatIntegerWithDots(String(Math.round(summary.balance))))
  const [notes, setNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<NonNullable<DebtEventRow['paymentMethod']> | null>(null)

  const amount = parseNumericInput(amountRaw) ?? 0
  const isValid = amount > 0 && amount <= summary.balance + 0.01 && paymentMethod !== null

  return (
    <Modal
      open
      onClose={loading ? () => {} : onClose}
      closeOnOverlay={!loading}
      size="sm"
      title="Registrar pago"
      footer={
        <>
          <Button variant="secondary" className="mr-auto" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button
            loading={loading}
            disabled={!isValid}
            onClick={() => {
              if (!paymentMethod) return
              onConfirm(amount, paymentMethod, notes.trim() || undefined)
            }}
          >
            Confirmar
          </Button>
        </>
      }
    >
        <p className="truncate text-lg font-bold text-ink" title={summary.customerName}>{summary.customerName}</p>
        <p className="mb-4 text-xs text-muted">Saldo: {formatARS(summary.balance)}</p>

        <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs text-muted">Monto cobrado</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
            <NumericInput
              value={amountRaw}
              onChange={setAmountRaw}
              autoFocus
              className="w-full rounded-lg border border-line bg-input py-2.5 pl-7 pr-3 text-ink focus:border-line-accent focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setAmountRaw(formatIntegerWithDots(String(Math.round(summary.balance))))}
            className="mt-1 text-xs text-muted transition-colors hover:text-ink"
          >
            Paga el total · {formatARS(summary.balance)}
          </button>
        </div>

        <div>
          <p className="mb-1.5 block text-xs text-muted">Medio de pago *</p>
          <div className="grid grid-cols-2 gap-2">
            {(['cash', 'debit', 'wallet', 'credit'] as const).map(method => (
              <button
                key={method}
                type="button"
                onClick={() => setPaymentMethod(method)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  paymentMethod === method
                    ? 'border-line-accent bg-accent-soft text-ink'
                    : 'border-line bg-panel text-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                {PAYMENT_METHOD_LABELS[method]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted">Notas <span className="text-subtle">(opcional)</span></label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="ej. pagó mitad en efectivo…"
            maxLength={500}
            className="w-full rounded-lg border border-line bg-input px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-line-accent focus:outline-none"
          />
        </div>

        {error && <p className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        </div>
    </Modal>
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

  const loadDebts = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoadingList(true)
    setListError(null)
    const res = await window.hw.getDebts(isAdmin ? { storeIdFilter } : undefined)
    setLoadingList(false)
    if (res.ok) setDebts(res.data)
    else setListError(res.error ?? 'Error al cargar deudas.')
  }, [isAdmin, storeIdFilter])

  useEffect(() => { void loadDebts() }, [loadDebts])

  useEffect(() => {
    return window.hw.onDebtSyncUpdated(() => { void loadDebts({ silent: true }) })
  }, [loadDebts])

  async function handlePayment(
    amount: number,
    paymentMethod: NonNullable<DebtEventRow['paymentMethod']>,
    notes?: string,
  ) {
    if (!payTarget) return
    setPayLoading(true)
    setPayError(null)
    const res = await window.hw.addDebtPayment({
      customerId: payTarget.customerId,
      amount,
      paymentMethod,
      notes,
      storeId: isAdmin ? storeIdFilter : undefined,
    })
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
    const res = await window.hw.cancelDebt({
      customerId: cancelTarget.customerId,
      storeId: isAdmin ? storeIdFilter : undefined,
    })
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
    <div className="flex h-full flex-1 flex-col bg-app text-ink">
      <ScreenHeader
        title="Fiados / Cuentas corrientes"
        subtitle={debts.length === 0 ? 'Sin deudas pendientes' : `${debts.length} cliente${debts.length > 1 ? 's' : ''} con saldo activo`}
        onBack={onBack}
        actions={
          <>
            {isAdmin && availableStores.length > 0 && (
              <StoreFilter
                stores={availableStores}
                value={storeIdFilter}
                onChange={v => setStoreIdFilter(v)}
              />
            )}
            <Button variant="ghost" size="sm" onClick={() => void loadDebts()} disabled={loadingList}>
              {loadingList ? '…' : 'Actualizar'}
            </Button>
          </>
        }
      />

      {/* Alerta de vencimientos */}
      {dueSoonDebts.length > 0 && (
        <div className="border-b border-line bg-panel px-6 py-2.5">
          <p className="text-xs text-muted">
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
            className="w-full rounded-lg border border-line bg-input px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:border-line-accent focus:outline-none"
          />
        </div>
      )}

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {loadingList && (
          <p className="text-sm text-muted text-center mt-12">Cargando...</p>
        )}
        {listError && (
          <p className="text-sm text-danger text-center mt-12">{listError}</p>
        )}
        {!loadingList && !listError && debts.length === 0 && (
          <div className="mt-12 space-y-2 text-center">
            <p className="text-sm text-muted">No hay deudas pendientes.</p>
          </div>
        )}
        {!loadingList && !listError && debts.length > 0 && filteredDebts.length === 0 && (
          <p className="text-sm text-muted text-center mt-8">
            Ningún cliente coincide con "<span className="text-ink">{search}</span>".
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
        <Modal
          open
          onClose={cancelLoading ? () => {} : () => setCancelTarget(null)}
          closeOnOverlay={!cancelLoading}
          size="sm"
          title="Cancelar deuda"
          footer={
            !cancelConfirm ? (
              <>
                <Button variant="secondary" className="mr-auto" onClick={() => setCancelTarget(null)} disabled={cancelLoading}>
                  Volver sin cancelar
                </Button>
                <Button variant="danger" onClick={() => setCancelConfirm(true)}>
                  Cancelar la deuda
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" className="mr-auto" onClick={() => setCancelConfirm(false)} disabled={cancelLoading}>
                  No, volver
                </Button>
                <Button variant="danger" loading={cancelLoading} onClick={() => void handleCancelDebt()}>
                  Sí, cancelar
                </Button>
              </>
            )
          }
        >
            <p className="text-sm text-ink">
              ¿Cancelar la deuda de <strong>{cancelTarget.customerName}</strong> por{' '}
              <strong className="text-amber-600">{formatARS(cancelTarget.balance)}</strong>?
            </p>
            <p className="mt-2 text-xs text-muted">
              El saldo quedará en cero. La acción quedará registrada en el historial y no borrará los eventos anteriores.
            </p>
            {cancelConfirm && (
              <p className="mt-3 text-center text-xs font-medium text-danger">¿Confirmás? Esta acción no se puede revertir.</p>
            )}
            {cancelError && <p className="mt-3 text-xs text-danger">{cancelError}</p>}
        </Modal>
      )}
    </div>
  )
}
