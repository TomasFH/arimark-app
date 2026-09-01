/**
 * Pantalla de apertura de turno en el celular.
 * Espejo simplificado del OpenShiftScreen del desktop.
 */
import { useState } from 'react'
import { useBackLayer } from '../lib/backStack'
import NumericInput from './NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import type { ShiftType } from '../types/pos'

interface Props {
  displayName: string
  storeName: string
  onOpen: (shiftType: ShiftType, openingCash: number) => void
  onLogout: () => void
  logoutLabel?: string
  onBack?: () => void
}

export function OpenShiftScreen({ displayName, storeName, onOpen, onLogout, logoutLabel = 'Salir', onBack }: Props) {
  useBackLayer(Boolean(onBack), onBack ?? (() => {}))
  const [shiftType, setShiftType] = useState<ShiftType>('morning')
  const [cashInput, setCashInput] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const cash = parseNumericInput(cashInput)
    if (cash === null || cash < 0) {
      setError('Ingresá el efectivo inicial.')
      return
    }
    onOpen(shiftType, cash)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white" title={displayName}>{displayName}</p>
          <p className="truncate text-xs text-gray-400" title={storeName}>{storeName}</p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        >
          {logoutLabel}
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-green-700">
              <span className="text-2xl text-white">🕐</span>
            </div>
            <h2 className="text-xl font-bold text-white">Abrir turno</h2>
            <p className="mt-1 text-sm text-gray-400">Registrá el efectivo inicial antes de empezar</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm text-gray-300">Tipo de turno</label>
              <div className="grid grid-cols-2 gap-3">
                {(['morning', 'evening'] as ShiftType[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setShiftType(t)}
                    className={`rounded-xl py-3 text-sm font-semibold transition-colors ${
                      shiftType === t
                        ? 'bg-green-700 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {t === 'morning' ? '☀️ Mañana' : '🌙 Tarde'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm text-gray-300">Efectivo inicial ($)</label>
              <NumericInput
                value={cashInput}
                onChange={v => {
                  setCashInput(v)
                  setError('')
                }}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-center text-xl text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="0"
              />
              {error && <p className="mt-1 text-center text-xs text-red-400">{error}</p>}
            </div>

            <button
              type="submit"
              className="w-full rounded-xl bg-green-700 px-4 py-4 text-lg font-bold text-white transition-colors hover:bg-green-600"
            >
              Abrir turno
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
