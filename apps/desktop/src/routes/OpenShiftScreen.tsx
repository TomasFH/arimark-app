import { useState, useEffect, useRef } from 'react'
import NumericInput from '../components/NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import type { ShiftInfo, ShiftType } from '../types/hw-api'

interface Props {
  onShiftOpened: (shift: ShiftInfo) => void
  onCancel?: () => void
  /** ID del local activo (para autodetección de turno y pre-verificación). */
  storeId?: string
  /** ID del usuario actual (para comparar con el turno abierto del local). */
  userId?: string
  /** Label del botón de cancelar. Por defecto "← Cambiar local". */
  cancelLabel?: string
}

/** Compara "HH:MM" string con los minutos totales del día. */
function timeToMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map(Number)
  return (hh ?? 0) * 60 + (mm ?? 0)
}

/** Devuelve el tipo de turno detectado según la hora actual y los rangos configurados. */
function detectShiftType(
  nowMinutes: number,
  morningStart: string | null | undefined,
  morningEnd: string | null | undefined,
  afternoonStart: string | null | undefined,
  afternoonEnd: string | null | undefined,
): ShiftType | null {
  if (morningStart && morningEnd) {
    const start = timeToMinutes(morningStart)
    const end = timeToMinutes(morningEnd)
    if (nowMinutes >= start && nowMinutes <= end) return 'morning'
  }
  if (afternoonStart && afternoonEnd) {
    const start = timeToMinutes(afternoonStart)
    const end = timeToMinutes(afternoonEnd)
    if (nowMinutes >= start && nowMinutes <= end) return 'evening'
  }
  return null
}

export default function OpenShiftScreen({ onShiftOpened, onCancel, storeId, userId, cancelLabel = '← Cambiar local' }: Props) {
  const [shiftType, setShiftType] = useState<ShiftType>('morning')
  const [openingCash, setOpeningCash] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Guard síncrono contra spam-click: se setea a true antes del await, sin esperar
  // al re-render de React, para que ningún click adicional dispare un IPC duplicado.
  const submittingRef = useRef(false)

  // Autodetección de tipo de turno por horario
  const [detectedShiftType, setDetectedShiftType] = useState<ShiftType | null>(null)
  const [detectedLabel, setDetectedLabel] = useState('')
  const [showManual, setShowManual] = useState(false)

  // Pre-verificación al montar: evitar parpadeo cuando ya hay un turno abierto.
  useEffect(() => {
    if (!storeId || !userId) return
    void (async () => {
      // 1. Verificar si el usuario actual ya tiene un turno abierto → retomar sin mostrar formulario.
      const ownShift = await window.hw.getActiveShift()
      if (ownShift.ok && ownShift.data) {
        onShiftOpened(ownShift.data)
        return
      }
      // 2. Verificar si otro usuario tiene el turno del local abierto → mostrar error inmediatamente.
      const storeShift = await window.hw.getStoreOpenShift()
      if (storeShift.ok && storeShift.data && storeShift.data.userId !== userId) {
        const ownerName = storeShift.data.userName
        setError(`Ya hay un turno abierto en este local (${ownerName}). Pedile que cierre su turno primero.`)
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

      const detected = detectShiftType(
        nowMinutes,
        store.morningStart,
        store.morningEnd,
        store.afternoonStart,
        store.afternoonEnd,
      )

      if (detected) {
        setDetectedShiftType(detected)
        setShiftType(detected)
        const startLabel = detected === 'morning' ? store.morningStart : store.afternoonStart
        const endLabel = detected === 'morning' ? store.morningEnd : store.afternoonEnd
        setDetectedLabel(`${startLabel} – ${endLabel}`)
      }
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
        // El mensaje de error para SHIFT_ALREADY_OPEN ya viene formado desde el backend con el nombre
        // de la cajera que tiene el turno abierto; usarlo directamente sin hardcodear.
        setError(result.error ?? 'No se pudo abrir el turno.')
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

  const isAutoDetected = detectedShiftType !== null && !showManual

  return (
    <div className="flex flex-1 items-center justify-center bg-gray-900 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Abrir turno</h1>
          <p className="mt-1 text-sm text-gray-400">Ingresá el efectivo inicial antes de comenzar</p>
        </div>

        {/* Banner de autodetección */}
        {isAutoDetected && (
          <div className="rounded-xl bg-amber-900/30 border border-amber-700/50 px-4 py-3 space-y-2">
            <p className="text-sm text-amber-300 font-medium">
              Turno detectado automáticamente:{' '}
              <span className="font-bold">
                {detectedShiftType === 'morning' ? '🌅 Mañana' : '🌙 Tarde'}
              </span>{' '}
              ({detectedLabel})
            </p>
            <p className="text-xs text-amber-400">¿Confirmar o preferís elegir manualmente?</p>
            <button
              type="button"
              onClick={() => setShowManual(true)}
              className="text-xs text-amber-400 underline hover:text-amber-300 transition-colors"
            >
              Elegir manualmente
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl bg-gray-800 p-6 shadow-lg">
          {/* Selector de turno — solo si no hay autodetección o se eligió manualmente */}
          {(!isAutoDetected) && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Turno</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setShiftType('morning')}
                  className={`rounded-lg py-3 text-sm font-semibold transition-colors ${
                    shiftType === 'morning'
                      ? 'bg-amber-500 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  🌅 Mañana
                </button>
                <button
                  type="button"
                  onClick={() => setShiftType('evening')}
                  className={`rounded-lg py-3 text-sm font-semibold transition-colors ${
                    shiftType === 'evening'
                      ? 'bg-indigo-500 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  🌙 Tarde
                </button>
              </div>
            </div>
          )}

          {/* Turno confirmado por autodetección (solo lectura) */}
          {isAutoDetected && (
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-300">Turno</label>
              <div className={`rounded-lg py-3 text-sm font-semibold text-center ${
                detectedShiftType === 'morning' ? 'bg-amber-500 text-white' : 'bg-indigo-500 text-white'
              }`}>
                {detectedShiftType === 'morning' ? '🌅 Mañana' : '🌙 Tarde'}
              </div>
            </div>
          )}

          {/* Efectivo inicial */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">
              Efectivo inicial en caja
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">
                $
              </span>
              <NumericInput
                value={openingCash}
                onChange={setOpeningCash}
                placeholder="0"
                className="w-full rounded-lg bg-gray-700 pl-8 pr-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-300">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-amber-500 py-3 font-semibold text-white transition-colors hover:bg-amber-400 disabled:opacity-50"
          >
            {loading ? 'Abriendo turno…' : isAutoDetected ? 'Confirmar y abrir turno' : 'Abrir turno'}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="w-full rounded-lg bg-gray-700 py-2.5 text-sm text-gray-300 transition-colors hover:bg-gray-600"
            >
              {cancelLabel}
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
