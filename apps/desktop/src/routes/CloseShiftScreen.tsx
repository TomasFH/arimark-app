/**
 * Pantalla de arqueo de caja — cierre deliberado de turno.
 *
 * Flujo:
 *  1. Ver resumen del turno (ventas, efectivo, digital por tipo).
 *  2. Declarar monto entregado / depositado en caja fuerte (opcional).
 *  3. Contar billetes del efectivo que queda en caja registradora.
 *     - Modo cantidad: cuántos billetes de cada denominación.
 *     - Modo monto: monto total por denominación (validado como múltiplo).
 *     La preferencia se guarda en localStorage.
 *  4. Al confirmar → pantalla de resumen final con botón "Finalizar".
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import NumericInput from '../components/NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import { buildCloseShiftRecapLines } from '../lib/closeShiftRecap'
import type { ShiftSummary } from '../types/hw-api'

/** Denominaciones vigentes en Argentina (sin billete de $5.000). */
const DENOMINATIONS = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10]

const BILL_MODE_KEY = 'close-shift-bill-mode'
type BillMode = 'quantity' | 'total'

/** Campo sobre panel 800: pozo 950 para que no se confunda con la card. */
const FIELD =
  'w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-600'

interface BillRow {
  denomination: number
  /** Modo cantidad: cuántos billetes. */
  quantity: string
  /** Modo monto: total acumulado para esa denominación. */
  total: string
  /** Error de validación en modo monto. */
  totalError: string | null
}

function initialBillRows(): BillRow[] {
  return DENOMINATIONS.map(d => ({ denomination: d, quantity: '', total: '', totalError: null }))
}

function loadBillMode(): BillMode {
  const stored = localStorage.getItem(BILL_MODE_KEY)
  return stored === 'total' ? 'total' : 'quantity'
}

function saveBillMode(mode: BillMode): void {
  localStorage.setItem(BILL_MODE_KEY, mode)
}

function fmtDenomination(d: number): string {
  return `$${d.toLocaleString('es-AR')}`
}

interface Props {
  onConfirmed: () => void
  onCancel: () => void
}

export default function CloseShiftScreen({ onConfirmed, onCancel }: Props) {
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Entrega / depósito
  const [deliveredAmountRaw, setDeliveredAmountRaw] = useState('')
  const [deliveredTo, setDeliveredTo] = useState('')
  const [notes, setNotes] = useState('')

  // Conteo de billetes
  const [billMode, setBillMode] = useState<BillMode>(loadBillMode)
  const [billRows, setBillRows] = useState<BillRow[]>(initialBillRows)

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
    // Limpiar errores de validación al cambiar de modo
    setBillRows(prev => prev.map(r => ({ ...r, totalError: null })))
  }

  function updateBillRow(denomination: number, field: 'quantity' | 'total', value: string) {
    setBillRows(prev =>
      prev.map(r => {
        if (r.denomination !== denomination) return r
        const updated = { ...r, [field]: value }
        // Validar en tiempo real solo si hay valor ingresado
        if (field === 'total' && value !== '' && value !== '0') {
          const parsed = parseNumericInput(value)
          if (parsed !== null && parsed > 0 && parsed % denomination !== 0) {
            updated.totalError = `Debe ser múltiplo de ${fmtDenomination(denomination)}`
          } else {
            updated.totalError = null
          }
        } else {
          updated.totalError = null
        }
        return updated
      })
    )
  }

  /** Validar modo monto: todos los totales ingresados deben ser múltiplos de su denominación. */
  function validateTotalMode(): boolean {
    let valid = true
    setBillRows(prev =>
      prev.map(r => {
        const parsed = parseNumericInput(r.total)
        if (parsed !== null && parsed > 0 && parsed % r.denomination !== 0) {
          valid = false
          return { ...r, totalError: `Debe ser múltiplo de ${fmtDenomination(r.denomination)}` }
        }
        return { ...r, totalError: null }
      })
    )
    return valid
  }

  const deliveredAmount = parseNumericInput(deliveredAmountRaw) ?? 0

  /** Efectivo que quedará en caja = esperado − monto entregado. */
  const expectedRegister = summary ? Math.max(0, summary.cashInHand - deliveredAmount) : 0

  /** Total contado en billetes para la caja registradora. */
  const countedRegister = billRows.reduce((acc, r) => {
    if (billMode === 'quantity') {
      const qty = parseNumericInput(r.quantity) ?? 0
      return acc + r.denomination * qty
    } else {
      const tot = parseNumericInput(r.total) ?? 0
      return acc + tot
    }
  }, 0)

  /** Diferencia: positiva = sobrante, negativa = faltante (respecto a expectedRegister). */
  const diff = countedRegister - expectedRegister

  async function handleConfirm() {
    if (billMode === 'total' && !validateTotalMode()) {
      setSaveError('Hay montos que no son múltiplos de su denominación. Corregalos antes de cerrar.')
      return
    }
    // Mostrar resumen de confirmación antes de ejecutar el cierre
    setShowConfirm(true)
  }

  async function doCloseShift() {
    setSaveError(null)
    setSaving(true)

    const billDenominations = billRows
      .map(r => {
        const qty =
          billMode === 'quantity'
            ? (parseNumericInput(r.quantity) ?? 0)
            : Math.round((parseNumericInput(r.total) ?? 0) / r.denomination)
        return { denomination: r.denomination, quantity: qty }
      })
      .filter(r => r.quantity > 0)

    const closingCash =
      countedRegister > 0 || deliveredAmount > 0
        ? countedRegister + deliveredAmount
        : undefined

    try {
      const r = await window.hw.closeShift({
        closingCash,
        deliveredAmount: deliveredAmount > 0 ? deliveredAmount : undefined,
        deliveredTo: deliveredTo.trim() || undefined,
        notes: notes.trim() || undefined,
        billDenominations: billDenominations.length > 0 ? billDenominations : undefined,
      })

      if (!r.ok) {
        setSaveError(r.error)
        return
      }

      setClosedSummary({
        deliveredAmount,
        deliveredTo: deliveredTo.trim(),
        countedRegister,
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
      <div className="flex flex-1 min-h-0 h-full bg-zinc-950" aria-hidden />
    ) : (
    <div className="flex flex-1 min-h-0 h-full flex-col bg-zinc-950 text-white overflow-hidden">
      <div className="shrink-0 text-center space-y-1 px-6 pt-5 pb-3 border-b border-zinc-800">
        <h1 className="text-2xl font-bold">Cerrar caja</h1>
        <p className="text-sm text-zinc-400">Registrá el arqueo antes de finalizar el turno</p>
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
        <div className="bg-zinc-800 rounded-xl border border-zinc-700 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Resumen del turno</h2>
          {loadError ? (
            <p className="text-red-400 text-sm">{loadError}</p>
          ) : summary ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Stat label="Turno" value={shiftLabel} />
                <Stat label="Apertura" value={startedFormatted} />
                <Stat label="Efectivo inicial" value={fmt(summary.openingCash)} />
                <Stat label="Ventas" value={String(summary.salesCount)} />
                <Stat label="Total vendido" value={fmt(summary.totalRevenue)} />
                <Stat label="Cobrado en efectivo" value={fmt(summary.totalCashSales)} />
                {summary.totalDebitSales > 0 && (
                  <Stat label="Débito" value={fmt(summary.totalDebitSales)} />
                )}
                {summary.totalWalletSales > 0 && (
                  <Stat label="Billetera Virtual" value={fmt(summary.totalWalletSales)} />
                )}
                {summary.totalCreditSales > 0 && (
                  <Stat label="Crédito" value={fmt(summary.totalCreditSales)} />
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
                <div className="mt-2 pt-3 border-t border-zinc-700">
                  <p className="text-xs text-zinc-500 mb-2 font-semibold uppercase tracking-wider">Ventas — desglose digital</p>
                  <div className="grid grid-cols-3 gap-2">
                    {summary.totalDebitSales > 0 && (
                      <div className="bg-zinc-700 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-zinc-500">Débito</p>
                        <p className="text-sm font-semibold text-sky-300">{fmt(summary.totalDebitSales)}</p>
                      </div>
                    )}
                    {summary.totalWalletSales > 0 && (
                      <div className="bg-zinc-700 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-zinc-500">Billetera Virtual</p>
                        <p className="text-sm font-semibold text-violet-300">{fmt(summary.totalWalletSales)}</p>
                      </div>
                    )}
                    {summary.totalCreditSales > 0 && (
                      <div className="bg-zinc-700 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-zinc-500">Crédito</p>
                        <p className="text-sm font-semibold text-amber-300">{fmt(summary.totalCreditSales)}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Desglose de señas por medio de pago */}
              {summary.depositsCount > 0 && (
                <div className="mt-2 pt-3 border-t border-zinc-700">
                  <p className="text-xs text-zinc-500 mb-2 font-semibold uppercase tracking-wider">Señas — desglose por medio</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {summary.totalCashDeposits > 0 && (
                      <div className="bg-zinc-700 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-zinc-500">Efectivo</p>
                        <p className="text-sm font-semibold text-emerald-300">{fmt(summary.totalCashDeposits)}</p>
                      </div>
                    )}
                    {summary.totalDebitDeposits > 0 && (
                      <div className="bg-zinc-700 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-zinc-500">Débito</p>
                        <p className="text-sm font-semibold text-sky-300">{fmt(summary.totalDebitDeposits)}</p>
                      </div>
                    )}
                    {summary.totalWalletDeposits > 0 && (
                      <div className="bg-zinc-700 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-zinc-500">Billetera Virtual</p>
                        <p className="text-sm font-semibold text-violet-300">{fmt(summary.totalWalletDeposits)}</p>
                      </div>
                    )}
                    {summary.totalCreditDeposits > 0 && (
                      <div className="bg-zinc-700 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-zinc-500">Crédito</p>
                        <p className="text-sm font-semibold text-amber-300">{fmt(summary.totalCreditDeposits)}</p>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-2">
                    Solo el efectivo de señas se suma al efectivo esperado en caja. Los cobros digitales de señas no impactan el conteo físico.
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-zinc-500 text-sm">Cargando resumen…</p>
          )}
        </div>

        {/* ── Monto a entregar / depositar ── */}
        <div className="bg-zinc-800 rounded-xl border border-zinc-700 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Entrega / depósito en caja fuerte
          </h2>
          <p className="text-xs text-zinc-500">
            Si vas a entregar o depositar parte del efectivo antes del conteo de caja, registralo acá.
          </p>

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

          {summary && deliveredAmount > 0 && (
            <div className="rounded-lg bg-zinc-700 px-4 py-2 text-sm">
              <span className="text-zinc-400">Efectivo a contar para caja: </span>
              <span className="font-semibold text-emerald-400">{fmt(expectedRegister)}</span>
            </div>
          )}
        </div>

        {/* ── Conteo de billetes (caja registradora) ── */}
        <div className="bg-zinc-800 rounded-xl border border-zinc-700 p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Conteo de billetes</h2>
              {summary && (
                <p className="text-xs text-zinc-500 mt-0.5">
                  Efectivo en caja a contabilizar: <span className="text-white font-medium">{fmt(expectedRegister)}</span>
                </p>
              )}
            </div>
            {/* Toggle de modo */}
            <div className="flex rounded-lg overflow-hidden border border-zinc-600 text-xs">
              <button
                onClick={() => handleBillModeChange('quantity')}
                className={`px-3 py-1.5 transition-colors ${
                  billMode === 'quantity'
                    ? 'bg-zinc-600 text-white'
                    : 'bg-zinc-950 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                Por cantidad
              </button>
              <button
                onClick={() => handleBillModeChange('total')}
                className={`px-3 py-1.5 transition-colors ${
                  billMode === 'total'
                    ? 'bg-zinc-600 text-white'
                    : 'bg-zinc-950 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                Por monto
              </button>
            </div>
          </div>

          <p className="text-[11px] text-zinc-600">
            {billMode === 'quantity'
              ? 'Ingresá cuántos billetes de cada tipo tenés en la caja.'
              : 'Ingresá el monto total por denominación (ej.: si tenés 5 billetes de $10.000, ingresá $50.000). Debe ser múltiplo de la denominación.'}
          </p>

          <div className="grid grid-cols-1 gap-1.5">
            {billRows.map(row => {
              const lineValue =
                billMode === 'quantity'
                  ? (parseNumericInput(row.quantity) ?? 0) * row.denomination
                  : (parseNumericInput(row.total) ?? 0)

              return (
                <div key={row.denomination} className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="w-24 text-sm text-zinc-300 font-medium text-right shrink-0">
                      {fmtDenomination(row.denomination)}
                    </span>
                    {billMode === 'quantity' ? (
                      <>
                        <span className="text-xs text-zinc-500">×</span>
                        <NumericInput
                          value={row.quantity}
                          onChange={v => updateBillRow(row.denomination, 'quantity', v)}
                          placeholder="0"
                          className="w-20 rounded-lg border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-600 text-center"
                        />
                        <span className="text-xs text-zinc-500 flex-1 text-right">
                          {lineValue > 0 ? fmt(lineValue) : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-zinc-500">=</span>
                        <NumericInput
                          value={row.total}
                          onChange={v => updateBillRow(row.denomination, 'total', v)}
                          placeholder="0"
                          className={`flex-1 rounded-lg border bg-zinc-950 px-2 py-1.5 text-sm text-white placeholder-zinc-500 focus:outline-none ${
                            row.totalError ? 'border-red-500 focus:border-red-400' : 'border-zinc-600 focus:border-emerald-600'
                          }`}
                        />
                      </>
                    )}
                  </div>
                  {row.totalError && (
                    <p className="text-xs text-red-400 pl-26 pl-[6.5rem]">{row.totalError}</p>
                  )}
                </div>
              )
            })}
          </div>

          {/* Total contado y diferencia */}
          <div className="pt-2 border-t border-zinc-700 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Total contado en caja</span>
              <span className="font-semibold text-white">{fmt(countedRegister)}</span>
            </div>
            {summary && countedRegister > 0 && (
              <div className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${
                diff === 0
                  ? 'bg-emerald-900/40 text-emerald-300'
                  : diff > 0
                  ? 'bg-blue-900/40 text-blue-300'
                  : 'bg-red-900/40 text-red-300'
              }`}>
                {diff === 0
                  ? '✓ Caja cuadrada'
                  : diff > 0
                  ? `▲ Sobrante: ${fmt(diff)} (hay más efectivo del esperado en caja)`
                  : `▼ Faltante: ${fmt(Math.abs(diff))} (hay menos efectivo del esperado en caja)`}
              </div>
            )}
          </div>
        </div>

        {/* ── Notas ── */}
        <div className="bg-zinc-800 rounded-xl border border-zinc-700 p-5">
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
          <p className="text-red-400 text-sm text-center">{saveError}</p>
        )}
      </div>
      </div>

      <div className="sticky bottom-0 z-10 shrink-0 border-t border-zinc-700 bg-zinc-900 px-6 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
        <div className="max-w-2xl mx-auto flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={saving || !summary}
            className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 font-semibold transition-colors disabled:opacity-40"
          >
            {saving ? 'Cerrando…' : 'Cerrar caja'}
          </button>
        </div>
      </div>
    </div>
    )}

    {showConfirm && summary && createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-overlay-fade">
        <div className="w-full max-w-sm max-h-[min(90vh,100dvh)] overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-800 p-6 space-y-4 animate-modal-enter">
          <h2 className="text-base font-semibold text-white">¿Cerrar el turno ahora?</h2>
          <p className="text-sm text-zinc-400">
            Esta acción finaliza el turno y no puede deshacerse. Verificá los datos antes de confirmar.
          </p>

          <div className="space-y-2 text-sm bg-zinc-700 rounded-xl p-4">
            <div className="flex justify-between">
              <span className="text-zinc-400">Total vendido</span>
              <span className="text-white font-semibold">{fmt(summary.totalRevenue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Efectivo esperado</span>
              <span className="text-emerald-400 font-semibold">{fmt(summary.cashInHand)}</span>
            </div>
            {deliveredAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-zinc-400">Monto a entregar</span>
                <span className="text-white">{fmt(deliveredAmount)}</span>
              </div>
            )}
            {countedRegister > 0 && (
              <div className={`flex justify-between border-t border-zinc-600 pt-2 ${diff === 0 ? 'text-emerald-400' : diff > 0 ? 'text-blue-300' : 'text-red-400'}`}>
                <span>{diff === 0 ? 'Caja cuadrada' : diff > 0 ? 'Sobrante' : 'Faltante'}</span>
                <span className="font-semibold">
                  {diff === 0 ? '✓' : fmt(Math.abs(diff))}
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl border border-zinc-600 text-zinc-300 hover:bg-zinc-700 transition-colors text-sm disabled:opacity-40"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={() => void doCloseShift()}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 font-semibold transition-colors text-white text-sm disabled:opacity-40"
            >
              {saving ? 'Cerrando…' : 'Cerrar turno'}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )}

    {closed && recapLines.length > 0 && createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-overlay-fade">
        <div className="w-full max-w-md max-h-[min(90vh,100dvh)] overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-800 p-6 space-y-4 animate-modal-enter">
          <div className="text-center space-y-1">
            <p className="text-3xl" aria-hidden>✅</p>
            <h2 className="text-xl font-bold text-emerald-400">Caja cerrada</h2>
            <p className="text-sm text-zinc-400">El turno quedó registrado. Este es el resumen del cierre.</p>
          </div>
          <div className="space-y-2 text-sm bg-zinc-700 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Resumen del cierre</h3>
            {recapLines.map(line => (
              <div
                key={line.label}
                className={`flex justify-between gap-3 ${line.indent ? 'pl-3' : ''}`}
              >
                <span className="text-zinc-400 min-w-0 truncate" title={line.label}>{line.label}</span>
                <span className={`shrink-0 font-medium ${
                  line.tone === 'emphasis' ? 'text-emerald-400 font-semibold'
                    : line.tone === 'ok' ? 'text-emerald-300'
                      : line.tone === 'info' ? 'text-blue-300'
                        : line.tone === 'bad' ? 'text-red-400'
                          : 'text-white'
                }`}>
                  {line.value}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onConfirmed}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-semibold transition-colors"
          >
            Finalizar sesión
          </button>
        </div>
      </div>,
      document.body,
    )}
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
      <label className="text-sm text-zinc-400">{label}</label>
      {children}
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`text-base font-semibold ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}
