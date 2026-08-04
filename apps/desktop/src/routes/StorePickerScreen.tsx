/**
 * Selector de local tras el login.
 * Se muestra cuando hay más de un local registrado en el sistema.
 */
import { useState } from 'react'
import type { StoreRow } from '../types/hw-api'

interface Props {
  stores: StoreRow[]
  intent?: 'cashier'
  onSelect: (storeId: string) => Promise<void>
  onLogout: () => void
}

export default function StorePickerScreen({ stores, intent, onSelect, onLogout }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isCashierMode = intent === 'cashier'

  async function handleSelect(storeId: string) {
    setError(null)
    setLoading(true)
    try {
      await onSelect(storeId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al seleccionar el local.')
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-900 p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-white">¿En qué local trabajás hoy?</h1>
          <p className="text-sm text-zinc-400">
            {isCashierMode
              ? 'Seleccioná el local donde vas a abrir la caja.'
              : 'Seleccioná el local donde vas a operar en este turno.'}
          </p>
        </div>

        <div className="space-y-3">
          {stores.map(store => (
            <button
              key={store.id}
              disabled={loading}
              onClick={() => void handleSelect(store.id)}
              className="w-full rounded-xl bg-zinc-800 border border-zinc-700 hover:border-blue-500 hover:bg-zinc-700 text-left px-5 py-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <p className="font-semibold text-white">{store.name}</p>
              {store.address && (
                <p className="text-sm text-zinc-400 mt-0.5 truncate" title={store.address}>
                  {store.address}
                </p>
              )}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-900/20 rounded-lg p-3 text-center">{error}</p>
        )}

        {loading && (
          <p className="text-center text-sm text-zinc-400 animate-pulse">Conectando…</p>
        )}

        <button
          onClick={onLogout}
          disabled={loading}
          className="w-full text-sm text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40 pt-2"
        >
          {isCashierMode ? '← Volver al hub' : '← Volver al login'}
        </button>
      </div>
    </div>
  )
}
