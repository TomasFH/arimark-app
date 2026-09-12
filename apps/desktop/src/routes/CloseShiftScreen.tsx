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
import BillCountGrid from '../components/BillCountGrid'
import { Button, Modal } from '../components/ui'
import { parseNumericInput } from '../lib/numericInput'
import {
  billRowsCountedTotal,
  billRowsToLines,
  emptyBillRows,
  type BillMode,
  type BillRowState,
} from '../lib/billCountUi'
import { buildCloseShiftRecapLines } from '../lib/closeShiftRecap'
import { isEmptyBillCount } from '@carniceria/shared'
import type { ShiftSummary } from '../types/hw-api'

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

  // Entrega / depósito
  const [deliveredAmountRaw, setDeliveredAmountRaw] = useState('')
  const [deliveredTo, setDeliveredTo] = useState('')
  const [notes, setNotes] = useState('')

  // Conteo de billetes
  const [billMode, setBillMode] = useState<BillMode>(loadBillMode)
  const [billRows, setBillRows] = useState<BillRowState[]>(emptyBillRows)
  const [skipBills, setSkipBills] = useState(false)
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)

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
      if (showEmptyConfirm) {
        setShowEmptyConfirm(false)
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
  }, [saving, closed, showConfirm, showEmptyConfirm, onCancel, onConfirmed])

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
          updated.totalError = `Debe ser múltiplo de ${fmt(denomination)}`
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
          return { ...r, totalError: `Debe ser múltiplo de ${fmt(r.denomination)}` }
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
  const countedRegister = billRowsCountedTotal(billRows, billMode)

  /** Diferencia: positiva = sobrante, negativa = faltante (respecto a expectedRegister). */
  const diff = countedRegister - expectedRegister

  async function handleConfirm() {
    if (billMode === 'total' && !validateTotalMode()) {
      setSaveError('Hay montos que no son múltiplos de su denominación. Corregalos antes de cerrar.')
      return
    }
    const lines = billRowsToLines(billRows, billMode)
    if (isProdEnv && !skipBills && isEmptyBillCount(lines)) {
      setShowEmptyConfirm(true)
      return
    }
    setShowConfirm(true)
  }

  async function doCloseShift() {
    setSaveError(null)
    setSaving(true)

    const lines = skipBills ? undefined : billRowsToLines(billRows, billMode)
    const emptyConfirmed = !skipBills && isEmptyBillCount(lines ?? [])

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
        billDenominations: lines,
        confirmEmptyRegister: emptyConfirmed || undefined,
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
      <div className="flex flex-1 min-h-0 h-full bg-app" aria-hidden />
    ) : (
    <div className="flex flex-1 min-h-0 h-full flex-col bg-app text-ink overflow-hidden">
      <div className="shrink-0 text-center space-y-1 px-6 pt-5 pb-3 border-b border-line bg-panel">
        <h1 className="text-2xl font-bold">Cerrar caja</h1>
        <p className="text-sm text-muted">Registrá el arqueo antes de finalizar el turno</p>
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
                <div className="mt-2 pt-3 border-t border-line">
                  <p className="text-xs text-muted mb-2 font-semibold">Ventas — desglose digital</p>
                  <div className="grid grid-cols-3 gap-2">
                    {summary.totalDebitSales > 0 && (
                      <div className="bg-raised rounded-lg px-3 py-2">
                        <p className="text-[10px] text-muted">Débito</p>
                        <p className="text-sm font-semibold text-ink">{fmt(summary.totalDebitSales)}</p>
                      </div>
                    )}
                    {summary.totalWalletSales > 0 && (
                      <div className="bg-raised rounded-lg px-3 py-2">
                        <p className="text-[10px] text-muted">Billetera Virtual</p>
                        <p className="text-sm font-semibold text-ink">{fmt(summary.totalWalletSales)}</p>
                      </div>
                    )}
                    {summary.totalCreditSales > 0 && (
                      <div className="bg-raised rounded-lg px-3 py-2">
                        <p className="text-[10px] text-muted">Crédito</p>
                        <p className="text-sm font-semibold text-ink">{fmt(summary.totalCreditSales)}</p>
                      </div>
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

        {/* ── Monto a entregar / depositar ── */}
        <div className="bg-panel rounded-xl border border-line p-5 space-y-4">
          <h2 className="text-sm font-semibold text-muted">
            Entrega / depósito en caja fuerte
          </h2>
          <p className="text-xs text-muted">
            Si un admin retiró efectivo, o si dejás plata en la caja fuerte, registralo acá.
            Lo que queda en la registradora (vuelto del próximo turno) se cuenta abajo.
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
            <div className="rounded-lg bg-raised px-4 py-2 text-sm">
              <span className="text-muted">Efectivo a contar para caja: </span>
              <span className="font-semibold text-success">{fmt(expectedRegister)}</span>
            </div>
          )}
        </div>

        {/* ── Conteo de billetes (caja registradora) ── */}
        <BillCountGrid
          rows={billRows}
          mode={billMode}
          onModeChange={handleBillModeChange}
          onUpdate={updateBillRow}
          countedTotal={countedRegister}
          expectedTotal={expectedRegister}
          showExpectedDiff={Boolean(summary)}
          title="Conteo de billetes"
          subtitle={summary
            ? `Billetes que quedan en la registradora. Efectivo a contabilizar: ${fmt(expectedRegister)}`
            : 'Billetes que quedan en la registradora (no lo entregado / caja fuerte).'}
        />
        {!isProdEnv && (
          <button
            type="button"
            onClick={() => {
              setSkipBills(true)
              setShowEmptyConfirm(false)
              setShowConfirm(true)
            }}
            className="w-full text-xs text-muted underline hover:text-ink"
          >
            Omitir conteo (modo pruebas)
          </button>
        )}

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
      open={showEmptyConfirm}
      onClose={() => setShowEmptyConfirm(false)}
      title="¿Caja vacía?"
      size="sm"
      closeOnOverlay={false}
      footer={
        <>
          <Button variant="secondary" onClick={() => setShowEmptyConfirm(false)}>
            Volver
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setShowEmptyConfirm(false)
              setShowConfirm(true)
            }}
          >
            Confirmar
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        ¿Confirmás que no queda ningún billete en caja?
      </p>
    </Modal>

    <Modal
      open={showConfirm && summary != null}
      onClose={() => setShowConfirm(false)}
      title="¿Cerrar el turno ahora?"
      size="sm"
      closeOnOverlay={false}
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
            {countedRegister > 0 && (
              <div className={`flex justify-between border-t border-line pt-2 ${diff === 0 ? 'text-success' : diff > 0 ? 'text-ink' : 'text-danger'}`}>
                <span>{diff === 0 ? 'Caja cuadrada' : diff > 0 ? 'Sobrante' : 'Faltante'}</span>
                <span className="font-semibold">
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
      closeOnOverlay={false}
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

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-base font-semibold ${highlight ? 'text-success' : 'text-ink'}`}>{value}</p>
    </div>
  )
}
