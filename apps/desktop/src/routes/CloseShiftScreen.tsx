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
import NumericInput from '../components/NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import type { ShiftSummary } from '../types/hw-api'

/** Denominaciones vigentes en Argentina (sin billete de $5.000). */
const DENOMINATIONS = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10]

const BILL_MODE_KEY = 'close-shift-bill-mode'
type BillMode = 'quantity' | 'total'

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

  useEffect(() => {
    void window.hw.getShiftSummary().then(r => {
      if (r.ok) setSummary(r.data)
      else setLoadError(r.error)
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
    setShowConfirm(false)
    setSaveError(null)

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

    const r = await window.hw.closeShift({
      closingCash,
      deliveredAmount: deliveredAmount > 0 ? deliveredAmount : undefined,
      deliveredTo: deliveredTo.trim() || undefined,
      notes: notes.trim() || undefined,
      billDenominations: billDenominations.length > 0 ? billDenominations : undefined,
    })

    setSaving(false)
    if (!r.ok) {
      setSaveError(r.error)
      return
    }

    // Guardar resumen para la pantalla de confirmación
    setClosedSummary({
      deliveredAmount,
      deliveredTo: deliveredTo.trim(),
      countedRegister,
      diff,
      notes: notes.trim(),
    })
    setClosed(true)
  }

  // ---------------------------------------------------------------------------
  // Pantalla de confirmación post-cierre
  // ---------------------------------------------------------------------------
  if (closed && closedSummary && summary) {
    const shiftLabel = summary.shiftType === 'morning' ? 'Mañana' : 'Tarde'
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <div className="text-5xl">✅</div>
            <h1 className="text-2xl font-bold text-emerald-400">Caja cerrada</h1>
            <p className="text-sm text-gray-400">El turno quedó registrado correctamente.</p>
          </div>

          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-3 text-sm">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Resumen del cierre</h2>
            <Row label="Turno" value={shiftLabel} />
            <Row label="Ventas" value={String(summary.salesCount)} />
            <Row label="Total vendido" value={fmt(summary.totalRevenue)} />
            <Row label="Cobrado en efectivo" value={fmt(summary.totalCashSales)} />
            {summary.totalDebitSales > 0 && (
              <Row label="Cobrado con Débito" value={fmt(summary.totalDebitSales)} />
            )}
            {summary.totalWalletSales > 0 && (
              <Row label="Cobrado Billetera Virtual" value={fmt(summary.totalWalletSales)} />
            )}
            {summary.totalCreditSales > 0 && (
              <Row label="Cobrado con Crédito" value={fmt(summary.totalCreditSales)} />
            )}
            {summary.totalExpenses > 0 && (
              <Row label="Gastos" value={fmt(summary.totalExpenses)} />
            )}
            {summary.debtsCount > 0 && (
              <Row label={`Fiados (${summary.debtsCount})`} value={fmt(summary.totalDebts)} />
            )}
            {summary.depositsCount > 0 && (
              <>
                <Row label={`Señas (${summary.depositsCount} pedidos)`} value={fmt(summary.totalCashDeposits + summary.totalDigitalDeposits)} />
                {summary.totalCashDeposits > 0 && (
                  <Row label="  · Señas en efectivo" value={fmt(summary.totalCashDeposits)} />
                )}
                {summary.totalDebitDeposits > 0 && (
                  <Row label="  · Señas Débito" value={fmt(summary.totalDebitDeposits)} />
                )}
                {summary.totalWalletDeposits > 0 && (
                  <Row label="  · Señas Billetera Virtual" value={fmt(summary.totalWalletDeposits)} />
                )}
                {summary.totalCreditDeposits > 0 && (
                  <Row label="  · Señas Crédito" value={fmt(summary.totalCreditDeposits)} />
                )}
              </>
            )}
            <div className="border-t border-gray-800 pt-2">
              <Row label="Efectivo esperado" value={fmt(summary.cashInHand)} bold />
            </div>
            {closedSummary.deliveredAmount > 0 && (
              <Row
                label={closedSummary.deliveredTo ? `Entregado a ${closedSummary.deliveredTo}` : 'Monto entregado'}
                value={fmt(closedSummary.deliveredAmount)}
              />
            )}
            {closedSummary.countedRegister > 0 && (
              <Row label="Contado en caja" value={fmt(closedSummary.countedRegister)} />
            )}
            {closedSummary.countedRegister > 0 && (
              <div className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                closedSummary.diff === 0
                  ? 'bg-emerald-900/40 text-emerald-300'
                  : closedSummary.diff > 0
                  ? 'bg-blue-900/40 text-blue-300'
                  : 'bg-red-900/40 text-red-300'
              }`}>
                {closedSummary.diff === 0
                  ? '✓ Caja cuadrada'
                  : closedSummary.diff > 0
                  ? `▲ Sobrante: ${fmt(closedSummary.diff)}`
                  : `▼ Faltante: ${fmt(Math.abs(closedSummary.diff))}`}
              </div>
            )}
            {closedSummary.notes && (
              <Row label="Notas" value={closedSummary.notes} />
            )}
          </div>

          <button
            onClick={onConfirmed}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-semibold transition-colors"
          >
            Finalizar sesión
          </button>
        </div>
      </div>
    )
  }

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
    <div className="min-h-screen bg-gray-950 text-white overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold">Cerrar caja</h1>
          <p className="text-sm text-gray-400">Registrá el arqueo antes de finalizar el turno</p>
        </div>

        {/* ── Resumen del turno ── */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Resumen del turno</h2>
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
                {summary.debtsCount > 0 && (
                  <Stat label={`Fiados (${summary.debtsCount})`} value={fmt(summary.totalDebts)} />
                )}
                {summary.depositsCount > 0 && (
                  <Stat label={`Señas (${summary.depositsCount} pedidos)`} value={fmt(summary.totalCashDeposits + summary.totalDigitalDeposits)} />
                )}
                <Stat label="Efectivo esperado" value={fmt(summary.cashInHand)} highlight />
              </div>

              {/* Desglose digital de ventas por tipo */}
              {totalDigital > 0 && (
                <div className="mt-2 pt-3 border-t border-gray-800">
                  <p className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wider">Ventas — desglose digital</p>
                  <div className="grid grid-cols-3 gap-2">
                    {summary.totalDebitSales > 0 && (
                      <div className="bg-gray-800 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-gray-500">Débito</p>
                        <p className="text-sm font-semibold text-sky-300">{fmt(summary.totalDebitSales)}</p>
                      </div>
                    )}
                    {summary.totalWalletSales > 0 && (
                      <div className="bg-gray-800 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-gray-500">Billetera Virtual</p>
                        <p className="text-sm font-semibold text-violet-300">{fmt(summary.totalWalletSales)}</p>
                      </div>
                    )}
                    {summary.totalCreditSales > 0 && (
                      <div className="bg-gray-800 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-gray-500">Crédito</p>
                        <p className="text-sm font-semibold text-amber-300">{fmt(summary.totalCreditSales)}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Desglose de señas por medio de pago */}
              {summary.depositsCount > 0 && (
                <div className="mt-2 pt-3 border-t border-gray-800">
                  <p className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wider">Señas — desglose por medio</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {summary.totalCashDeposits > 0 && (
                      <div className="bg-gray-800 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-gray-500">Efectivo</p>
                        <p className="text-sm font-semibold text-emerald-300">{fmt(summary.totalCashDeposits)}</p>
                      </div>
                    )}
                    {summary.totalDebitDeposits > 0 && (
                      <div className="bg-gray-800 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-gray-500">Débito</p>
                        <p className="text-sm font-semibold text-sky-300">{fmt(summary.totalDebitDeposits)}</p>
                      </div>
                    )}
                    {summary.totalWalletDeposits > 0 && (
                      <div className="bg-gray-800 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-gray-500">Billetera Virtual</p>
                        <p className="text-sm font-semibold text-violet-300">{fmt(summary.totalWalletDeposits)}</p>
                      </div>
                    )}
                    {summary.totalCreditDeposits > 0 && (
                      <div className="bg-gray-800 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-gray-500">Crédito</p>
                        <p className="text-sm font-semibold text-amber-300">{fmt(summary.totalCreditDeposits)}</p>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-600 mt-2">
                    Solo el efectivo de señas se suma al efectivo esperado en caja. Los cobros digitales de señas no impactan el conteo físico.
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-gray-500 text-sm animate-pulse">Cargando resumen…</p>
          )}
        </div>

        {/* ── Monto a entregar / depositar ── */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Entrega / depósito en caja fuerte
          </h2>
          <p className="text-xs text-gray-500">
            Si vas a entregar o depositar parte del efectivo antes del conteo de caja, registralo acá.
          </p>

          <Field label="Monto a entregar o depositar (opcional)">
            <NumericInput
              value={deliveredAmountRaw}
              onChange={v => setDeliveredAmountRaw(v)}
              placeholder="0"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
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
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </Field>
          )}

          {summary && deliveredAmount > 0 && (
            <div className="rounded-lg bg-gray-800 px-4 py-2 text-sm">
              <span className="text-gray-400">Efectivo a contar para caja: </span>
              <span className="font-semibold text-emerald-400">{fmt(expectedRegister)}</span>
            </div>
          )}
        </div>

        {/* ── Conteo de billetes (caja registradora) ── */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Conteo de billetes</h2>
              {summary && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Efectivo en caja a contabilizar: <span className="text-white font-medium">{fmt(expectedRegister)}</span>
                </p>
              )}
            </div>
            {/* Toggle de modo */}
            <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
              <button
                onClick={() => handleBillModeChange('quantity')}
                className={`px-3 py-1.5 transition-colors ${
                  billMode === 'quantity'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                Por cantidad
              </button>
              <button
                onClick={() => handleBillModeChange('total')}
                className={`px-3 py-1.5 transition-colors ${
                  billMode === 'total'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                Por monto
              </button>
            </div>
          </div>

          <p className="text-[11px] text-gray-600">
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
                    <span className="w-24 text-sm text-gray-300 font-medium text-right shrink-0">
                      {fmtDenomination(row.denomination)}
                    </span>
                    {billMode === 'quantity' ? (
                      <>
                        <span className="text-xs text-gray-500">×</span>
                        <NumericInput
                          value={row.quantity}
                          onChange={v => updateBillRow(row.denomination, 'quantity', v)}
                          placeholder="0"
                          className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-center"
                        />
                        <span className="text-xs text-gray-500 flex-1 text-right">
                          {lineValue > 0 ? fmt(lineValue) : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-gray-500">=</span>
                        <NumericInput
                          value={row.total}
                          onChange={v => updateBillRow(row.denomination, 'total', v)}
                          placeholder="0"
                          className={`flex-1 bg-gray-800 border rounded-lg px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none ${
                            row.totalError ? 'border-red-500 focus:border-red-400' : 'border-gray-700 focus:border-blue-500'
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
          <div className="pt-2 border-t border-gray-800 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Total contado en caja</span>
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
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <Field label="Notas del turno (opcional)">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Observaciones del turno…"
              rows={2}
              maxLength={300}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </Field>
        </div>

        {saveError && (
          <p className="text-red-400 text-sm text-center">{saveError}</p>
        )}

        <div className="flex gap-3 pb-6">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-3 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={saving || !summary}
            className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 font-semibold transition-colors disabled:opacity-40"
          >
            {saving ? 'Cerrando…' : 'Confirmar cierre de turno'}
          </button>
        </div>
      </div>
    </div>

    {/* Modal de confirmación antes de ejecutar el cierre */}
    {showConfirm && summary && (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-overlay-fade">
        <div className="bg-gray-900 rounded-2xl border border-gray-800 w-full max-w-sm p-6 space-y-4">
          <h2 className="text-base font-semibold text-white">¿Cerrar el turno ahora?</h2>
          <p className="text-sm text-gray-400">
            Esta acción finaliza el turno y no puede deshacerse. Verificá los datos antes de confirmar.
          </p>

          <div className="space-y-2 text-sm bg-gray-800/50 rounded-xl p-4">
            <div className="flex justify-between">
              <span className="text-gray-400">Total vendido</span>
              <span className="text-white font-semibold">{fmt(summary.totalRevenue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Efectivo esperado</span>
              <span className="text-emerald-400 font-semibold">{fmt(summary.cashInHand)}</span>
            </div>
            {deliveredAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-400">Monto a entregar</span>
                <span className="text-white">{fmt(deliveredAmount)}</span>
              </div>
            )}
            {countedRegister > 0 && (
              <div className={`flex justify-between border-t border-gray-700 pt-2 ${diff === 0 ? 'text-emerald-400' : diff > 0 ? 'text-blue-300' : 'text-red-400'}`}>
                <span>{diff === 0 ? 'Caja cuadrada' : diff > 0 ? 'Sobrante' : 'Faltante'}</span>
                <span className="font-semibold">
                  {diff === 0 ? '✓' : fmt(Math.abs(diff))}
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setShowConfirm(false)}
              className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors text-sm"
            >
              Volver
            </button>
            <button
              onClick={() => void doCloseShift()}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 font-semibold transition-colors text-white text-sm disabled:opacity-40"
            >
              {saving ? 'Cerrando…' : 'Cerrar turno'}
            </button>
          </div>
        </div>
      </div>
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
      <label className="text-sm text-gray-400">{label}</label>
      {children}
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-base font-semibold ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className={bold ? 'font-bold text-white' : 'text-white'}>{value}</span>
    </div>
  )
}
