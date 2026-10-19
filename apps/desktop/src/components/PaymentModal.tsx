import { useEffect, useRef, useState } from 'react'
import {
  cashDiscountPreconditions,
  quoteCashDiscount,
  type CashDiscountRule,
} from '@carniceria/shared'
import NumericInput from './NumericInput'
import BagsPanel from './BagsPanel'
import { parseNumericInput, formatIntegerWithDots } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import type { ProductRow, SalePaymentPayload } from '../types/hw-api'
import { Button, Modal, ModalCloseButton, useModalDismiss } from './ui'

export type PaymentMethod = 'cash' | 'debit' | 'wallet' | 'credit'

export function paymentMethodFromFunctionKey(key: string): PaymentMethod | null {
  if (key === 'F1') return 'cash'
  if (key === 'F2') return 'debit'
  if (key === 'F3') return 'wallet'
  if (key === 'F9') return 'credit'
  return null
}

interface PaymentRow {
  id: string
  method: PaymentMethod
  amount: string
  /** Solo para filas con method='credit': número de cuotas seleccionadas. */
  installments?: number
}

interface CartLine {
  productId: string | null
  weightKg: number
  unit: 'kg' | 'unit'
}

interface Props {
  /** Total de ítems (sin restar seña ni descuento). */
  itemTotal: number
  depositAmount?: number
  depositDigitalAmount?: number
  cashDiscountRule?: CashDiscountRule | null
  products?: ProductRow[]
  cartLines?: readonly CartLine[]
  onAddBag?: (product: ProductRow, quantity: number) => void
  onRemoveBag?: (productId: string, quantity: number) => void
  onConfirm: (
    payments: SalePaymentPayload[],
    notes?: string,
    discountPercent?: number,
    discountException?: boolean,
  ) => void
  /** Llamado cuando la cajera elige cobro diferido (fiado). */
  onFiado?: () => void
  onClose: () => void
  /** Medio ya elegido al abrir (F1–F3 y F9 desde la venta). No confirma solo. */
  initialMethod?: PaymentMethod
  /** Abre ya en cobro dividido (F5 desde la venta). No confirma solo. */
  initialSplit?: boolean
}

type ModalMode = 'single' | 'cash-detail' | 'digital-confirm' | 'credit-detail' | 'split'

function modeForMethod(method: PaymentMethod | undefined): ModalMode {
  if (method === 'cash') return 'cash-detail'
  if (method === 'credit') return 'credit-detail'
  if (method === 'debit' || method === 'wallet') return 'digital-confirm'
  return 'single'
}

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
/** Aviso verde del cobro. /10 y /30 sobre var(--success) no existen y el borde cae al color del texto. */
const successNoticeClass =
  'border-line-strong bg-[color-mix(in_srgb,var(--success)_12%,transparent)]'
const tileClass =
  'flex h-full flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-raised px-3 py-4 text-center transition-colors hover:border-line-strong hover:bg-hover'
const presetIdle =
  'rounded-lg border border-line bg-raised py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-hover'
const presetActive =
  'rounded-lg border border-line-accent bg-accent-soft py-2.5 text-sm font-semibold text-accent transition-colors'

function clampPercentText(value: string): string {
  const parsed = parseNumericInput(value)
  if (parsed != null && parsed > 100) return '100'
  return value
}

function percentFromText(text: string): number {
  const parsed = parseNumericInput(text)
  return parsed == null ? 0 : Math.min(100, parsed)
}

export default function PaymentModal({
  itemTotal,
  depositAmount = 0,
  depositDigitalAmount = 0,
  cashDiscountRule,
  products = [],
  cartLines = [],
  onAddBag,
  onRemoveBag,
  onConfirm,
  onFiado,
  onClose,
  initialMethod,
  initialSplit = false,
}: Props) {
  const [mode, setMode] = useState<ModalMode>(() => (
    initialSplit ? 'split' : modeForMethod(initialMethod)
  ))
  const [clientCash, setClientCash] = useState('')
  const cashAmountRef = useRef<HTMLInputElement>(null)
  const [notes, setNotes] = useState('')
  /** Método seleccionado pendiente de confirmación (digital-confirm / credit-detail). */
  const [pendingMethod, setPendingMethod] = useState<PaymentMethod | null>(initialMethod ?? null)
  /** Cuotas para crédito — string para permitir tipeo libre. */
  const [installmentsRaw, setInstallmentsRaw] = useState('')
  const [rows, setRows] = useState<PaymentRow[]>([
    { id: crypto.randomUUID(), method: 'cash', amount: '' },
    { id: crypto.randomUUID(), method: 'debit', amount: '' },
  ])

  const rule: CashDiscountRule = cashDiscountRule ?? { minAmount: 0, percent: 0 }
  /** Prende o apaga la regla en un cobro que ya es elegible. No es la excepción. */
  const [applyDiscount, setApplyDiscount] = useState(true)
  const [exceptionDiscount, setExceptionDiscount] = useState(false)
  const [applyPercentText, setApplyPercentText] = useState(() => String(rule.percent))
  const [exceptionPercentText, setExceptionPercentText] = useState(() => String(rule.percent))

  const preconditionsOk = cashDiscountPreconditions({
    rule,
    itemTotal,
    isDebt: false,
    depositAmount,
    depositDigitalAmount,
  })
  const applyPercent = percentFromText(applyPercentText)
  const exceptionPercent = percentFromText(exceptionPercentText)
  const splitCashAmount = mode === 'split'
    ? rows
      .filter(r => r.method === 'cash')
      .reduce((sum, r) => sum + (parseNumericInput(r.amount) ?? 0), 0)
    : 0
  const splitHasCashPayment = splitCashAmount > 0
  const remainderCash = mode === 'cash-detail' || splitHasCashPayment
  const splitQuote = mode === 'split'
    ? quoteCashDiscount({
        rule: { ...rule, percent: applyPercent },
        itemTotal,
        depositAmount,
        depositDigitalAmount,
        remainderIncludesCash: splitHasCashPayment,
        cashAmount: splitCashAmount,
      })
    : null
  const showApplyControl = (mode === 'cash-detail' && preconditionsOk) || (splitQuote?.eligible === true)
  const showExceptionControl = !showApplyControl && !(mode === 'single' && preconditionsOk)
  const showPercentField =
    (showApplyControl && applyDiscount) || (showExceptionControl && exceptionDiscount)

  const plainQuote = quoteCashDiscount({
    rule,
    itemTotal,
    depositAmount,
    depositDigitalAmount,
    remainderIncludesCash: false,
  })
  const exceptionQuote = quoteCashDiscount({
    rule: { ...rule, percent: exceptionPercent },
    itemTotal,
    depositAmount,
    depositDigitalAmount,
    remainderIncludesCash: false,
    force: true,
  })

  const quote = mode === 'split'
    ? (showApplyControl && applyDiscount && splitQuote
        ? splitQuote
        : showExceptionControl && exceptionDiscount
          ? exceptionQuote
          : plainQuote)
    : showApplyControl && applyDiscount && remainderCash
    ? quoteCashDiscount({
        rule: { ...rule, percent: applyPercent },
        itemTotal,
        depositAmount,
        depositDigitalAmount,
        remainderIncludesCash: true,
      })
    : showExceptionControl && exceptionDiscount
      ? exceptionQuote
      : plainQuote
  const cashPreview = quoteCashDiscount({
    rule,
    itemTotal,
    depositAmount,
    depositDigitalAmount,
    remainderIncludesCash: true,
  })
  const chargeTotal = quote.amountDue
  const discountHint = quote.eligible
    ? {
        lead: `${showApplyControl ? 'Desc. efectivo' : 'Descuento'}: ${quote.discountPercent}% sobre ${formatARS(quote.discountBase)}`,
        discounted: quote.discountedTotal,
        deposit: depositAmount,
        due: quote.amountDue,
      }
    : !showApplyControl && !(showExceptionControl && exceptionDiscount) && cashPreview.eligible
      ? {
          lead: `Si cobrás con efectivo: ${cashPreview.discountPercent}% sobre ${formatARS(itemTotal)}`,
          discounted: cashPreview.discountedTotal,
          deposit: depositAmount,
          due: cashPreview.amountDue,
        }
      : null

  useModalDismiss(() => {
    if (mode !== 'single') setMode('single')
    else onClose()
  }, { overlay: false })

  function handleSalePercentChange(value: string) {
    const next = clampPercentText(value)
    if (showApplyControl) setApplyPercentText(next)
    else setExceptionPercentText(next)
  }

  function handleExceptionToggle(checked: boolean) {
    if (checked) setExceptionPercentText(String(rule.percent))
    setExceptionDiscount(checked)
  }

  function confirmWithNotes(payments: SalePaymentPayload[]) {
    const trimmed = notes.trim()
    const note = trimmed || undefined
    if (showApplyControl && remainderCash && applyDiscount) {
      onConfirm(payments, note, applyPercent)
      return
    }
    if (showApplyControl && remainderCash && !applyDiscount) {
      onConfirm(payments, note, 0)
      return
    }
    if (showExceptionControl && exceptionDiscount) {
      onConfirm(payments, note, exceptionPercent, true)
      return
    }
    onConfirm(payments, note)
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

  function confirmStepFromKeyboard(): boolean {
    if (mode === 'cash-detail') {
      const empty = clientCash.trim() === ''
      if (!empty && clientCashAmount + 0.005 < chargeTotal) return false
      handleCashConfirm()
      return true
    }
    if (mode === 'digital-confirm') {
      if (!pendingMethod) return false
      handleDigitalConfirm()
      return true
    }
    if (mode === 'credit-detail') {
      if (!installmentsValid) return false
      handleCreditConfirm()
      return true
    }
    if (mode === 'split') {
      if (!splitValid) return false
      handleSplitConfirm()
      return true
    }
    return false
  }

  const onPaymentKeyRef = useRef<(event: KeyboardEvent) => void>(() => {})
  onPaymentKeyRef.current = (event: KeyboardEvent) => {
    const method = paymentMethodFromFunctionKey(event.key)
    if (method) {
      event.preventDefault()
      if (event.repeat) return
      handleSingleMethod(method)
      return
    }
    if (event.key === 'F5') {
      event.preventDefault()
      if (event.repeat) return
      setMode('split')
      return
    }
    if (event.key !== 'Enter' || event.repeat) return
    if (event.target instanceof HTMLTextAreaElement) return
    if (event.target instanceof Element && event.target.closest('button') != null) return
    if (confirmStepFromKeyboard()) event.preventDefault()
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      onPaymentKeyRef.current(event)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // El modal enfoca el panel al abrirse y le saca el autoFocus a este campo.
  // Este efecto corre después, solo en efectivo, y no toca los demás modos.
  useEffect(() => {
    if (mode !== 'cash-detail') return
    cashAmountRef.current?.focus()
  }, [mode])

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
          <ModalCloseButton onClick={onClose} />
        </div>
      )}
    >
      {(showApplyControl || showExceptionControl) && (
        <label className="mb-2 flex cursor-pointer select-none items-center gap-2">
          <input
            type="checkbox"
            checked={showApplyControl ? applyDiscount : exceptionDiscount}
            onChange={e => {
              if (showApplyControl) setApplyDiscount(e.target.checked)
              else handleExceptionToggle(e.target.checked)
            }}
            className="h-3.5 w-3.5 shrink-0 rounded border-line bg-raised text-accent focus:ring-accent focus:ring-offset-panel"
          />
          <span
            className="min-w-0 truncate text-xs text-muted"
            title={showApplyControl ? 'Aplicar descuento' : 'Descuento en esta venta'}
          >
            {showApplyControl ? 'Aplicar descuento' : 'Descuento en esta venta'}
          </span>
        </label>
      )}
      {showPercentField && (
        <div className="mb-3 flex items-center gap-2 min-w-0">
          <label
            htmlFor="sale-discount-percent"
            className="min-w-0 flex-1 truncate text-xs text-muted"
            title="Descuento de esta venta"
          >
            Descuento de esta venta
          </label>
          <div className="flex shrink-0 items-center gap-1">
            <NumericInput
              id="sale-discount-percent"
              value={showApplyControl ? applyPercentText : exceptionPercentText}
              onChange={handleSalePercentChange}
              aria-label="Descuento de esta venta"
              className="w-14 rounded-md border border-line bg-input px-2 py-1 text-right text-xs text-ink focus:outline-none focus:border-line-accent"
            />
            <span className="text-xs text-muted">%</span>
          </div>
        </div>
      )}
      {discountHint != null && (
        <div className="mb-3 space-y-0.5 text-xs text-success">
          <p>{discountHint.lead}</p>
          <p>
            Queda {formatARS(discountHint.discounted)}
            {discountHint.deposit > 0 ? ` · seña ${formatARS(discountHint.deposit)}` : ''}
          </p>
          <p className="font-semibold">A cobrar {formatARS(discountHint.due)}</p>
        </div>
      )}
      {onAddBag && onRemoveBag && (
        <div className="mb-4">
          <BagsPanel
            products={products}
            lines={cartLines}
            onAdd={onAddBag}
            onRemove={onRemoveBag}
          />
        </div>
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
          <div className="grid grid-cols-2 items-stretch gap-3">
            <button type="button" onClick={() => handleSingleMethod('cash')} className={tileClass} aria-keyshortcuts="F1">
              <span className="text-3xl" aria-hidden>{METHOD_ICONS.cash}</span>
              <span className="text-sm font-semibold text-ink">Efectivo <span className="font-medium text-muted" aria-hidden>(F1)</span></span>
            </button>
            <button type="button" onClick={() => handleSingleMethod('debit')} className={tileClass} aria-keyshortcuts="F2">
              <span className="text-3xl" aria-hidden>{METHOD_ICONS.debit}</span>
              <span className="text-sm font-semibold text-ink">Débito <span className="font-medium text-muted" aria-hidden>(F2)</span></span>
            </button>
            <button type="button" onClick={() => handleSingleMethod('wallet')} className={tileClass} aria-keyshortcuts="F3">
              <span className="text-3xl" aria-hidden>{METHOD_ICONS.wallet}</span>
              <span className="text-sm font-semibold text-ink">Billetera Virtual <span className="font-medium text-muted" aria-hidden>(F3)</span></span>
            </button>
            <button
              type="button"
              onClick={() => handleSingleMethod('credit')}
              aria-keyshortcuts="F9"
              title="Uso excepcional"
              className={tileClass}
            >
              <span className="text-3xl" aria-hidden>{METHOD_ICONS.credit}</span>
              <span className="text-sm font-semibold text-danger">Crédito <span className="font-medium" aria-hidden>(F9)</span></span>
            </button>
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setMode('split')}
              aria-keyshortcuts="F5"
              className="text-xs text-muted underline underline-offset-2 transition-colors hover:text-ink"
            >
              Dividir en varios medios de pago <span aria-hidden>(F5)</span>
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
                ref={cashAmountRef}
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
            <div className={`rounded-xl border ${successNoticeClass} p-4`}>
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
          {splitHasCashPayment && !quote.eligible && preconditionsOk && (
            <p className="text-xs text-muted">
              El {rule.percent}% es solo sobre lo que se paga en efectivo, y esa parte tiene que cubrir al menos {formatARS(rule.minAmount)} de la compra.
            </p>
          )}
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
                    <option value="cash" disabled={cashAlreadyUsed && !isCashRow}>
                      {cashAlreadyUsed && !isCashRow ? 'Efectivo (ya usado)' : 'Efectivo'}
                    </option>
                    <option value="debit">Débito</option>
                    <option value="wallet">Billetera Virtual</option>
                    <option value="credit">Crédito</option>
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
                ? `${successNoticeClass} text-success`
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
