import { useState } from 'react'
import type { ShiftInfo, ShiftType } from '../types/hw-api'

interface Props {
  onShiftOpened: (shift: ShiftInfo) => void
}

export default function OpenShiftScreen({ onShiftOpened }: Props) {
  const [shiftType, setShiftType] = useState<ShiftType>('morning')
  const [openingCash, setOpeningCash] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const cash = parseFloat(openingCash)
    if (isNaN(cash) || cash < 0) {
      setError('Ingresá un monto de efectivo inicial válido.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const result = await window.hw.openShift({ shiftType, openingCash: cash })
      if (!result.ok) {
        setError(result.error ?? 'No se pudo abrir el turno.')
        return
      }
      onShiftOpened(result.data)
    } catch {
      setError('Error de comunicación. Reintentar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Abrir turno</h1>
          <p className="mt-1 text-sm text-gray-400">Ingresá el efectivo inicial antes de comenzar</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl bg-gray-800 p-6 shadow-lg">
          {/* Turno */}
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

          {/* Efectivo inicial */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">
              Efectivo inicial en caja
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">
                $
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={openingCash}
                onChange={e => setOpeningCash(e.target.value)}
                placeholder="0,00"
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
            {loading ? 'Abriendo turno…' : 'Abrir turno'}
          </button>
        </form>
      </div>
    </div>
  )
}
