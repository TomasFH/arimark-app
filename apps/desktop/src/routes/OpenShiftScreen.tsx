import { useState, useEffect, useRef } from 'react'
import NumericInput from '../components/NumericInput'
import { detectShiftType } from '../lib/detectShiftType'
import { parseNumericInput } from '../lib/numericInput'
import type { ShiftInfo, ShiftType } from '../types/hw-api'

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

export default function OpenShiftScreen({ onShiftOpened, onCancel, storeId, userId, canForceClose = false, cancelLabel = '← Cambiar local' }: Props) {
  const [shiftType, setShiftType] = useState<ShiftType>('morning')
  const [openingCash, setOpeningCash] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [blockingShift, setBlockingShift] = useState<{ shiftId: string; userName: string } | null>(null)
  const [forceClosing, setForceClosing] = useState(false)
  const [checking, setChecking] = useState(true)
  // Guard síncrono contra spam-click: se setea a true antes del await, sin esperar
  // al re-render de React, para que ningún click adicional dispare un IPC duplicado.
  const submittingRef = useRef(false)

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

  // Pre-verificación al montar: evitar parpadeo cuando ya hay un turno abierto.
  useEffect(() => {
    if (!storeId || !userId) {
      setChecking(false)
      return
    }
    void (async () => {
      setChecking(true)
      const resumed = await checkExistingShift()
      if (!resumed) setChecking(false)
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

      const detected = detectShiftType(
        nowMinutes,
        store.morningStart,
        store.morningEnd,
        store.afternoonStart,
        store.afternoonEnd,
      )
      setShiftType(detected)
    })
  }, [storeId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submittingRef.current) return

    const cash = parseNumericInput(openingCash)
    if (cash === null || cash < 0) {
      setError('Ingresá un monto de efectivo inicial válido.')
      return
    }

    // Setear el ref síncronamente antes del await para bloquear cualquier
    // click adicional en el mismo frame, sin depender del re-render de React.
    submittingRef.current = true
    setLoading(true)
    setError('')

    try {
      const result = await window.hw.openShift({ shiftType, openingCash: cash })
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
      // result.data puede tener resumed=true si el handler retomó un turno ya existente.
      onShiftOpened(result.data)
    } catch {
      setError('Error de comunicación. Reintentar.')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-900 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Abrir turno</h1>
          <p className="mt-1 text-sm text-zinc-400">Ingresá el efectivo inicial antes de comenzar</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl bg-zinc-800 p-6 shadow-lg">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-300">Turno</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShiftType('morning')}
                className={`rounded-lg border-2 py-3 text-sm font-semibold transition-colors ${
                  shiftType === 'morning'
                    ? 'border-emerald-500 bg-emerald-700/40 text-emerald-100'
                    : 'border-transparent bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                }`}
              >
                🌅 Mañana
              </button>
              <button
                type="button"
                onClick={() => setShiftType('evening')}
                className={`rounded-lg border-2 py-3 text-sm font-semibold transition-colors ${
                  shiftType === 'evening'
                    ? 'border-emerald-500 bg-emerald-700/40 text-emerald-100'
                    : 'border-transparent bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                }`}
              >
                🌙 Tarde
              </button>
            </div>
          </div>

          {/* Efectivo inicial */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-300">
              Efectivo inicial en caja
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 font-semibold">
                $
              </span>
              <NumericInput
                value={openingCash}
                onChange={setOpeningCash}
                placeholder="0"
                className="w-full rounded-lg bg-zinc-700 pl-8 pr-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500"
                required
              />
            </div>
          </div>

          {error && (
            <div className="space-y-2">
              <p className="rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-300">{error}</p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setChecking(true)
                    void checkExistingShift().finally(() => setChecking(false))
                  }}
                  disabled={checking || forceClosing}
                  className="w-full rounded-lg border border-zinc-700 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
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
                    className="w-full rounded-lg bg-zinc-700 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-600 disabled:opacity-50"
                  >
                    {forceClosing ? 'Cerrando turno…' : `Cerrar el turno de ${blockingShift.userName}`}
                  </button>
                )}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !!blockingShift}
            className="w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading ? 'Abriendo turno…' : 'Abrir turno'}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="w-full rounded-lg bg-zinc-700 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-600"
            >
              {cancelLabel}
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
