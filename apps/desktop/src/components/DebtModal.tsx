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

export default function DebtModal({ total, onConfirm, onClose, loading = false, error }: Props) {
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null)
  const [pendingNewCustomer, setPendingNewCustomer] = useState<{ name: string; phone: string } | null>(null)
  const [initialPaymentRaw, setInitialPaymentRaw] = useState('0')
  const [dueDate, setDueDate] = useState('')
  const [dueDateError, setDueDateError] = useState('')
  const [notes, setNotes] = useState('')
  const [step, setStep] = useState<'pick-customer' | 'confirm'>('pick-customer')

  // Pago del monto inicial: modo simple (un solo método) o dividido
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

  // Actualizar el primer split row cuando cambia initialPayment (por comodidad)
  useEffect(() => {
    if (payMode === 'split') {
      setSplitRows(prev => prev.map((r, i) =>
        i === 0 ? { ...r, amountRaw: initialPayment > 0 ? formatNumericInputValue(String(initialPayment)) : '' } : r
      ))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPayment, payMode])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !loading) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, loading])

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget && !loading) onClose() }}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-gray-900 border border-gray-700 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-800 px-6 py-4">
          {step === 'confirm' && (
            <button
              onClick={() => setStep('pick-customer')}
              disabled={loading}
              className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 disabled:opacity-40"
            >
              ←
            </button>
          )}
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-300">Cobro diferido (fiado)</h2>
            <p className="text-2xl font-bold text-amber-400">{formatARS(total)}</p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="p-6 max-h-[80vh] overflow-y-auto">
          {/* ── PASO 1: elegir cliente ── */}
          {step === 'pick-customer' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-400">
                Buscá al cliente o escribí su nombre si no está registrado.
              </p>
              <CustomerSearchCreate
                onSelect={handleSelectCustomer}
                onCreateNew={handleCreateNew}
                autoFocus
              />
            </div>
          )}

          {/* ── PASO 2: detalles del fiado ── */}
          {step === 'confirm' && (
            <div className="space-y-4">
              {/* Resumen del cliente */}
              <div className="rounded-xl border border-amber-700/50 bg-amber-900/20 px-4 py-3">
                <p className="text-xs text-amber-400/70 mb-0.5">
                  {selectedCustomer ? 'Cliente registrado' : 'Cliente nuevo (se creará al confirmar)'}
                </p>
                <p className="text-base font-semibold text-amber-300">{customerLabel}</p>
                {selectedCustomer?.phone && (
                  <p className="text-xs text-amber-400/60 mt-0.5">{formatPhoneInput(selectedCustomer.phone)}</p>
                )}
                {pendingNewCustomer?.phone && (
                  <p className="text-xs text-amber-400/60 mt-0.5">{formatPhoneInput(pendingNewCustomer.phone)}</p>
                )}
              </div>

              {/* Monto que paga ahora */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  ¿Cuánto paga ahora? <span className="text-gray-600">(0 = no paga nada)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                  <NumericInput
                    value={initialPaymentRaw}
                    onChange={v => {
                      const n = parseNumericInput(v) ?? 0
                      setInitialPaymentRaw(n >= total ? String(total) : v)
                    }}
                    onFocus={e => e.target.select()}
                    placeholder="0"
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 pl-7 pr-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>
                {initialPayment > 0 && initialPayment < total && (
                  <p className="text-xs text-amber-400/80 mt-1">
                    Queda pendiente: <span className="font-semibold">{formatARS(debtAmount)}</span>
                  </p>
                )}
              </div>

              {/* Medio de pago del monto inicial — solo si paga algo */}
              {initialPayment > 0 && (
                <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-gray-400 font-medium">Medio de pago</p>
                    <button
                      type="button"
                      onClick={() => setPayMode(m => m === 'single' ? 'split' : 'single')}
                      className="text-xs text-amber-500 hover:text-amber-400 transition-colors"
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
                              ? 'border-amber-500 bg-amber-900/30 text-amber-300'
                              : 'border-gray-700 text-gray-400 hover:border-gray-600'
                          }`}
                        >
                          <span className="text-base">{METHOD_ICONS[m]}</span>
                          <span>{PAYMENT_LABELS[m]}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {payMode === 'split' && (
                    <div className="space-y-2">
                      {splitRows.map((row, idx) => (
                        <div key={row.id} className="flex items-center gap-2">
                          <select
                            value={row.method}
                            onChange={e => setSplitRows(prev => prev.map(r =>
                              r.id === row.id ? { ...r, method: e.target.value as PaymentMethod } : r
                            ))}
                            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                          >
                            {METHODS.map(m => (
                              <option key={m} value={m}>{METHOD_ICONS[m]} {PAYMENT_LABELS[m]}</option>
                            ))}
                          </select>
                          <div className="relative w-28">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
                            <NumericInput
                              value={row.amountRaw}
                              onChange={v => setSplitRows(prev => prev.map(r =>
                                r.id === row.id ? { ...r, amountRaw: v } : r
                              ))}
                              placeholder="0"
                              className="w-full rounded-lg border border-gray-700 bg-gray-800 pl-5 pr-2 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                          {splitRows.length > 2 && (
                            <button type="button" onClick={() => setSplitRows(prev => prev.filter(r => r.id !== row.id))}
                              className="text-gray-600 hover:text-red-400 text-xs">✕</button>
                          )}
                          {idx === splitRows.length - 1 && splitRows.length < 4 && (
                            <button type="button"
                              onClick={() => setSplitRows(prev => [
                                ...prev,
                                { id: String(Date.now()), method: 'debit', amountRaw: '' }
                              ])}
                              className="text-amber-500 hover:text-amber-400 text-xs whitespace-nowrap">+ fila</button>
                          )}
                        </div>
                      ))}
                      <div className="flex items-center justify-between text-xs pt-1">
                        <span className="text-gray-500">Total ingresado</span>
                        <span className={`font-semibold ${Math.abs(splitTotal() - initialPayment) > 1 ? 'text-red-400' : 'text-green-400'}`}>
                          {formatARS(splitTotal())} / {formatARS(initialPayment)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Fecha de pago acordada */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Fecha acordada de pago <span className="text-gray-600">(opcional)</span>
                </label>
                <input
                  type="date"
                  value={dueDate}
                  min={todayIso}
                  onChange={e => { setDueDate(e.target.value); setDueDateError('') }}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none [color-scheme:dark]"
                />
                {dueDateError && <p className="text-xs text-red-400 mt-1">{dueDateError}</p>}
              </div>

              {/* Notas */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Notas <span className="text-gray-600">(opcional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="ej. paga el viernes, lleva solo la mitad…"
                  rows={2}
                  maxLength={500}
                  className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
                />
              </div>

              {error && (
                <p className="text-xs text-red-400 rounded-lg bg-red-900/20 border border-red-800/50 px-3 py-2">
                  {error}
                </p>
              )}

              <button
                onClick={handleConfirm}
                disabled={loading || debtAmount <= 0}
                className="w-full rounded-xl bg-amber-500 py-3.5 font-bold text-white text-sm transition-colors hover:bg-amber-400 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading && (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {loading ? 'Registrando...' : `Registrar fiado · ${formatARS(debtAmount)}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function DebtModal({ total, onConfirm, onClose, loading = false, error }: Props) {
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null)
  const [pendingNewCustomer, setPendingNewCustomer] = useState<{ name: string; phone: string } | null>(null)
  const [initialPaymentRaw, setInitialPaymentRaw] = useState('0')
  const [dueDate, setDueDate] = useState('')
  const [dueDateError, setDueDateError] = useState('')
  const [notes, setNotes] = useState('')
  const [step, setStep] = useState<'pick-customer' | 'confirm'>('pick-customer')

  const todayIso = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !loading) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, loading])

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

  function handleConfirm() {
    // Validar fecha
    if (dueDate && dueDate < todayIso) {
      setDueDateError('La fecha no puede ser anterior a hoy.')
      return
    }
    const initialPayment = parseNumericInput(initialPaymentRaw) ?? 0
    onConfirm({
      customerId: selectedCustomer?.id,
      newCustomer: pendingNewCustomer ?? undefined,
      initialPayment,
      dueDate: dueDate || undefined,
      notes: notes.trim() || undefined,
    })
  }

  const initialPayment = parseNumericInput(initialPaymentRaw) ?? 0
  const debtAmount = Math.max(0, total - initialPayment)
  const customerLabel = selectedCustomer?.name ?? pendingNewCustomer?.name ?? ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget && !loading) onClose() }}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-gray-900 border border-gray-700 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-800 px-6 py-4">
          {step === 'confirm' && (
            <button
              onClick={() => setStep('pick-customer')}
              disabled={loading}
              className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 disabled:opacity-40"
            >
              ←
            </button>
          )}
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-300">Cobro diferido (fiado)</h2>
            <p className="text-2xl font-bold text-amber-400">{formatARS(total)}</p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="p-6">
          {/* ── PASO 1: elegir cliente ── */}
          {step === 'pick-customer' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-400">
                Buscá al cliente o escribí su nombre si no está registrado.
              </p>
              <CustomerSearchCreate
                onSelect={handleSelectCustomer}
                onCreateNew={handleCreateNew}
                autoFocus
              />
            </div>
          )}

          {/* ── PASO 2: detalles del fiado ── */}
          {step === 'confirm' && (
            <div className="space-y-4">
              {/* Resumen del cliente */}
              <div className="rounded-xl border border-amber-700/50 bg-amber-900/20 px-4 py-3">
                <p className="text-xs text-amber-400/70 mb-0.5">
                  {selectedCustomer ? 'Cliente registrado' : 'Cliente nuevo (se creará al confirmar)'}
                </p>
                <p className="text-base font-semibold text-amber-300">{customerLabel}</p>
                {selectedCustomer?.phone && (
                  <p className="text-xs text-amber-400/60 mt-0.5">{formatPhoneInput(selectedCustomer.phone)}</p>
                )}
                {pendingNewCustomer?.phone && (
                  <p className="text-xs text-amber-400/60 mt-0.5">{formatPhoneInput(pendingNewCustomer.phone)}</p>
                )}
              </div>

              {/* Pago parcial ahora */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  ¿Cuánto paga ahora? <span className="text-gray-600">(0 = no paga nada)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                  <NumericInput
                    value={initialPaymentRaw}
                    onChange={v => {
                      const n = parseNumericInput(v) ?? 0
                      setInitialPaymentRaw(n >= total ? String(total) : v)
                    }}
                    onFocus={e => e.target.select()}
                    placeholder="0"
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 pl-7 pr-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>
                {initialPayment > 0 && initialPayment < total && (
                  <p className="text-xs text-amber-400/80 mt-1">
                    Queda pendiente: <span className="font-semibold">{formatARS(debtAmount)}</span>
                  </p>
                )}
              </div>

              {/* Fecha de pago acordada */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Fecha acordada de pago <span className="text-gray-600">(opcional)</span>
                </label>
                <input
                  type="date"
                  value={dueDate}
                  min={todayIso}
                  onChange={e => { setDueDate(e.target.value); setDueDateError('') }}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none [color-scheme:dark]"
                />
                {dueDateError && <p className="text-xs text-red-400 mt-1">{dueDateError}</p>}
              </div>

              {/* Notas */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Notas <span className="text-gray-600">(opcional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="ej. paga el viernes, lleva solo la mitad…"
                  rows={2}
                  maxLength={500}
                  className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
                />
              </div>

              {error && (
                <p className="text-xs text-red-400 rounded-lg bg-red-900/20 border border-red-800/50 px-3 py-2">
                  {error}
                </p>
              )}

              <button
                onClick={handleConfirm}
                disabled={loading || debtAmount <= 0}
                className="w-full rounded-xl bg-amber-500 py-3.5 font-bold text-white text-sm transition-colors hover:bg-amber-400 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading && (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {loading ? 'Registrando...' : `Registrar fiado · ${formatARS(debtAmount)}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
