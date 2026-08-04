import { useState, useEffect } from 'react'
import NumericInput from './NumericInput'
import { parseNumericInput, formatIntegerWithDots } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import type { SalePaymentPayload } from '../types/hw-api'

type PaymentMethod = 'cash' | 'debit' | 'wallet' | 'credit'

interface PaymentRow {
  id: string
  method: PaymentMethod
  amount: string
  /** Solo para filas con method='credit': número de cuotas seleccionadas. */
  installments?: number
}

interface Props {
  total: number
  onConfirm: (payments: SalePaymentPayload[], notes?: string) => void
  /** Llamado cuando la cajera elige cobro diferido (fiado). */
  onFiado?: () => void
  onClose: () => void
}

type ModalMode = 'single' | 'cash-detail' | 'digital-confirm' | 'credit-detail' | 'split'

const CREDIT_PRESET_INSTALLMENTS = [1, 3, 6, 12, 18, 24]

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  debit: 'Débito',
  wallet: 'Billetera Virtual',
  credit: 'Crédito',
}

const METHOD_ICONS: Record<PaymentMethod, string> = {
  cash: '💵',
  debit: '💳',
  wallet: '📱',
  credit: '🏦',
}

export default function PaymentModal({ total, onConfirm, onFiado, onClose }: Props) {
  const [mode, setMode] = useState<ModalMode>('single')
  const [clientCash, setClientCash] = useState('')
  const [notes, setNotes] = useState('')
  /** Método seleccionado pendiente de confirmación (digital-confirm / credit-detail). */
  const [pendingMethod, setPendingMethod] = useState<PaymentMethod | null>(null)
  /** Cuotas para crédito — string para permitir tipeo libre. */
  const [installmentsRaw, setInstallmentsRaw] = useState('')
  const [rows, setRows] = useState<PaymentRow[]>([
    { id: crypto.randomUUID(), method: 'debit', amount: '' },
    { id: crypto.randomUUID(), method: 'cash', amount: '' },
  ])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (mode !== 'single') {
          setMode('single')
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, onClose])

  function confirmWithNotes(payments: SalePaymentPayload[]) {
    const trimmed = notes.trim()
    onConfirm(payments, trimmed || undefined)
  }

  // ── MODO SIMPLE: botón de método ──────────────────────────────────────────

  function handleSingleMethod(method: PaymentMethod) {
    setPendingMethod(method)
    if (method === 'cash') {
      setMode('cash-detail')
    } else if (method === 'credit') {
      setInstallmentsRaw('')
      setMode('credit-detail')
    } else {
      // débito / billetera virtual → pantalla de confirmación
      setMode('digital-confirm')
    }
  }

  // ── MODO EFECTIVO: calcular vuelto ────────────────────────────────────────

  const clientCashAmount = parseNumericInput(clientCash) ?? 0
  const cashChange = clientCashAmount > 0.005 ? clientCashAmount - total : 0
  const cashInsufficient = clientCashAmount > 0.005 && clientCashAmount < total - 0.005

  function handleCashConfirm() {
    confirmWithNotes([{ paymentMethod: 'cash', amount: total }])
  }

  // ── MODO CONFIRMACIÓN DIGITAL (débito / billetera) ─────────────────────────

  function handleDigitalConfirm() {
    if (!pendingMethod) return
    confirmWithNotes([{ paymentMethod: pendingMethod, amount: total }])
  }

  // ── MODO CRÉDITO (cuotas) ─────────────────────────────────────────────────

  const installments = parseNumericInput(installmentsRaw) ?? 0
  const installmentsValid = installments >= 1
  const perInstallment = installmentsValid ? Math.ceil(total / installments) : 0

  function handleCreditPreset(n: number) {
    setInstallmentsRaw(String(n))
  }

  function handleCreditConfirm() {
    confirmWithNotes([{ paymentMethod: 'credit', amount: total, installments }])
  }

  // ── MODO DIVIDIDO ──────────────────────────────────────────────────────────

  const [focusedRowId, setFocusedRowId] = useState<string | null>(null)

  const cashRowCount = rows.filter(r => r.method === 'cash').length
  const cashAlreadyUsed = cashRowCount > 0

  const rowSum = rows.reduce((s, r) => s + (parseNumericInput(r.amount) ?? 0), 0)
  const totalCovered = Math.abs(rowSum - total) < 1

  const rowSumExcludingFocused = rows
    .filter(r => r.id !== focusedRowId)
    .reduce((s, r) => s + (parseNumericInput(r.amount) ?? 0), 0)
  const remaining = totalCovered ? 0 : total - rowSumExcludingFocused

  const splitValid = totalCovered

  function addRow() {
    const defaultMethod: PaymentMethod = cashAlreadyUsed ? 'debit' : 'cash'
    setRows(prev => [...prev, { id: crypto.randomUUID(), method: defaultMethod, amount: '' }])
  }

  function removeRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id))
  }

  function updateRow(id: string, patch: Partial<PaymentRow>) {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }

  function getRowRemainder(id: string): number {
    const others = rows
      .filter(r => r.id !== id)
      .reduce((s, r) => s + (parseNumericInput(r.amount) ?? 0), 0)
    return Math.max(0, Math.round(total - others))
  }

  function fillRowRemainder(id: string) {
    const rem = getRowRemainder(id)
    if (rem > 0) {
      updateRow(id, { amount: formatIntegerWithDots(String(rem)) })
      setFocusedRowId(null)
    }
  }

  function handleSplitConfirm() {
    const payments: SalePaymentPayload[] = rows
      .filter(r => (parseNumericInput(r.amount) ?? 0) > 0.005)
      .map(r => ({
        paymentMethod: r.method,
        amount: parseNumericInput(r.amount) ?? 0,
        ...(r.method === 'credit' && r.installments ? { installments: r.installments } : {}),
      }))
    confirmWithNotes(payments)
  }

  const balanceColor =
    Math.abs(remaining) < 1
      ? 'border-emerald-700/50 bg-emerald-900/20 text-emerald-300'
      : remaining > 0
        ? 'border-zinc-700 bg-zinc-800/30 text-zinc-300'
        : 'border-red-700/50 bg-red-900/20 text-red-300'

  const balanceValueColor =
    Math.abs(remaining) < 1 ? 'text-emerald-400' : remaining > 0 ? 'text-zinc-300' : 'text-red-400'

  // ── Header title ──────────────────────────────────────────────────────────

  const headerTitle = (() => {
    if (mode === 'single') return 'Cobrar venta'
    if (mode === 'cash-detail') return 'Cobro en efectivo'
    if (mode === 'split') return 'Cobro dividido'
    if (mode === 'digital-confirm' && pendingMethod)
      return `Confirmar cobro — ${METHOD_LABELS[pendingMethod]}`
    if (mode === 'credit-detail') return 'Cobro con crédito'
    return 'Cobrar venta'
  })()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-700 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-zinc-800 px-6 py-4">
          {mode !== 'single' && (
            <button
              onClick={() => setMode('single')}
              className="shrink-0 rounded-lg p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              title="Volver"
            >
              ←
            </button>
          )}
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-zinc-300">{headerTitle}</h2>
            <p className="text-2xl font-bold font-mono text-zinc-100">{formatARS(total)}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        {/* Notas opcionales — visibles en todos los modos de cobro */}
        <div className="border-b border-zinc-800 px-6 py-3">
          <label htmlFor="sale-notes" className="block text-[10px] text-zinc-500 mb-1">
            Notas de la venta <span className="text-zinc-600">(opcional)</span>
          </label>
          <textarea
            id="sale-notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="ej. precio especial a familiar, pedido para retirar…"
            rows={2}
            maxLength={500}
            className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
        </div>

        {/* Body */}
        <div className="p-6">
          {/* ── MODO SIMPLE ── */}
          {mode === 'single' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleSingleMethod('cash')}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-zinc-700 bg-zinc-800 p-5 text-center transition-all hover:border-zinc-500 hover:bg-zinc-700/30"
                >
                  <span className="text-3xl">💵</span>
                  <span className="text-sm font-semibold text-white">Efectivo</span>
                </button>

                <button
                  onClick={() => handleSingleMethod('debit')}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-zinc-700 bg-zinc-800 p-5 text-center transition-all hover:border-zinc-500 hover:bg-zinc-700/30"
                >
                  <span className="text-3xl">💳</span>
                  <span className="text-sm font-semibold text-white">Débito</span>
                </button>

                <button
                  onClick={() => handleSingleMethod('wallet')}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-zinc-700 bg-zinc-800 p-5 text-center transition-all hover:border-zinc-500 hover:bg-zinc-700/30"
                >
                  <span className="text-3xl">📱</span>
                  <span className="text-sm font-semibold text-white">Billetera Virtual</span>
                </button>

                <button
                  onClick={() => handleSingleMethod('credit')}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-red-900/60 bg-red-950/40 p-5 text-center transition-all hover:border-red-700 hover:bg-red-950/60"
                >
                  <span className="text-3xl">🏦</span>
                  <span className="text-sm font-semibold text-red-400">Crédito</span>
                  <span className="text-[10px] text-red-500/80 leading-tight">uso excepcional</span>
                </button>
              </div>

              <div className="mt-5 flex items-center justify-between">
                <button
                  onClick={() => setMode('split')}
                  className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition-colors"
                >
                  Dividir en varios medios de pago
                </button>
                {onFiado && (
                  <button
                    onClick={onFiado}
                    className="text-xs text-zinc-300 hover:text-zinc-100 border border-zinc-700 rounded-lg px-3 py-1.5 hover:bg-zinc-800 transition-colors font-medium"
                    title="El cliente se lleva la mercadería y paga después"
                  >
                    📒 Fiado
                  </button>
                )}
              </div>
            </>
          )}

          {/* ── MODO EFECTIVO CON VUELTO ── */}
          {mode === 'cash-detail' && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm text-zinc-300">
                    ¿Con cuánto paga el cliente?
                  </label>
                  <button
                    type="button"
                    onClick={() => setClientCash(formatIntegerWithDots(String(Math.round(total))))}
                    className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-2 py-0.5 hover:bg-zinc-800 transition-colors"
                  >
                    Paga justo · {formatARS(total)}
                  </button>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">$</span>
                  <NumericInput
                    value={clientCash}
                    onChange={setClientCash}
                    placeholder="Monto recibido"
                    autoFocus
                    className="w-full rounded-xl bg-zinc-800 pl-8 pr-4 py-3 text-lg text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-500 border border-zinc-700"
                  />
                </div>
                {clientCash === '' && (
                  <p className="text-xs text-zinc-500">
                    Ingresá el monto que entrega el cliente para calcular el vuelto, o usá el botón si paga con el monto exacto.
                  </p>
                )}
              </div>

              {cashChange > 0.005 && (
                <div className="rounded-xl border border-green-700/50 bg-green-900/20 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-green-300">Vuelto a entregar</span>
                    <span className="text-2xl font-bold text-green-400">{formatARS(cashChange)}</span>
                  </div>
                </div>
              )}

              {cashInsufficient && (
                <p className="text-xs text-red-400">
                  El cliente debe pagar al menos {formatARS(total)}.
                </p>
              )}

              <button
                onClick={handleCashConfirm}
                disabled={cashInsufficient || clientCash === ''}
                className="w-full rounded-xl bg-emerald-600 py-3.5 font-bold text-white text-sm transition-colors hover:bg-emerald-500 disabled:opacity-40"
              >
                Confirmar cobro · {formatARS(total)}
              </button>
            </div>
          )}

          {/* ── MODO CONFIRMACIÓN DIGITAL (débito / billetera virtual) ── */}
          {mode === 'digital-confirm' && pendingMethod && (
            <div className="space-y-5">
              <div className="rounded-xl border border-zinc-700 bg-zinc-800 p-5 text-center space-y-2">
                <p className="text-4xl">{METHOD_ICONS[pendingMethod]}</p>
                <p className="text-base font-semibold text-white">{METHOD_LABELS[pendingMethod]}</p>
                <p className="text-3xl font-bold font-mono text-zinc-100">{formatARS(total)}</p>
              </div>

              <p className="text-xs text-zinc-500 text-center">
                Confirmá que el cliente pagó {formatARS(total)} con {METHOD_LABELS[pendingMethod]}.
              </p>

              <button
                onClick={handleDigitalConfirm}
                className="w-full rounded-xl bg-emerald-600 py-3.5 font-bold text-white text-sm transition-colors hover:bg-emerald-500"
              >
                Confirmar cobro · {formatARS(total)}
              </button>

              <button
                onClick={() => setMode('single')}
                className="w-full rounded-lg bg-zinc-700 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-600"
              >
                ← Cambiar medio de pago
              </button>
            </div>
          )}

          {/* ── MODO CRÉDITO (cuotas) ── */}
          {mode === 'credit-detail' && (
            <div className="space-y-5">
              <div>
                <p className="text-sm text-zinc-300 mb-3">¿En cuántas cuotas?</p>

                {/* Opciones rápidas */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {CREDIT_PRESET_INSTALLMENTS.map(n => (
                    <button
                      key={n}
                      onClick={() => handleCreditPreset(n)}
                      className={`rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                        installments === n
                          ? 'bg-zinc-700 text-zinc-100'
                          : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-700/30'
                      }`}
                    >
                      {n === 1 ? 'Contado' : `${n}×`}
                    </button>
                  ))}
                </div>

                {/* Entrada manual de cuotas */}
                <div className="relative">
                  <NumericInput
                    value={installmentsRaw}
                    onChange={setInstallmentsRaw}
                    placeholder="Otro número de cuotas…"
                    className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-500"
                  />
                </div>
              </div>

              {/* Desglose por cuota */}
              {installmentsValid && installments > 1 && (
                <div className="rounded-xl border border-zinc-700 bg-zinc-800/30 p-4 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Total</span>
                    <span className="font-semibold text-white">{formatARS(total)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">{installments} cuotas de</span>
                    <span className="font-bold text-zinc-200">{formatARS(perInstallment)}</span>
                  </div>
                </div>
              )}

              {installmentsValid && installments === 1 && (
                <p className="text-xs text-zinc-500 text-center">
                  Crédito en 1 pago (contado con tarjeta).
                </p>
              )}

              <button
                onClick={handleCreditConfirm}
                disabled={!installmentsValid}
                className="w-full rounded-xl bg-emerald-600 py-3.5 font-bold text-white text-sm transition-colors hover:bg-emerald-500 disabled:opacity-40"
              >
                {installmentsValid && installments > 1
                  ? `Confirmar · ${installments} cuotas de ${formatARS(perInstallment)}`
                  : `Confirmar cobro · ${formatARS(total)}`}
              </button>

              <button
                onClick={() => setMode('single')}
                className="w-full rounded-lg bg-zinc-700 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-600"
              >
                ← Cambiar medio de pago
              </button>
            </div>
          )}

          {/* ── MODO DIVIDIDO ── */}
          {mode === 'split' && (
            <div className="space-y-3">
              {rows.map(row => {
                const isCashRow = row.method === 'cash'
                const rowRem = getRowRemainder(row.id)
                const rowAmount = parseNumericInput(row.amount) ?? 0
                const showFillBtn = !totalCovered && rowRem > 0 && rowAmount <= 0
                const isCreditRow = row.method === 'credit'
                const rowInstallments = row.installments ?? 1
                const rowAmountParsed = parseNumericInput(row.amount) ?? 0
                const perInstallment = isCreditRow && rowInstallments > 1 && rowAmountParsed > 0
                  ? Math.ceil(rowAmountParsed / rowInstallments)
                  : null

                return (
                  <div key={row.id} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <select
                        value={row.method}
                        onChange={e => {
                          const next = e.target.value as PaymentMethod
                          if (next === 'cash' && cashAlreadyUsed && !isCashRow) return
                          // Al cambiar de crédito a otro método, limpiar cuotas
                          updateRow(row.id, { method: next, installments: undefined })
                        }}
                        className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-zinc-500 min-w-0 flex-[1.4]"
                      >
                        <option value="debit">💳 Débito</option>
                        <option value="wallet">📱 Billetera Virtual</option>
                        <option value="credit">🏦 Crédito</option>
                        <option
                          value="cash"
                          disabled={cashAlreadyUsed && !isCashRow}
                        >
                          {cashAlreadyUsed && !isCashRow ? '💵 Efectivo (ya usado)' : '💵 Efectivo'}
                        </option>
                      </select>

                      <div className="relative flex-1 min-w-0">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">$</span>
                        <NumericInput
                          value={row.amount}
                          onChange={amount => updateRow(row.id, { amount })}
                          onFocus={() => setFocusedRowId(row.id)}
                          onBlur={() => setFocusedRowId(null)}
                          placeholder="0"
                          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 pl-7 pr-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                        />
                      </div>

                      {showFillBtn && (
                        <button
                          type="button"
                          onClick={() => fillRowRemainder(row.id)}
                          className="shrink-0 rounded-lg border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors whitespace-nowrap"
                          title="Completar con el monto restante"
                        >
                          ← {formatARS(rowRem)}
                        </button>
                      )}

                      {rows.length > 2 && (
                        <button
                          onClick={() => removeRow(row.id)}
                          className="shrink-0 text-zinc-600 hover:text-red-400 px-1 text-sm"
                          title="Eliminar fila"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Selector de cuotas inline — solo para filas de crédito */}
                    {isCreditRow && (
                      <div className="ml-1 flex flex-wrap items-center gap-1.5 pl-1 border-l-2 border-zinc-700">
                        <span className="text-[11px] text-zinc-500 shrink-0">Cuotas:</span>
                        {CREDIT_PRESET_INSTALLMENTS.map(n => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => updateRow(row.id, { installments: n })}
                            className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                              rowInstallments === n
                                ? 'bg-zinc-700 text-zinc-100'
                                : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white'
                            }`}
                          >
                            {n === 1 ? '1×' : `${n}×`}
                          </button>
                        ))}
                        {perInstallment !== null && (
                          <span className="text-[11px] text-zinc-400 ml-1">
                            = {formatARS(perInstallment)}/cuota
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              <button
                onClick={addRow}
                className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1 pt-0.5"
              >
                + Agregar otro medio de pago
              </button>

              <div className={`rounded-xl border p-3.5 ${balanceColor}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    {Math.abs(remaining) < 1
                      ? 'Total cubierto ✓'
                      : remaining > 0
                        ? 'Resta ingresar'
                        : 'Exceso'}
                  </span>
                  <span className={`text-xl font-bold ${balanceValueColor}`}>
                    {Math.abs(remaining) < 1
                      ? '—'
                      : formatARS(Math.abs(remaining))}
                  </span>
                </div>
                {focusedRowId !== null && !totalCovered && (
                  <p className="mt-1 text-[10px] text-zinc-500">
                    Saldo pendiente para este campo — se actualiza al confirmar el monto
                  </p>
                )}
              </div>

              <button
                onClick={handleSplitConfirm}
                disabled={!splitValid}
                className="w-full rounded-xl bg-emerald-600 py-3.5 font-bold text-white text-sm transition-colors hover:bg-emerald-500 disabled:opacity-40"
              >
                Confirmar cobro · {formatARS(total)}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
