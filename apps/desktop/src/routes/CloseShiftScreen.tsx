/**
 * Pantalla de arqueo de caja — cierre deliberado de turno.
 *
 * Flujo:
 *  1. Ver resumen del turno (ventas, efectivo, digital por tipo).
 *  2. Registrar entrega / depósito (opcional).
 *  3. Declarar cuánto queda en la registradora (obligatorio, 0 permitido).
 *  4. El conteo de billetes es una herramienta: si cuentan, completa el monto.
 *     Si después editan el monto, vale lo tipeado.
 *  5. Al confirmar → pantalla de resumen final con botón "Finalizar".
 */
import { useEffect, useRef, useState } from 'react'
import { billLinesTotal } from '@carniceria/shared'
import NumericInput from '../components/NumericInput'
import BillCountGrid from '../components/BillCountGrid'
import { Button, Modal } from '../components/ui'
import { parseNumericInput } from '../lib/numericInput'
import {
  billRowsCountedTotal,
  billRowsToLines,
  cashAmountToInput,
  emptyBillRows,
  type BillMode,
  type BillRowState,
} from '../lib/billCountUi'
import { buildCloseShiftRecapLines } from '../lib/closeShiftRecap'
import { ventaCountLabel } from '../lib/shiftSaleTally'
import type { BillLine, ShiftSummary } from '../types/hw-api'

const BILL_MODE_KEY = 'close-shift-bill-mode'
const isProdEnv = import.meta.env['VITE_APP_ENV'] === 'production'

function loadBillMode(): BillMode {
  const stored = localStorage.getItem(BILL_MODE_KEY)
  return stored === 'total' ? 'total' : 'quantity'
}

function saveBillMode(mode: BillMode): void {
  localStorage.setItem(BILL_MODE_KEY, mode)
}

/** Campo sobre panel: input para que no se confunda con la card. */
const FIELD =
  'w-full rounded-lg border border-line-strong bg-input px-3 py-2 text-ink placeholder-subtle focus:outline-none focus:border-line-accent'

interface Props {
  onConfirmed: () => void
  onCancel: () => void
}

export default function CloseShiftScreen({ onConfirmed, onCancel }: Props) {
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Lo que queda en la registradora. Vacío hasta que lo declaran o cuentan.
  const [leftRaw, setLeftRaw] = useState('')
  const [leftError, setLeftError] = useState<string | null>(null)
  const amountFromCount = useRef(false)

  // Entrega / depósito
  const [deliveredAmountRaw, setDeliveredAmountRaw] = useState('')
  const [deliveredTo, setDeliveredTo] = useState('')
  const [notes, setNotes] = useState('')

  // Conteo de billetes (herramienta)
  const [billMode, setBillMode] = useState<BillMode>(loadBillMode)
  const [billRows, setBillRows] = useState<BillRowState[]>(emptyBillRows)
  const [skipBills, setSkipBills] = useState(false)

  // Estado del formulario
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Paso de confirmación antes de ejecutar el cierre
  const [showConfirm, setShowConfirm] = useState(false)

  // Pantalla de confirmación post-cierre
  const [closed, setClosed] = useState(false)
  const [closedSummary, setClosedSummary] = useState<{
    deliveredAmount: number
    deliveredTo: string
    countedRegister: number
    diff: number
    notes: string
  } | null>(null)
  const [draftStockCount, setDraftStockCount] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || saving) return
      e.preventDefault()
      if (closed) {
        onConfirmed()
        return
      }
      if (showConfirm) {
        setShowConfirm(false)
        return
      }
      onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, closed, showConfirm, onCancel, onConfirmed])

  useEffect(() => {
    void window.hw.getShiftSummary().then(r => {
      if (r.ok) setSummary(r.data)
      else setLoadError(r.error)
    })
    void window.hw.getDraftStockCount().then(r => {
      if (r.ok) setDraftStockCount(r.data != null)
    })
  }, [])

  function handleBillModeChange(mode: BillMode): void {
    saveBillMode(mode)
    setBillMode(mode)
    setBillRows(prev => {
      const next = prev.map(r => ({ ...r, totalError: null }))
      if (amountFromCount.current) {
        setLeftRaw(cashAmountToInput(billRowsCountedTotal(next, mode)))
        setLeftError(null)
      }
      return next
    })
  }

  function handleLeftChange(value: string): void {
    amountFromCount.current = false
    setLeftRaw(value)
    if (value !== '') setLeftError(null)
  }

  function updateBillRow(denomination: number, field: 'quantity' | 'total', value: string) {
    setBillRows(prev => {
      const next = prev.map(r => {
        if (r.denomination !== denomination) return r
        const updated = { ...r, [field]: value }
        if (field === 'total' && value !== '' && value !== '0') {
          const parsed = parseNumericInput(value)
          if (parsed !== null && parsed > 0 && parsed % denomination !== 0) {
            updated.totalError = `Debe ser múltiplo de ${fmt(denomination)}`
          } else {
            updated.totalError = null
          }
        } else {
          updated.totalError = null
        }
        return updated
      })
      amountFromCount.current = true
      setLeftRaw(cashAmountToInput(billRowsCountedTotal(next, billMode)))
      setLeftError(null)
      return next
    })
  }

  /** Validar modo monto: todos los totales ingresados deben ser múltiplos de su denominación. */
  function validateTotalMode(): boolean {
    let valid = true
    setBillRows(prev =>
      prev.map(r => {
        const parsed = parseNumericInput(r.total)
        if (parsed !== null && parsed > 0 && parsed % r.denomination !== 0) {
          valid = false
          return { ...r, totalError: `Debe ser múltiplo de ${fmt(r.denomination)}` }
        }
        return { ...r, totalError: null }
      })
    )
    return valid
  }

  const deliveredAmount = parseNumericInput(deliveredAmountRaw) ?? 0
  const declaredLeft = parseNumericInput(leftRaw)

  /** Efectivo esperado en la registradora = esperado del turno − entrega. */
  const expectedRegister = summary ? Math.max(0, summary.cashInHand - deliveredAmount) : 0

  /** Diferencia: lo declarado que queda, contra el efectivo esperado menos la entrega. */
  const diff = declaredLeft === null ? 0 : declaredLeft - expectedRegister

  function matchingBills(forceSkip: boolean): BillLine[] | undefined {
    if (forceSkip || declaredLeft === null) return undefined
    const lines = billRowsToLines(billRows, billMode)
    if (lines.length === 0 || billLinesTotal(lines) !== declaredLeft) return undefined
    return lines
  }

  function requireLeft(): boolean {
    if (declaredLeft !== null) return true
    setLeftError('Ingresá cuánto queda en la caja.')
    return false
  }

  async function handleConfirm() {
    if (!requireLeft()) return
    const lines = matchingBills(skipBills)
    if (lines && billMode === 'total' && !validateTotalMode()) {
      setSaveError('Hay montos que no son múltiplos de su denominación. Corregalos antes de cerrar.')
      return
    }
    setSaveError(null)
    setSkipBills(false)
    setShowConfirm(true)
  }

  async function doCloseShift() {
    if (declaredLeft === null) {
      setLeftError('Ingresá cuánto queda en la caja.')
      setShowConfirm(false)
      return
    }
    setSaveError(null)
    setSaving(true)

    const lines = matchingBills(skipBills)
    const closingCash = declaredLeft + deliveredAmount

    try {
      const r = await window.hw.closeShift({
        closingCash,
        deliveredAmount: deliveredAmount > 0 ? deliveredAmount : undefined,
        deliveredTo: deliveredTo.trim() || undefined,
        notes: notes.trim() || undefined,
        billDenominations: lines,
      })

      if (!r.ok) {
        setSaveError(r.error)
        return
      }

      setClosedSummary({
        deliveredAmount,
        deliveredTo: deliveredTo.trim(),
        countedRegister: declaredLeft,
        diff,
        notes: notes.trim(),
      })
      setClosed(true)
      setShowConfirm(false)
    } catch (err) {
      console.error('[CloseShiftScreen] closeShift falló', err)
      setSaveError('No se pudo cerrar el turno. Reintentá.')
    } finally {
      setSaving(false)
    }
  }

  const recapLines = closed && closedSummary && summary
    ? buildCloseShiftRecapLines({
        shiftType: summary.shiftType,
        salesCount: summary.salesCount,
        totalRevenue: summary.totalRevenue,
        totalCashSales: summary.totalCashSales,
        totalDebitSales: summary.totalDebitSales,
        totalWalletSales: summary.totalWalletSales,
        totalCreditSales: summary.totalCreditSales,
        cashSaleCount: summary.cashSaleCount,
        digitalSaleCount: summary.digitalSaleCount,
        debitSaleCount: summary.debitSaleCount,
        walletSaleCount: summary.walletSaleCount,
        creditSaleCount: summary.creditSaleCount,
        totalExpenses: summary.totalExpenses,
        totalCashInjects: summary.totalCashInjects,
        totalCashDebtPayments: summary.totalCashDebtPayments,
        debtsCount: summary.debtsCount,
        totalDebts: summary.totalDebts,
        depositsCount: summary.depositsCount,
        totalCashDeposits: summary.totalCashDeposits,
        totalDebitDeposits: summary.totalDebitDeposits,
        totalWalletDeposits: summary.totalWalletDeposits,
        totalCreditDeposits: summary.totalCreditDeposits,
        totalDigitalDeposits: summary.totalDigitalDeposits,
        cashInHand: summary.cashInHand,
        deliveredAmount: closedSummary.deliveredAmount,
        deliveredTo: closedSummary.deliveredTo,
        countedRegister: closedSummary.countedRegister,
        diff: closedSummary.diff,
        notes: closedSummary.notes,
      })
    : []

  // ---------------------------------------------------------------------------
  // Formulario de cierre
  // ---------------------------------------------------------------------------
  const shiftLabel = summary?.shiftType === 'morning' ? 'Mañana' : 'Tarde'
  const startedFormatted = summary
    ? new Date(summary.startedAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
    : '—'
  const totalDigital = summary
    ? summary.totalDebitSales + summary.totalWalletSales + summary.totalCreditSales
    : 0

  return (
    <>
    {closed ? (
      <div className="flex flex-1 min-h-0 h-full bg-app" aria-hidden />
    ) : (
    <div className="flex flex-1 min-h-0 h-full flex-col bg-app text-ink overflow-hidden">
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-line bg-panel">
        <h1 className="text-2xl font-bold text-center">Cerrar caja</h1>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable]">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {draftStockCount && (
          <div className="rounded-xl border border-amber-800/50 bg-amber-950/30 px-4 py-3">
            <p className="text-sm text-amber-200">Hay un conteo de stock en borrador.</p>
            <p className="text-xs text-amber-200/70 mt-1">
              Volvé al POS, abrí Conteo de stock y dale a Finalizar conteo antes de cerrar caja.
            </p>
          </div>
        )}

        {/* ── Resumen del turno ── */}
        <div className="bg-panel rounded-xl border border-line p-5 space-y-3">
          <h2 className="text-sm font-semibold text-muted">Resumen del turno</h2>
          {loadError ? (
            <p className="text-danger text-sm">{loadError}</p>
          ) : summary ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Stat label="Turno" value={shiftLabel} />
                <Stat label="Apertura" value={startedFormatted} />
                <Stat label="Efectivo inicial" value={fmt(summary.openingCash)} />
                <Stat label="Ventas" value={String(summary.salesCount)} />
                <Stat
                  label="Total vendido"
                  value={fmt(summary.totalRevenue)}
                  hint={ventaCountLabel(summary.salesCount)}
                />
                <Stat
                  label="Cobrado en efectivo"
                  value={fmt(summary.totalCashSales)}
                  hint={summary.cashSaleCount > 0 ? ventaCountLabel(summary.cashSaleCount) : undefined}
                />
                {totalDigital > 0 && (
                  <Stat
                    label="Cobrado digital"
                    value={fmt(totalDigital)}
                    hint={ventaCountLabel(summary.digitalSaleCount)}
                  />
                )}
                {summary.totalExpenses > 0 && (
                  <Stat label="Gastos" value={fmt(summary.totalExpenses)} />
                )}
                {summary.totalCashInjects > 0 && (
                  <Stat label="Ingresos" value={fmt(summary.totalCashInjects)} />
                )}
                {summary.totalCashDebtPayments > 0 && (
                  <Stat label="Fiados cobrados (efectivo)" value={fmt(summary.totalCashDebtPayments)} />
                )}
                {summary.debtsCount > 0 && (
                  <Stat label={`Fiados (${summary.debtsCount})`} value={fmt(summary.totalDebts)} />
                )}
                {summary.depositsCount > 0 && (
                  <Stat label={`Señas (${summary.depositsCount})`} value={fmt(summary.totalCashDeposits + summary.totalDigitalDeposits)} />
                )}
                <Stat label="Efectivo esperado" value={fmt(summary.cashInHand)} highlight />
              </div>

              {/* Desglose digital de ventas por tipo */}
              {totalDigital > 0 && (
                <div className="mt-2 pt-3 border-t border-line">
                  <p className="text-xs text-muted mb-2 font-semibold">Cobrado digital</p>
                  <div className="flex flex-wrap gap-2">
                    {summary.totalDebitSales > 0 && (
                      <DigitalSlice label="Débito" amount={fmt(summary.totalDebitSales)} count={summary.debitSaleCount} />
                    )}
                    {summary.totalWalletSales > 0 && (
                      <DigitalSlice label="Billetera virtual" amount={fmt(summary.totalWalletSales)} count={summary.walletSaleCount} />
                    )}
                    {summary.totalCreditSales > 0 && (
                      <DigitalSlice label="Crédito" amount={fmt(summary.totalCreditSales)} count={summary.creditSaleCount} />
                    )}
                  </div>
                </div>
              )}

              {/* Desglose de señas por medio de pago */}
              {summary.depositsCount > 0 && (
                <div className="mt-2 pt-3 border-t border-line">
                  <p className="text-xs text-muted mb-2 font-semibold">Señas — desglose por medio</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {summary.totalCashDeposits > 0 && (
                      <div className="bg-raised rounded-lg px-3 py-2">
                        <p className="text-[10px] text-muted">Efectivo</p>
                        <p className="text-sm font-semibold text-success">{fmt(summary.totalCashDeposits)}</p>
                      </div>
                    )}
                    {summary.totalDebitDeposits > 0 && (
                      <div className="bg-raised rounded-lg px-3 py-2">
                        <p className="text-[10px] text-muted">Débito</p>
                        <p className="text-sm font-semibold text-ink">{fmt(summary.totalDebitDeposits)}</p>
                      </div>
                    )}
                    {summary.totalWalletDeposits > 0 && (
                      <div className="bg-raised rounded-lg px-3 py-2">
                        <p className="text-[10px] text-muted">Billetera Virtual</p>
                        <p className="text-sm font-semibold text-ink">{fmt(summary.totalWalletDeposits)}</p>
                      </div>
                    )}
                    {summary.totalCreditDeposits > 0 && (
                      <div className="bg-raised rounded-lg px-3 py-2">
                        <p className="text-[10px] text-muted">Crédito</p>
                        <p className="text-sm font-semibold text-ink">{fmt(summary.totalCreditDeposits)}</p>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-subtle mt-2">
                    Solo el efectivo de señas se suma al efectivo esperado en caja. Los cobros digitales de señas no impactan el conteo físico.
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted text-sm">Cargando resumen…</p>
          )}
        </div>

        <div className="bg-panel rounded-xl border border-line p-5 space-y-5">
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-muted">Entrega / depósito en caja fuerte</h2>
            <Field label="Monto a entregar o depositar (opcional)">
              <NumericInput
                value={deliveredAmountRaw}
                onChange={v => setDeliveredAmountRaw(v)}
                placeholder="0"
                className={FIELD}
              />
            </Field>

            {deliveredAmount > 0 && (
              <Field label="¿A quién se entregó / dónde se depositó? (opcional)">
                <input
                  type="text"
                  value={deliveredTo}
                  onChange={e => setDeliveredTo(e.target.value)}
                  placeholder="Nombre, cargo o 'Caja fuerte'"
                  maxLength={80}
                  className={FIELD}
                />
              </Field>
            )}
          </div>

          <div className="space-y-2 border-t border-line pt-4">
            <label htmlFor="left-in-register" className="block text-sm font-medium text-ink">
              Queda en la caja
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-muted">
                $
              </span>
              <NumericInput
                id="left-in-register"
                value={leftRaw}
                onChange={handleLeftChange}
                placeholder="0"
                aria-invalid={leftError ? true : undefined}
                className="w-full rounded-lg border border-line-strong bg-input py-3 pl-8 pr-4 text-lg font-semibold tabular-nums text-ink placeholder-subtle focus:border-line-accent focus:outline-none"
              />
            </div>
            {leftError && <p className="text-sm text-danger">{leftError}</p>}
            {summary && declaredLeft !== null && (
              <div className="flex items-baseline justify-between gap-3 rounded-lg bg-raised px-4 py-2.5 text-sm">
                <span className="text-muted">Esperado {fmt(expectedRegister)}</span>
                <span className={`font-semibold tabular-nums ${
                  diff === 0 ? 'text-success' : diff > 0 ? 'text-ink' : 'text-danger'
                }`}>
                  {diff === 0 ? 'Caja cuadrada' : diff > 0 ? `Sobrante ${fmt(diff)}` : `Faltante ${fmt(Math.abs(diff))}`}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <BillCountGrid
            rows={billRows}
            mode={billMode}
            onModeChange={handleBillModeChange}
            onUpdate={updateBillRow}
            countedTotal={billRowsCountedTotal(billRows, billMode)}
            title="Conteo de billetes"
          />
          {!isProdEnv && (
            <button
              type="button"
              onClick={() => {
                if (!requireLeft()) return
                setSkipBills(true)
                setSaveError(null)
                setShowConfirm(true)
              }}
              className="w-full text-xs text-muted underline hover:text-ink"
            >
              Omitir conteo (modo pruebas)
            </button>
          )}
        </div>

        {/* ── Notas ── */}
        <div className="bg-panel rounded-xl border border-line p-5">
          <Field label="Notas del turno (opcional)">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Observaciones del turno…"
              rows={2}
              maxLength={300}
              className={`${FIELD} resize-none`}
            />
          </Field>
        </div>

        {saveError && (
          <p className="text-danger text-sm text-center">{saveError}</p>
        )}
      </div>
      </div>

      <div className="sticky bottom-0 z-10 shrink-0 border-t border-line bg-panel px-6 py-3 shadow-[0_8px_24px_rgba(28,28,30,0.12)]">
        <div className="max-w-2xl mx-auto flex gap-3">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={onCancel}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="danger"
            className="flex-1"
            onClick={() => void handleConfirm()}
            disabled={saving || !summary}
            loading={saving}
          >
            {saving ? 'Cerrando…' : 'Cerrar caja'}
          </Button>
        </div>
      </div>
    </div>
    )}

    <Modal
      open={showConfirm && summary != null}
      onClose={() => setShowConfirm(false)}
      title="¿Cerrar el turno ahora?"
      size="sm"
      closeOnEscape={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={() => setShowConfirm(false)} disabled={saving}>
            Volver
          </Button>
          <Button variant="danger" onClick={() => void doCloseShift()} loading={saving}>
            {saving ? 'Cerrando…' : 'Cerrar turno'}
          </Button>
        </>
      }
    >
      {summary && (
        <>
          <p className="text-sm text-muted mb-4">
            Esta acción finaliza el turno y no puede deshacerse. Verificá los datos antes de confirmar.
          </p>
          <div className="space-y-2 text-sm bg-raised rounded-xl p-4">
            <div className="flex justify-between">
              <span className="text-muted">Total vendido</span>
              <span className="text-ink font-semibold">{fmt(summary.totalRevenue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Efectivo esperado</span>
              <span className="text-success font-semibold">{fmt(summary.cashInHand)}</span>
            </div>
            {deliveredAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Monto a entregar</span>
                <span className="text-ink">{fmt(deliveredAmount)}</span>
              </div>
            )}
            {declaredLeft !== null && (
              <div className="flex justify-between">
                <span className="text-muted">Queda en la caja</span>
                <span className="text-ink tabular-nums">{fmt(declaredLeft)}</span>
              </div>
            )}
            {declaredLeft !== null && (
              <div className={`flex justify-between border-t border-line pt-2 ${diff === 0 ? 'text-success' : diff > 0 ? 'text-ink' : 'text-danger'}`}>
                <span>{diff === 0 ? 'Caja cuadrada' : diff > 0 ? 'Sobrante' : 'Faltante'}</span>
                <span className="font-semibold tabular-nums">
                  {diff === 0 ? '✓' : fmt(Math.abs(diff))}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </Modal>

    <Modal
      open={closed && recapLines.length > 0}
      onClose={onConfirmed}
      title="Caja cerrada"
      size="md"
      footer={
        <Button fullWidth onClick={onConfirmed}>
          Finalizar sesión
        </Button>
      }
    >
      <p className="text-sm text-muted mb-4">El turno quedó registrado. Este es el resumen del cierre.</p>
      <div className="space-y-2 text-sm bg-raised rounded-xl p-4">
        <h3 className="text-xs font-semibold text-muted">Resumen del cierre</h3>
        {recapLines.map(line => (
          <div
            key={line.label}
            className={`flex justify-between gap-3 ${line.indent ? 'pl-3' : ''}`}
          >
            <span className="text-muted min-w-0 truncate" title={line.label}>{line.label}</span>
            <span className={`shrink-0 font-medium ${
              line.tone === 'emphasis' ? 'text-success font-semibold'
                : line.tone === 'ok' ? 'text-success'
                  : line.tone === 'info' ? 'text-ink'
                    : line.tone === 'bad' ? 'text-danger'
                      : 'text-ink'
            }`}>
              {line.value}
            </span>
          </div>
        ))}
      </div>
    </Modal>
    </>
  )
}

// ---------------------------------------------------------------------------
// Componentes internos
// ---------------------------------------------------------------------------

function fmt(n: number) {
  return `$${n.toLocaleString('es-AR')}`
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-muted">{label}</label>
      {children}
    </div>
  )
}

function Stat({ label, value, hint, highlight }: { label: string; value: string; hint?: string; highlight?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-base font-semibold ${highlight ? 'text-success' : 'text-ink'}`}>{value}</p>
      {hint && <p className="text-[10px] text-muted">{hint}</p>}
    </div>
  )
}

function DigitalSlice({ label, amount, count }: { label: string; amount: string; count: number }) {
  return (
    <div className="rounded-lg bg-app px-3 py-2">
      <p className="text-[10px] text-muted">{label}</p>
      <p className="text-sm font-semibold text-ink">{amount}</p>
      {count > 0 && <p className="text-[10px] text-muted">{ventaCountLabel(count)}</p>}
    </div>
  )
}
