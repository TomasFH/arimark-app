/**
 * Pantalla de apertura de turno en el celular.
 * Espejo simplificado del OpenShiftScreen del desktop.
 */
import { useState } from 'react'
import type { ShiftType } from '../types/pos'

interface Props {
  displayName: string
  storeId: string
  onOpen: (shiftType: ShiftType, openingCash: number) => void
  onLogout: () => void
}

export function OpenShiftScreen({ displayName, storeId, onOpen, onLogout }: Props) {
  const [shiftType, setShiftType] = useState<ShiftType>('morning')
  const [cashInput, setCashInput] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const cash = parseFloat(cashInput.replace(',', '.')) || 0
    onOpen(shiftType, cash)
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
        <div>
          <p className="text-white font-semibold text-sm">{displayName}</p>
          <p className="text-gray-400 text-xs">Local: {storeId}</p>
        </div>
        <button
          onClick={onLogout}
          className="text-gray-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
        >
          Salir
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-green-700 rounded-2xl mb-3">
              <span className="text-white text-2xl">🕐</span>
            </div>
            <h2 className="text-white text-xl font-bold">Abrir turno</h2>
            <p className="text-gray-400 text-sm mt-1">Registrá el efectivo inicial antes de empezar</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm text-gray-300 mb-2">Tipo de turno</label>
              <div className="grid grid-cols-2 gap-3">
                {(['morning', 'evening'] as ShiftType[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setShiftType(t)}
                    className={`py-3 rounded-xl font-semibold text-sm transition-colors ${
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
              <label className="block text-sm text-gray-300 mb-1">Efectivo inicial ($)</label>
              <input
                type="text"
                inputMode="decimal"
                value={cashInput}
                onChange={e => setCashInput(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-xl text-center focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="0"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-green-700 hover:bg-green-600 text-white font-bold rounded-xl px-4 py-4 text-lg transition-colors"
            >
              Abrir turno
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
