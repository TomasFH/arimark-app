/**
 * Modal para registrar una venta como deuda ("fiado").
 *
 * Flujo:
 * 1. Cajera selecciona o crea un cliente.
 * 2. Indica cuánto pagó ahora y con qué medio (puede ser $0 = sin pago).
 * 3. Opcionalmente indica la fecha acordada de pago.
 * 4. Al confirmar se llama a onConfirm con los datos.
 *    El llamador es responsable de llamar a createSale + createDebt en secuencia.
 */
import { useState, useEffect } from 'react'
import CustomerSearchCreate from './CustomerSearchCreate'
import { formatARS } from '../lib/datetime'
import { formatPhoneInput } from '../lib/phoneInput'
import NumericInput from './NumericInput'
import { parseNumericInput, formatNumericInputValue } from '../lib/numericInput'
import type { CustomerRow, SalePaymentPayload } from '../types/hw-api'
import { PAYMENT_LABELS } from '../lib/paymentMethod'
import type { PaymentMethod } from '../lib/paymentMethod'
import { Button, Modal } from './ui'

interface Props {
  total: number
  onConfirm: (payload: {
    customerId?: string
    newCustomer?: { name: string; phone: string }
    initialPayment: number
    paymentMethods: SalePaymentPayload[]
    dueDate?: string
    notes?: string
  }) => void
  onClose: () => void
  loading?: boolean
  error?: string | null
}

const METHODS: PaymentMethod[] = ['cash', 'debit', 'wallet', 'credit']

const METHOD_ICONS: Record<PaymentMethod, string> = {
  cash: '💵',
  debit: '💳',
  wallet: '📱',
  credit: '🪙',
}

const fieldClass =
  'w-full rounded-xl border border-line bg-input px-3 py-2 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-line-accent'

export default function DebtModal({ total, onConfirm, onClose, loading = false, error }: Props) {
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null)
  const [pendingNewCustomer, setPendingNewCustomer] = useState<{ name: string; phone: string } | null>(null)
  const [initialPaymentRaw, setInitialPaymentRaw] = useState('0')
  const [dueDate, setDueDate] = useState('')
  const [dueDateError, setDueDateError] = useState('')
  const [notes, setNotes] = useState('')
  const [step, setStep] = useState<'pick-customer' | 'confirm'>('pick-customer')

  const [payMode, setPayMode] = useState<'single' | 'split'>('single')
  const [singleMethod, setSingleMethod] = useState<PaymentMethod>('cash')
  type SplitRow = { id: string; method: PaymentMethod; amountRaw: string }
  const [splitRows, setSplitRows] = useState<SplitRow[]>([
    { id: '1', method: 'cash', amountRaw: '' },
    { id: '2', method: 'debit', amountRaw: '' },
  ])

  const todayIso = new Date().toISOString().slice(0, 10)
  const initialPayment = parseNumericInput(initialPaymentRaw) ?? 0
  const debtAmount = Math.max(0, total - initialPayment)

  useEffect(() => {
    if (payMode === 'split') {
      setSplitRows(prev => prev.map((r, i) =>
        i === 0 ? { ...r, amountRaw: initialPayment > 0 ? formatNumericInputValue(String(initialPayment)) : '' } : r
      ))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPayment, payMode])

  function handleSelectCustomer(c: CustomerRow) {
    setSelectedCustomer(c)
    setPendingNewCustomer(null)
    setStep('confirm')
  }

  function handleCreateNew(data: { name: string; phone: string }) {
    setPendingNewCustomer(data)
    setSelectedCustomer(null)
    setStep('confirm')
  }

  function buildPaymentMethods(): SalePaymentPayload[] {
    if (initialPayment <= 0) return []
    if (payMode === 'single') {
      return [{ paymentMethod: singleMethod, amount: initialPayment }]
    }
    return splitRows
      .map(r => ({ paymentMethod: r.method, amount: parseNumericInput(r.amountRaw) ?? 0 }))
      .filter(p => p.amount > 0)
  }

  function splitTotal(): number {
    return splitRows.reduce((s, r) => s + (parseNumericInput(r.amountRaw) ?? 0), 0)
  }

  function handleConfirm() {
    if (dueDate && dueDate < todayIso) {
      setDueDateError('La fecha no puede ser anterior a hoy.')
      return
    }
    if (initialPayment > 0 && payMode === 'split') {
      const st = splitTotal()
      if (Math.abs(st - initialPayment) > 1) {
        setDueDateError(`Los medios de pago suman ${formatARS(st)}, pero el monto a cobrar es ${formatARS(initialPayment)}.`)
        return
      }
    }
    onConfirm({
      customerId: selectedCustomer?.id,
      newCustomer: pendingNewCustomer ?? undefined,
      initialPayment,
      paymentMethods: buildPaymentMethods(),
      dueDate: dueDate || undefined,
      notes: notes.trim() || undefined,
    })
  }

  const customerLabel = selectedCustomer?.name ?? pendingNewCustomer?.name ?? ''

  return (
    <Modal
      open
      onClose={onClose}
      closeOnOverlay={!loading}
      closeOnEscape={!loading}
      size="md"
      footer={step === 'confirm' ? (
        <>
          <Button variant="secondary" className="mr-auto" onClick={() => setStep('pick-customer')} disabled={loading}>
            Volver
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={loading || debtAmount <= 0}
            loading={loading}
          >
            {loading ? 'Registrando...' : `Registrar fiado · ${formatARS(debtAmount)}`}
          </Button>
        </>
      ) : (
        <Button variant="secondary" className="mr-auto" onClick={onClose} disabled={loading}>
          Cerrar
        </Button>
      )}
      header={(
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {step === 'confirm' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep('pick-customer')}
              disabled={loading}
              aria-label="Volver"
              className="px-2"
            >
              ←
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold tracking-tight text-ink" title="Cobro diferido (fiado)">
              Cobro diferido (fiado)
            </h2>
            <p className="text-2xl font-bold tabular-nums text-ink">{formatARS(total)}</p>
          </div>
        </div>
      )}
    >
      {step === 'pick-customer' && (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Buscá al cliente o escribí su nombre si no está registrado.
          </p>
          <CustomerSearchCreate
            onSelect={handleSelectCustomer}
            onCreateNew={handleCreateNew}
            autoFocus
          />
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-raised px-4 py-3">
            <p className="mb-0.5 text-xs text-muted">
              {selectedCustomer ? 'Cliente registrado' : 'Cliente nuevo (se creará al confirmar)'}
            </p>
            <p className="truncate text-base font-semibold text-ink" title={customerLabel}>{customerLabel}</p>
            {selectedCustomer?.phone && (
              <p className="mt-0.5 text-xs text-muted">{formatPhoneInput(selectedCustomer.phone)}</p>
            )}
            {pendingNewCustomer?.phone && (
              <p className="mt-0.5 text-xs text-muted">{formatPhoneInput(pendingNewCustomer.phone)}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted">
              ¿Cuánto paga ahora? <span className="text-subtle">(0 = no paga nada)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
              <NumericInput
                value={initialPaymentRaw}
                onChange={v => {
                  const n = parseNumericInput(v) ?? 0
                  setInitialPaymentRaw(n >= total ? String(total) : v)
                }}
                onFocus={e => e.target.select()}
                placeholder="0"
                className={`${fieldClass} pl-7`}
              />
            </div>
            {initialPayment > 0 && initialPayment < total && (
              <p className="mt-1 text-xs text-muted">
                Queda pendiente: <span className="font-semibold text-ink">{formatARS(debtAmount)}</span>
              </p>
            )}
          </div>

          {initialPayment > 0 && (
            <div className="space-y-2.5 rounded-xl border border-line bg-raised p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted">Medio de pago</p>
                <button
                  type="button"
                  onClick={() => setPayMode(m => m === 'single' ? 'split' : 'single')}
                  className="text-xs text-muted transition-colors hover:text-ink"
                >
                  {payMode === 'single' ? 'Dividir pago' : 'Un solo medio'}
                </button>
              </div>

              {payMode === 'single' && (
                <div className="grid grid-cols-4 gap-1.5">
                  {METHODS.map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSingleMethod(m)}
                      className={`flex flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-xs transition-colors ${
                        singleMethod === m
                          ? 'border-line-accent bg-accent-soft text-ink'
                          : 'border-line text-muted hover:border-line-strong hover:bg-hover'
                      }`}
                    >
                      <span className="text-base" aria-hidden>{METHOD_ICONS[m]}</span>
                      <span className="truncate" title={PAYMENT_LABELS[m]}>{PAYMENT_LABELS[m]}</span>
                    </button>
                  ))}
                </div>
              )}

              {payMode === 'split' && (
                <div className="space-y-2">
                  {splitRows.map((row, idx) => (
                    <div key={row.id} className="flex items-center gap-2 min-w-0">
                      <select
                        value={row.method}
                        onChange={e => setSplitRows(prev => prev.map(r =>
                          r.id === row.id ? { ...r, method: e.target.value as PaymentMethod } : r
                        ))}
                        className="min-w-0 flex-1 rounded-xl border border-line bg-input px-2 py-1.5 text-xs text-ink focus:border-line-accent focus:outline-none"
                      >
                        {METHODS.map(m => (
                          <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>
                        ))}
                      </select>
                      <div className="relative w-28 shrink-0">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">$</span>
                        <NumericInput
                          value={row.amountRaw}
                          onChange={v => setSplitRows(prev => prev.map(r =>
                            r.id === row.id ? { ...r, amountRaw: v } : r
                          ))}
                          placeholder="0"
                          className="w-full rounded-xl border border-line bg-input py-1.5 pl-5 pr-2 text-xs text-ink focus:border-line-accent focus:outline-none"
                        />
                      </div>
                      {splitRows.length > 2 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSplitRows(prev => prev.filter(r => r.id !== row.id))}
                          className="px-1 text-muted hover:text-danger"
                        >
                          ✕
                        </Button>
                      )}
                      {idx === splitRows.length - 1 && splitRows.length < 4 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSplitRows(prev => [
                            ...prev,
                            { id: String(Date.now()), method: 'debit', amountRaw: '' },
                          ])}
                        >
                          + fila
                        </Button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1 text-xs">
                    <span className="text-muted">Total ingresado</span>
                    <span className={`font-semibold tabular-nums ${Math.abs(splitTotal() - initialPayment) > 1 ? 'text-danger' : 'text-success'}`}>
                      {formatARS(splitTotal())} / {formatARS(initialPayment)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-muted">
              Fecha acordada de pago <span className="text-subtle">(opcional)</span>
            </label>
            <input
              type="date"
              value={dueDate}
              min={todayIso}
              onChange={e => { setDueDate(e.target.value); setDueDateError('') }}
              className={fieldClass}
            />
            {dueDateError && <p className="mt-1 text-xs text-danger">{dueDateError}</p>}
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted">
              Notas <span className="text-subtle">(opcional)</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="ej. paga el viernes, lleva solo la mitad…"
              rows={2}
              maxLength={500}
              className={`${fieldClass} resize-none`}
            />
          </div>

          {error && (
            <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
