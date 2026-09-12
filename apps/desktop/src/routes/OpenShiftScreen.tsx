import { useState, useEffect, useRef } from 'react'
import NumericInput from '../components/NumericInput'
import BillCountGrid from '../components/BillCountGrid'
import { Button, Modal } from '../components/ui'
import { detectShiftType } from '../lib/detectShiftType'
import { civilYmd, hoursForDate, storeHoursSourceFromRecord, isEmptyBillCount } from '@carniceria/shared'
import { parseNumericInput } from '../lib/numericInput'
import {
  billRowsCountedTotal,
  billRowsFromLines,
  billRowsToLines,
  emptyBillRows,
  type BillMode,
  type BillRowState,
} from '../lib/billCountUi'
import type { CashHandoverSnapshot, ShiftInfo, ShiftType } from '../types/hw-api'

const BILL_MODE_KEY = 'close-shift-bill-mode'
const isProdEnv = import.meta.env['VITE_APP_ENV'] === 'production'

interface Props {
  onShiftOpened: (shift: ShiftInfo) => void
  onCancel?: () => void
  /** ID del local activo (para autodetección de turno y pre-verificación). */
  storeId?: string
  /** ID del usuario actual (para comparar con el turno abierto del local). */
  userId?: string
  /** Permite cerrar un turno ajeno colgado. Solo admin. */
  canForceClose?: boolean
  /** Label del botón de cancelar. Por defecto "← Cambiar local". */
  cancelLabel?: string
}

function loadBillMode(): BillMode {
  const stored = localStorage.getItem(BILL_MODE_KEY)
  return stored === 'total' ? 'total' : 'quantity'
}

export default function OpenShiftScreen({ onShiftOpened, onCancel, storeId, userId, canForceClose = false, cancelLabel = '← Cambiar local' }: Props) {
  const [shiftType, setShiftType] = useState<ShiftType>('morning')
  const [openingCash, setOpeningCash] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [blockingShift, setBlockingShift] = useState<{ shiftId: string; userName: string } | null>(null)
  const [forceClosing, setForceClosing] = useState(false)
  const [checking, setChecking] = useState(true)
  const submittingRef = useRef(false)

  const [billMode, setBillMode] = useState<BillMode>(loadBillMode)
  const [billRows, setBillRows] = useState<BillRowState[]>(emptyBillRows)
  const [handover, setHandover] = useState<CashHandoverSnapshot | null>(null)
  const [skipBills, setSkipBills] = useState(false)
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)

  async function checkExistingShift(): Promise<boolean> {
    setError('')
    setBlockingShift(null)
    const ownShift = await window.hw.getActiveShift()
    if (ownShift.ok && ownShift.data) {
      onShiftOpened(ownShift.data)
      return true
    }
    const storeShift = await window.hw.getStoreOpenShift()
    if (storeShift.ok && storeShift.data && storeShift.data.userId !== userId) {
      const ownerName = storeShift.data.userName
      setBlockingShift({ shiftId: storeShift.data.shiftId, userName: ownerName })
      setError(`Ya hay un turno abierto en este local (${ownerName}). Pedile que cierre su turno primero.`)
    }
    return false
  }

  useEffect(() => {
    if (!storeId || !userId) {
      setChecking(false)
      return
    }
    void (async () => {
      setChecking(true)
      const resumed = await checkExistingShift()
      if (!resumed) {
        const handoverRes = await window.hw.getCashHandover()
        if (handoverRes.ok && handoverRes.data) {
          setHandover(handoverRes.data)
          const rows = billRowsFromLines(handoverRes.data.bills)
          setBillRows(rows)
        }
        setChecking(false)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, userId])

  useEffect(() => {
    if (!storeId) return
    void window.hw.getStores({ includeArchived: false }).then(r => {
      if (!r.ok) return
      const store = r.data.find(s => s.id === storeId)
      if (!store) return

      const now = new Date()
      const nowMinutes = now.getHours() * 60 + now.getMinutes()
      const todayHours = hoursForDate(storeHoursSourceFromRecord(store), civilYmd(now))

      const detected = detectShiftType(
        nowMinutes,
        todayHours.morningStart,
        todayHours.morningEnd,
        todayHours.afternoonStart,
        todayHours.afternoonEnd,
      )
      setShiftType(detected)
    })
  }, [storeId])

  function handleBillModeChange(mode: BillMode): void {
    localStorage.setItem(BILL_MODE_KEY, mode)
    setBillMode(mode)
    setBillRows(prev => prev.map(r => ({ ...r, totalError: null })))
  }

  function updateBillRow(denomination: number, field: 'quantity' | 'total', value: string) {
    setSkipBills(false)
    setBillRows(prev => {
      const next = prev.map(r => {
        if (r.denomination !== denomination) return r
        const updated = { ...r, [field]: value }
        if (field === 'total' && value !== '' && value !== '0') {
          const parsed = parseNumericInput(value)
          if (parsed !== null && parsed > 0 && parsed % denomination !== 0) {
            updated.totalError = `Debe ser múltiplo de $${denomination.toLocaleString('es-AR')}`
          } else {
            updated.totalError = null
          }
        } else {
          updated.totalError = null
        }
        return updated
      })
      return next
    })
  }

  function validateTotalMode(): boolean {
    let valid = true
    setBillRows(prev =>
      prev.map(r => {
        const parsed = parseNumericInput(r.total)
        if (parsed !== null && parsed > 0 && parsed % r.denomination !== 0) {
          valid = false
          return { ...r, totalError: `Debe ser múltiplo de $${r.denomination.toLocaleString('es-AR')}` }
        }
        return { ...r, totalError: null }
      }),
    )
    return valid
  }

  async function submitOpen(confirmEmpty: boolean) {
    if (submittingRef.current) return
    const cash = parseNumericInput(openingCash)
    if (cash === null || cash < 0) {
      setError('Ingresá un monto de efectivo inicial válido.')
      return
    }

    submittingRef.current = true
    setLoading(true)
    setError('')

    const lines = skipBills ? undefined : billRowsToLines(billRows, billMode)

    try {
      const result = await window.hw.openShift({
        shiftType,
        openingCash: cash,
        openingBillDenominations: lines,
        confirmEmptyRegister: confirmEmpty || undefined,
        handoverFromShiftId: handover?.fromShiftId,
        handoverFromCashierName: handover?.fromCashierName,
        handoverFromClosedAt: handover?.fromClosedAt,
        handoverExpectedBills: handover?.bills,
      })
      if (!result.ok) {
        setError(result.error ?? 'No se pudo abrir el turno.')
        if (result.code === 'SHIFT_ALREADY_OPEN') {
          const storeShift = await window.hw.getStoreOpenShift()
          if (storeShift.ok && storeShift.data) {
            setBlockingShift({ shiftId: storeShift.data.shiftId, userName: storeShift.data.userName })
          }
        }
        return
      }
      onShiftOpened(result.data)
    } catch {
      setError('Error de comunicación. Reintentar.')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (billMode === 'total' && !skipBills && !validateTotalMode()) {
      setError('Hay montos que no son múltiplos de su denominación.')
      return
    }
    const lines = skipBills ? [] : billRowsToLines(billRows, billMode)
    if (isProdEnv && !skipBills && isEmptyBillCount(lines)) {
      setShowEmptyConfirm(true)
      return
    }
    await submitOpen(!skipBills && isEmptyBillCount(lines))
  }

  const countedTotal = billRowsCountedTotal(billRows, billMode)
  const expectedTotal = handover ? handover.bills.reduce((s, l) => s + l.denomination * l.quantity, 0) : undefined

  return (
    <div className="flex flex-1 min-h-0 h-full flex-col bg-app text-ink overflow-hidden">
      <div className="shrink-0 text-center space-y-1 px-6 pt-5 pb-3 border-b border-line bg-panel">
        <h1 className="text-2xl font-bold">Abrir turno</h1>
        <p className="text-sm text-muted truncate" title={handover
          ? `Precargado con lo que dejó ${handover.fromCashierName}. Corregí si no coincide — no se pisa el cierre anterior.`
          : 'Contá el efectivo que hay en la registradora'}
        >
          {handover
            ? `Precargado con lo que dejó ${handover.fromCashierName}. Corregí si no coincide — no se pisa el cierre anterior.`
            : 'Contá el efectivo que hay en la registradora'}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable]">
        <form onSubmit={handleSubmit} className="max-w-md mx-auto p-6 space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-ink">Turno</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShiftType('morning')}
                className={`rounded-lg border-2 py-3 text-sm font-semibold transition-colors ${
                  shiftType === 'morning'
                    ? 'border-line-accent bg-accent-soft text-ink'
                    : 'border-transparent bg-panel text-muted hover:bg-hover'
                }`}
              >
                🌅 Mañana
              </button>
              <button
                type="button"
                onClick={() => setShiftType('evening')}
                className={`rounded-lg border-2 py-3 text-sm font-semibold transition-colors ${
                  shiftType === 'evening'
                    ? 'border-line-accent bg-accent-soft text-ink'
                    : 'border-transparent bg-panel text-muted hover:bg-hover'
                }`}
              >
                🌙 Tarde
              </button>
            </div>
          </div>

          <BillCountGrid
            rows={billRows}
            mode={billMode}
            onModeChange={handleBillModeChange}
            onUpdate={updateBillRow}
            countedTotal={countedTotal}
            expectedTotal={expectedTotal}
            showExpectedDiff={Boolean(handover)}
            title="Lo que encontré en la registradora"
            subtitle={handover
              ? `Dejó ${handover.fromCashierName} al cerrar`
              : 'No hay un cierre anterior con desglose. Contá lo que hay.'}
          />

          {!isProdEnv && (
            <button
              type="button"
              onClick={() => {
                setSkipBills(true)
                setShowEmptyConfirm(false)
              }}
              className="w-full text-xs text-muted underline hover:text-ink"
            >
              Omitir conteo (modo pruebas)
            </button>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-ink">
              Efectivo inicial en caja
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted font-semibold">
                $
              </span>
              <NumericInput
                value={openingCash}
                onChange={setOpeningCash}
                placeholder="0"
                className="w-full rounded-lg border border-line bg-input pl-8 pr-4 py-3 text-ink placeholder-subtle focus:outline-none focus:border-line-accent"
                required
              />
            </div>
            <p className="text-[11px] text-muted">
              Lo que arranca el turno: vuelto que te dejaron, lo que te entregaron, o lo que sacaste de la caja fuerte. No es el conteo de la registradora de arriba.
            </p>
          </div>

          {error && (
            <div className="space-y-2">
              <p className="rounded-lg border border-danger bg-panel px-3 py-2 text-sm text-danger">{error}</p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setChecking(true)
                    void checkExistingShift().finally(() => setChecking(false))
                  }}
                  disabled={checking || forceClosing}
                  className="w-full rounded-lg border border-line py-2 text-sm text-ink transition-colors hover:bg-hover disabled:opacity-50"
                >
                  {checking ? 'Comprobando…' : 'Volver a comprobar'}
                </button>
                {canForceClose && blockingShift && (
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        setForceClosing(true)
                        setError('')
                        try {
                          const r = await window.hw.forceCloseOpenShift({ shiftId: blockingShift.shiftId })
                          if (!r.ok) {
                            setError(r.error ?? 'No se pudo cerrar el turno.')
                            return
                          }
                          setBlockingShift(null)
                        } catch {
                          setError('Error de comunicación. Reintentar.')
                        } finally {
                          setForceClosing(false)
                        }
                      })()
                    }}
                    disabled={forceClosing || checking}
                    className="w-full rounded-lg bg-raised py-2 text-sm font-medium text-ink transition-colors hover:bg-hover disabled:opacity-50"
                  >
                    {forceClosing ? 'Cerrando turno…' : `Cerrar el turno de ${blockingShift.userName}`}
                  </button>
                )}
              </div>
            </div>
          )}

          <Button
            type="submit"
            fullWidth
            size="lg"
            loading={loading}
            disabled={!!blockingShift}
          >
            {loading ? 'Abriendo turno…' : 'Abrir turno'}
          </Button>
          {onCancel && (
            <Button type="button" variant="secondary" fullWidth onClick={onCancel}>
              {cancelLabel}
            </Button>
          )}
        </form>
      </div>

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
              onClick={() => {
                setShowEmptyConfirm(false)
                void submitOpen(true)
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
    </div>
  )
}
