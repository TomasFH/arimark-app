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
}

interface Props {
  total: number
  onConfirm: (payments: SalePaymentPayload[], notes?: string) => void
  /** Llamado cuando la cajera elige cobro diferido (fiado). */
  onFiado?: () => void
  onClose: () => void
}

type ModalMode = 'single' | 'cash-detail' | 'split'

export default function PaymentModal({ total, onConfirm, onFiado, onClose }: Props) {
  const [mode, setMode] = useState<ModalMode>('single')
  const [clientCash, setClientCash] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<PaymentRow[]>([
    { id: crypto.randomUUID(), method: 'debit', amount: '' },
    { id: crypto.randomUUID(), method: 'cash', amount: '' },
  ])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function confirmWithNotes(payments: SalePaymentPayload[]) {
    const trimmed = notes.trim()
    onConfirm(payments, trimmed || undefined)
  }

  // --- Modo simple: botón de método ---
  function handleSingleMethod(method: PaymentMethod) {
    if (method === 'cash') {
      setMode('cash-detail')
    } else {
      confirmWithNotes([{ paymentMethod: method, amount: total }])
    }
  }

  // --- Modo efectivo: calcular vuelto ---
  const clientCashAmount = parseNumericInput(clientCash) ?? 0
  const cashChange = clientCashAmount > 0.005 ? clientCashAmount - total : 0
  const cashInsufficient = clientCashAmount > 0.005 && clientCashAmount < total - 0.005

  function handleCashConfirm() {
    confirmWithNotes([{ paymentMethod: 'cash', amount: total }])
  }

  // --- Modo dividido ---
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null)

  const cashRowCount = rows.filter(r => r.method === 'cash').length
  const cashAlreadyUsed = cashRowCount > 0

  // Suma total de todas las filas (para validar que el monto cuadra)
  const rowSum = rows.reduce((s, r) => s + (parseNumericInput(r.amount) ?? 0), 0)
  const totalCovered = Math.abs(rowSum - total) < 1

  /**
   * "Resta" para mostrar: excluye la fila que la cajera está editando en este momento.
   * Así el saldo no se mueve mientras tipea, evitando confusión.
   * Cuando totalCovered=true mostramos 0 (cubierto) inmediatamente.
   */
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

  /** Calcula cuánto le falta cubrir a una fila específica (lo que ponen las demás descuenta). */
  function getRowRemainder(id: string): number {
    const others = rows
      .filter(r => r.id !== id)
      .reduce((s, r) => s + (parseNumericInput(r.amount) ?? 0), 0)
    return Math.max(0, Math.round(total - others))
  }

  /** Rellena automáticamente una fila con el monto restante exacto. */
  function fillRowRemainder(id: string) {
    const rem = getRowRemainder(id)
    if (rem > 0) {
      updateRow(id, { amount: formatIntegerWithDots(String(rem)) })
      // Si era la fila enfocada, también la "desenfocamos" del cálculo
      setFocusedRowId(null)
    }
  }

  function handleSplitConfirm() {
    const payments: SalePaymentPayload[] = rows
      .filter(r => (parseNumericInput(r.amount) ?? 0) > 0.005)
      .map(r => ({
        paymentMethod: r.method,
        amount: parseNumericInput(r.amount) ?? 0,
      }))
    confirmWithNotes(payments)
  }

  const balanceColor =
    Math.abs(remaining) < 1
      ? 'border-green-700/50 bg-green-900/20 text-green-300'
      : remaining > 0
        ? 'border-amber-700/50 bg-amber-900/20 text-amber-300'
        : 'border-red-700/50 bg-red-900/20 text-red-300'

  const balanceValueColor =
    Math.abs(remaining) < 1 ? 'text-green-400' : remaining > 0 ? 'text-amber-400' : 'text-red-400'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-gray-900 border border-gray-700 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-800 px-6 py-4">
          {mode !== 'single' && (
            <button
              onClick={() => setMode('single')}
              className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800"
              title="Volver"
            >
              ←
            </button>
          )}
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-300">
              {mode === 'single' && 'Cobrar venta'}
              {mode === 'cash-detail' && 'Cobro en efectivo'}
              {mode === 'split' && 'Cobro dividido'}
            </h2>
            <p className="text-2xl font-bold text-amber-400">{formatARS(total)}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800"
          >
            ✕
          </button>
        </div>

        {/* Notas opcionales — visibles en todos los modos de cobro */}
        <div className="border-b border-gray-800 px-6 py-3">
          <label htmlFor="sale-notes" className="block text-[10px] text-gray-500 mb-1">
            Notas de la venta <span className="text-gray-600">(opcional)</span>
          </label>
          <textarea
            id="sale-notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="ej. precio especial a familiar, pedido para retirar…"
            rows={2}
            maxLength={500}
            className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
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
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-gray-700 bg-gray-800 p-5 text-center transition-all hover:border-green-500 hover:bg-green-500/10"
                >
                  <span className="text-3xl">💵</span>
                  <span className="text-sm font-semibold text-white">Efectivo</span>
                </button>

                <button
                  onClick={() => handleSingleMethod('debit')}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-gray-700 bg-gray-800 p-5 text-center transition-all hover:border-blue-500 hover:bg-blue-500/10"
                >
                  <span className="text-3xl">💳</span>
                  <span className="text-sm font-semibold text-white">Débito</span>
                </button>

                <button
                  onClick={() => handleSingleMethod('wallet')}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-gray-700 bg-gray-800 p-5 text-center transition-all hover:border-purple-500 hover:bg-purple-500/10"
                >
                  <span className="text-3xl">📱</span>
                  <span className="text-sm font-semibold text-white">Billetera virtual</span>
                </button>

                {/* Crédito: diferenciado visualmente como uso excepcional */}
                <button
                  onClick={() => handleSingleMethod('credit')}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-orange-800/60 bg-orange-950/40 p-5 text-center transition-all hover:border-orange-500 hover:bg-orange-500/10"
                >
                  <span className="text-3xl">💳</span>
                  <span className="text-sm font-semibold text-orange-300">Crédito</span>
                  <span className="text-[10px] text-orange-500/80 leading-tight">uso excepcional</span>
                </button>
              </div>

              <div className="mt-5 flex items-center justify-between">
                <button
                  onClick={() => setMode('split')}
                  className="text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors"
                >
                  Dividir en varios medios de pago
                </button>
                {onFiado && (
                  <button
                    onClick={onFiado}
                    className="text-xs text-amber-600 hover:text-amber-400 border border-amber-800/60 rounded-lg px-3 py-1.5 hover:bg-amber-900/20 transition-colors font-medium"
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
                  <label className="text-sm text-gray-300">
                    ¿Con cuánto paga el cliente?
                  </label>
                  {/* Botón sutil para llenar con el total exacto (pago justo) */}
                  <button
                    type="button"
                    onClick={() => setClientCash(formatIntegerWithDots(String(Math.round(total))))}
                    className="text-xs text-amber-500 hover:text-amber-300 border border-amber-700/50 rounded px-2 py-0.5 hover:bg-amber-900/20 transition-colors"
                  >
                    Paga justo · {formatARS(total)}
                  </button>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                  <NumericInput
                    value={clientCash}
                    onChange={setClientCash}
                    placeholder="Monto recibido"
                    autoFocus
                    className="w-full rounded-xl bg-gray-800 pl-8 pr-4 py-3 text-lg text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500 border border-gray-700"
                  />
                </div>
                {clientCash === '' && (
                  <p className="text-xs text-gray-500">
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
                className="w-full rounded-xl bg-amber-500 py-3.5 font-bold text-white text-sm transition-colors hover:bg-amber-400 disabled:opacity-40"
              >
                Confirmar cobro · {formatARS(total)}
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
                // Solo en campos vacíos: evita mostrar autocompletado en filas ya en uso
                const showFillBtn = !totalCovered && rowRem > 0 && rowAmount <= 0

                return (
                  <div key={row.id} className="flex items-center gap-2">
                    <select
                      value={row.method}
                      onChange={e => {
                        const next = e.target.value as PaymentMethod
                        // No permitir agregar un segundo efectivo
                        if (next === 'cash' && cashAlreadyUsed && !isCashRow) return
                        updateRow(row.id, { method: next })
                      }}
                      className="rounded-lg bg-gray-800 border border-gray-700 px-2 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500 min-w-0 flex-[1.4]"
                    >
                      <option value="debit">💳 Débito</option>
                      <option value="wallet">📱 Billetera Virtual</option>
                      <option value="credit">💳 Crédito</option>
                      <option
                        value="cash"
                        disabled={cashAlreadyUsed && !isCashRow}
                      >
                        {cashAlreadyUsed && !isCashRow ? '💵 Efectivo (ya usado)' : '💵 Efectivo'}
                      </option>
                    </select>

                    <div className="relative flex-1 min-w-0">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                      <NumericInput
                        value={row.amount}
                        onChange={amount => updateRow(row.id, { amount })}
                        onFocus={() => setFocusedRowId(row.id)}
                        onBlur={() => setFocusedRowId(null)}
                        placeholder="0"
                        className="w-full rounded-lg bg-gray-800 border border-gray-700 pl-7 pr-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>

                    {/* Botón para autocompletar con el monto restante */}
                    {showFillBtn && (
                      <button
                        type="button"
                        onClick={() => fillRowRemainder(row.id)}
                        className="shrink-0 rounded-lg border border-amber-700/60 bg-amber-900/30 px-2 py-1.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-900/60 hover:text-amber-200 transition-colors whitespace-nowrap"
                        title="Completar con el monto restante"
                      >
                        ← {formatARS(rowRem)}
                      </button>
                    )}

                    {rows.length > 2 && (
                      <button
                        onClick={() => removeRow(row.id)}
                        className="shrink-0 text-gray-600 hover:text-red-400 px-1 text-sm"
                        title="Eliminar fila"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )
              })}

              <button
                onClick={addRow}
                className="text-xs text-amber-500 hover:text-amber-400 transition-colors flex items-center gap-1 pt-0.5"
              >
                + Agregar otro medio de pago
              </button>

              {/* Balance — congelado mientras se escribe en una fila */}
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
                {/* Indicador sutil de que el balance está congelado mientras se escribe */}
                {focusedRowId !== null && !totalCovered && (
                  <p className="mt-1 text-[10px] text-gray-500">
                    Saldo pendiente para este campo — se actualiza al confirmar el monto
                  </p>
                )}
              </div>

              <button
                onClick={handleSplitConfirm}
                disabled={!splitValid}
                className="w-full rounded-xl bg-amber-500 py-3.5 font-bold text-white text-sm transition-colors hover:bg-amber-400 disabled:opacity-40"
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
