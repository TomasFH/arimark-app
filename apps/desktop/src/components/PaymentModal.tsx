import { useState, useEffect } from 'react'
import {
  quoteCashDiscount,
  type CashDiscountRule,
} from '@carniceria/shared'
import NumericInput from './NumericInput'
import { parseNumericInput, formatIntegerWithDots } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import type { SalePaymentPayload } from '../types/hw-api'
import { Button, Modal } from './ui'

type PaymentMethod = 'cash' | 'debit' | 'wallet' | 'credit'

interface PaymentRow {
  id: string
  method: PaymentMethod
  amount: string
  /** Solo para filas con method='credit': número de cuotas seleccionadas. */
  installments?: number
}

interface Props {
  /** Total de ítems (sin restar seña ni descuento). */
  itemTotal: number
  depositAmount?: number
  depositDigitalAmount?: number
  cashDiscountRule?: CashDiscountRule | null
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

const fieldClass =
  'w-full rounded-xl border border-line bg-input px-3 py-2.5 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-line-accent'
const tileClass =
  'flex flex-col items-center gap-2 rounded-xl border border-line bg-raised p-5 text-center transition-colors hover:border-line-strong hover:bg-hover'
const presetIdle =
  'rounded-lg border border-line bg-raised py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-hover'
const presetActive =
  'rounded-lg border border-line-accent bg-accent-soft py-2.5 text-sm font-semibold text-accent transition-colors'

export default function PaymentModal({
  itemTotal,
  depositAmount = 0,
  depositDigitalAmount = 0,
  cashDiscountRule,
  onConfirm,
  onFiado,
  onClose,
}: Props) {
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

  const rule: CashDiscountRule = cashDiscountRule ?? { minAmount: 0, percent: 0 }
  const splitHasCash = rows.some(r => r.method === 'cash' && (parseNumericInput(r.amount) ?? 0) > 0)
  const remainderCash =
    mode === 'cash-detail' || (mode === 'split' && splitHasCash)
  const quote = quoteCashDiscount({
    rule,
    itemTotal,
    depositAmount,
    depositDigitalAmount,
    remainderIncludesCash: remainderCash,
  })
  const cashPreview = quoteCashDiscount({
    rule,
    itemTotal,
    depositAmount,
    depositDigitalAmount,
    remainderIncludesCash: true,
  })
  const chargeTotal = quote.amountDue
  const discountLine = quote.eligible
    ? `Desc. efectivo ${quote.discountPercent}% sobre ${formatARS(itemTotal)} → ${formatARS(quote.discountedTotal)}${depositAmount > 0 ? `; seña ${formatARS(depositAmount)}` : ''}; a cobrar ${formatARS(quote.amountDue)}`
    : cashPreview.eligible
      ? `Si cobrás con efectivo: ${cashPreview.discountPercent}% sobre ${formatARS(itemTotal)} → ${formatARS(cashPreview.discountedTotal)}${depositAmount > 0 ? `; seña ${formatARS(depositAmount)}` : ''}; a cobrar ${formatARS(cashPreview.amountDue)}`
      : null

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

  function handleSingleMethod(method: PaymentMethod) {
    setPendingMethod(method)
    if (method === 'cash') {
      setMode('cash-detail')
    } else if (method === 'credit') {
      setInstallmentsRaw('')
      setMode('credit-detail')
    } else {
      setMode('digital-confirm')
    }
  }

  const clientCashAmount = parseNumericInput(clientCash) ?? 0
  const cashChange = clientCashAmount > 0.005 ? clientCashAmount - chargeTotal : 0
  const cashInsufficient = clientCashAmount > 0.005 && clientCashAmount < chargeTotal - 0.005

  function handleCashConfirm() {
    confirmWithNotes([{ paymentMethod: 'cash', amount: chargeTotal }])
  }

  function handleDigitalConfirm() {
    if (!pendingMethod) return
    confirmWithNotes([{ paymentMethod: pendingMethod, amount: chargeTotal }])
  }

  const installments = parseNumericInput(installmentsRaw) ?? 0
  const installmentsValid = installments >= 1
  const perInstallment = installmentsValid ? Math.ceil(chargeTotal / installments) : 0

  function handleCreditPreset(n: number) {
    setInstallmentsRaw(String(n))
  }

  function handleCreditConfirm() {
    confirmWithNotes([{ paymentMethod: 'credit', amount: chargeTotal, installments }])
  }

  const [focusedRowId, setFocusedRowId] = useState<string | null>(null)

  const cashRowCount = rows.filter(r => r.method === 'cash').length
  const cashAlreadyUsed = cashRowCount > 0

  const rowSum = rows.reduce((s, r) => s + (parseNumericInput(r.amount) ?? 0), 0)
  const totalCovered = Math.abs(rowSum - chargeTotal) < 1

  const rowSumExcludingFocused = rows
    .filter(r => r.id !== focusedRowId)
    .reduce((s, r) => s + (parseNumericInput(r.amount) ?? 0), 0)
  const remaining = totalCovered ? 0 : chargeTotal - rowSumExcludingFocused

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
    return Math.max(0, Math.round(chargeTotal - others))
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

  const balanceCovered = Math.abs(remaining) < 1
  const balanceExcess = remaining < 0

  const headerTitle = (() => {
    if (mode === 'single') return 'Cobrar venta'
    if (mode === 'cash-detail') return 'Cobro en efectivo'
    if (mode === 'split') return 'Cobro dividido'
    if (mode === 'digital-confirm' && pendingMethod)
      return `Confirmar cobro — ${METHOD_LABELS[pendingMethod]}`
    if (mode === 'credit-detail') return 'Cobro con crédito'
    return 'Cobrar venta'
  })()

  const confirmLabel = `Confirmar cobro · ${formatARS(chargeTotal)}`

  const footer = (() => {
    if (mode === 'single') {
      return (
        <>
          <Button variant="secondary" className="mr-auto" onClick={onClose}>Cerrar</Button>
          {onFiado && (
            <Button variant="ghost" onClick={onFiado} title="El cliente se lleva la mercadería y paga después">
              Fiado
            </Button>
          )}
        </>
      )
    }
    if (mode === 'cash-detail') {
      return (
        <>
          <Button variant="secondary" className="mr-auto" onClick={() => setMode('single')}>Volver</Button>
          <Button
            variant="primary"
            onClick={handleCashConfirm}
            disabled={cashInsufficient || clientCash === ''}
          >
            {confirmLabel}
          </Button>
        </>
      )
    }
    if (mode === 'digital-confirm') {
      return (
        <>
          <Button variant="secondary" className="mr-auto" onClick={() => setMode('single')}>Cambiar medio</Button>
          <Button variant="primary" onClick={handleDigitalConfirm}>{confirmLabel}</Button>
        </>
      )
    }
    if (mode === 'credit-detail') {
      return (
        <>
          <Button variant="secondary" className="mr-auto" onClick={() => setMode('single')}>Cambiar medio</Button>
          <Button variant="primary" onClick={handleCreditConfirm} disabled={!installmentsValid}>
            {installmentsValid && installments > 1
              ? `Confirmar · ${installments} cuotas de ${formatARS(perInstallment)}`
              : confirmLabel}
          </Button>
        </>
      )
    }
    return (
      <>
        <Button variant="secondary" className="mr-auto" onClick={() => setMode('single')}>Volver</Button>
        <Button variant="primary" onClick={handleSplitConfirm} disabled={!splitValid}>
          {confirmLabel}
        </Button>
      </>
    )
  })()

  return (
    <Modal
      open
      onClose={onClose}
      closeOnEscape={false}
      size="md"
      footer={footer}
      header={(
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {mode !== 'single' && (
            <Button variant="ghost" size="sm" onClick={() => setMode('single')} aria-label="Volver" className="px-2">
              ←
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold tracking-tight text-ink" title={headerTitle}>
              {headerTitle}
            </h2>
            <p className="text-2xl font-bold tabular-nums text-ink">{formatARS(chargeTotal)}</p>
          </div>
        </div>
      )}
    >
      {discountLine && (
        <p className="mb-3 truncate text-xs text-success" title={discountLine}>{discountLine}</p>
      )}

      <div className="mb-4">
        <label htmlFor="sale-notes" className="mb-1 block text-xs text-muted">
          Notas de la venta <span className="text-subtle">(opcional)</span>
        </label>
        <textarea
          id="sale-notes"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="ej. precio especial a familiar, pedido para retirar…"
          rows={2}
          maxLength={500}
          className={`${fieldClass} resize-none`}
        />
      </div>

      {mode === 'single' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => handleSingleMethod('cash')} className={tileClass}>
              <span className="text-3xl" aria-hidden>{METHOD_ICONS.cash}</span>
              <span className="text-sm font-semibold text-ink">Efectivo</span>
            </button>
            <button type="button" onClick={() => handleSingleMethod('debit')} className={tileClass}>
              <span className="text-3xl" aria-hidden>{METHOD_ICONS.debit}</span>
              <span className="text-sm font-semibold text-ink">Débito</span>
            </button>
            <button type="button" onClick={() => handleSingleMethod('wallet')} className={tileClass}>
              <span className="text-3xl" aria-hidden>{METHOD_ICONS.wallet}</span>
              <span className="text-sm font-semibold text-ink">Billetera Virtual</span>
            </button>
            <button
              type="button"
              onClick={() => handleSingleMethod('credit')}
              className="flex flex-col items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 p-5 text-center transition-colors hover:border-danger hover:bg-danger/15"
            >
              <span className="text-3xl" aria-hidden>{METHOD_ICONS.credit}</span>
              <span className="text-sm font-semibold text-danger">Crédito</span>
              <span className="text-[10px] leading-tight text-danger/80">uso excepcional</span>
            </button>
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setMode('split')}
              className="text-xs text-muted underline underline-offset-2 transition-colors hover:text-ink"
            >
              Dividir en varios medios de pago
            </button>
          </div>
        </>
      )}

      {mode === 'cash-detail' && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm text-ink">¿Con cuánto paga el cliente?</label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setClientCash(formatIntegerWithDots(String(Math.round(chargeTotal))))}
              >
                Paga justo · {formatARS(chargeTotal)}
              </Button>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
              <NumericInput
                value={clientCash}
                onChange={setClientCash}
                placeholder="Monto recibido"
                autoFocus
                className={`${fieldClass} py-3 pl-8 pr-4 text-lg`}
              />
            </div>
            {clientCash === '' && (
              <p className="text-xs text-muted">
                Ingresá el monto que entrega el cliente para calcular el vuelto, o usá el botón si paga con el monto exacto.
              </p>
            )}
          </div>

          {cashChange > 0.005 && (
            <div className="rounded-xl border border-success/30 bg-success/10 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-success">Vuelto a entregar</span>
                <span className="text-2xl font-bold tabular-nums text-success">{formatARS(cashChange)}</span>
              </div>
            </div>
          )}

          {cashInsufficient && (
            <p className="text-xs text-danger">
              El cliente debe pagar al menos {formatARS(chargeTotal)}.
            </p>
          )}
        </div>
      )}

      {mode === 'digital-confirm' && pendingMethod && (
        <div className="space-y-5">
          <div className="rounded-xl border border-line bg-raised p-5 text-center space-y-2">
            <p className="text-4xl" aria-hidden>{METHOD_ICONS[pendingMethod]}</p>
            <p className="text-base font-semibold text-ink">{METHOD_LABELS[pendingMethod]}</p>
            <p className="text-3xl font-bold tabular-nums text-ink">{formatARS(chargeTotal)}</p>
          </div>
          <p className="text-center text-xs text-muted">
            Confirmá que el cliente pagó {formatARS(chargeTotal)} con {METHOD_LABELS[pendingMethod]}.
          </p>
        </div>
      )}

      {mode === 'credit-detail' && (
        <div className="space-y-5">
          <div>
            <p className="mb-3 text-sm text-ink">¿En cuántas cuotas?</p>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {CREDIT_PRESET_INSTALLMENTS.map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => handleCreditPreset(n)}
                  className={installments === n ? presetActive : presetIdle}
                >
                  {n === 1 ? 'Contado' : `${n}×`}
                </button>
              ))}
            </div>
            <NumericInput
              value={installmentsRaw}
              onChange={setInstallmentsRaw}
              placeholder="Otro número de cuotas…"
              className={fieldClass}
            />
          </div>

          {installmentsValid && installments > 1 && (
            <div className="space-y-1 rounded-xl border border-line bg-raised p-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted">Total</span>
                <span className="font-semibold text-ink">{formatARS(chargeTotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">{installments} cuotas de</span>
                <span className="font-bold text-ink">{formatARS(perInstallment)}</span>
              </div>
            </div>
          )}

          {installmentsValid && installments === 1 && (
            <p className="text-center text-xs text-muted">
              Crédito en 1 pago (contado con tarjeta).
            </p>
          )}
        </div>
      )}

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
            const rowPerInstallment = isCreditRow && rowInstallments > 1 && rowAmountParsed > 0
              ? Math.ceil(rowAmountParsed / rowInstallments)
              : null

            const showRemove = rows.length > 2

            return (
              <div key={row.id} className="space-y-1.5">
                <div className={`grid items-center gap-2 ${showRemove ? 'grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_9.25rem_2rem]' : 'grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_9.25rem]'}`}>
                  <select
                    value={row.method}
                    onChange={e => {
                      const next = e.target.value as PaymentMethod
                      if (next === 'cash' && cashAlreadyUsed && !isCashRow) return
                      updateRow(row.id, { method: next, installments: undefined })
                    }}
                    className="w-full min-w-0 rounded-xl border border-line bg-input px-2 py-2.5 text-sm text-ink focus:outline-none focus:border-line-accent"
                  >
                    <option value="debit">Débito</option>
                    <option value="wallet">Billetera Virtual</option>
                    <option value="credit">Crédito</option>
                    <option value="cash" disabled={cashAlreadyUsed && !isCashRow}>
                      {cashAlreadyUsed && !isCashRow ? 'Efectivo (ya usado)' : 'Efectivo'}
                    </option>
                  </select>

                  <div className="relative min-w-0">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
                    <NumericInput
                      value={row.amount}
                      onChange={amount => updateRow(row.id, { amount })}
                      onFocus={() => setFocusedRowId(row.id)}
                      onBlur={() => setFocusedRowId(null)}
                      placeholder="0"
                      className={`${fieldClass} py-2.5 pl-7 pr-3`}
                    />
                  </div>

                  <div className="flex h-10 w-full items-center justify-stretch">
                    {showFillBtn && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => fillRowRemainder(row.id)}
                        title="Completar con el monto restante"
                        className="w-full truncate px-2"
                      >
                        ← {formatARS(rowRem)}
                      </Button>
                    )}
                  </div>

                  {showRemove && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRow(row.id)}
                      className="px-0 text-muted hover:text-danger"
                      title="Eliminar fila"
                      aria-label="Eliminar medio de pago"
                    >
                      ✕
                    </Button>
                  )}
                </div>

                {isCreditRow && (
                  <div className="ml-1 flex flex-wrap items-center gap-1.5 border-l border-line pl-2">
                    <span className="shrink-0 text-[11px] text-muted">Cuotas:</span>
                    {CREDIT_PRESET_INSTALLMENTS.map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => updateRow(row.id, { installments: n })}
                        className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                          rowInstallments === n
                            ? 'bg-accent-soft text-accent'
                            : 'bg-raised text-muted hover:bg-hover hover:text-ink'
                        }`}
                      >
                        {n === 1 ? '1×' : `${n}×`}
                      </button>
                    ))}
                    {rowPerInstallment !== null && (
                      <span className="ml-1 text-[11px] text-muted">
                        = {formatARS(rowPerInstallment)}/cuota
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          <Button variant="ghost" size="sm" onClick={addRow} className="px-0">
            + Agregar otro medio de pago
          </Button>

          <div
            className={`rounded-xl border p-3.5 ${
              balanceCovered
                ? 'border-success/30 bg-success/10 text-success'
                : balanceExcess
                  ? 'border-danger/30 bg-danger/10 text-danger'
                  : 'border-line bg-raised text-ink'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm">
                {balanceCovered ? 'Total cubierto' : balanceExcess ? 'Exceso' : 'Resta ingresar'}
              </span>
              <span className="text-xl font-bold tabular-nums">
                {balanceCovered ? '—' : formatARS(Math.abs(remaining))}
              </span>
            </div>
            {focusedRowId !== null && !totalCovered && (
              <p className="mt-1 text-[10px] text-muted">
                Saldo pendiente para este campo — se actualiza al confirmar el monto
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
