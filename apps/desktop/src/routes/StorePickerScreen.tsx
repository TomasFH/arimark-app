/**
 * Selector de local tras el login.
 * Se muestra cuando hay más de un local. Resalta el último usado en esta PC.
 * Elegir otro pide una confirmación extra (DT-04).
 */
import { useState } from 'react'
import type { StoreRow } from '../types/hw-api'

interface Props {
  stores: StoreRow[]
  intent?: 'cashier'
  preferredStoreId?: string | null
  onSelect: (storeId: string) => Promise<void>
  onLogout: () => void
}

function StoreButton({
  store,
  loading,
  highlighted,
  onSelect,
}: {
  store: StoreRow
  loading: boolean
  highlighted: boolean
  onSelect: (storeId: string) => void
}) {
  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => onSelect(store.id)}
      className={`w-full rounded-xl border text-left px-5 py-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-0 ${
        highlighted
          ? 'bg-emerald-950/40 border-emerald-600 hover:border-emerald-400'
          : 'bg-zinc-800 border-zinc-700 hover:border-emerald-500 hover:bg-emerald-950/30'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <p className="font-semibold text-white min-w-0 flex-1 truncate" title={store.name}>
          {store.name}
        </p>
        {highlighted && (
          <span className="shrink-0 text-[10px] bg-emerald-900/70 text-emerald-300 px-1.5 py-0.5 rounded-full">
            Último local
          </span>
        )}
      </div>
      {store.address && (
        <p className="text-sm text-zinc-400 mt-0.5 truncate" title={store.address}>
          {store.address}
        </p>
      )}
    </button>
  )
}

export default function StorePickerScreen({ stores, intent, preferredStoreId, onSelect, onLogout }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingStore, setPendingStore] = useState<StoreRow | null>(null)

  const isCashierMode = intent === 'cashier'
  const preferred = preferredStoreId ? stores.find(s => s.id === preferredStoreId) : undefined

  async function commitSelect(storeId: string) {
    setError(null)
    setLoading(true)
    setPendingStore(null)
    try {
      await onSelect(storeId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al seleccionar el local.')
      setLoading(false)
    }
  }

  function handleSelect(storeId: string) {
    if (preferred && storeId !== preferred.id) {
      const next = stores.find(s => s.id === storeId)
      if (next) setPendingStore(next)
      return
    }
    void commitSelect(storeId)
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
            <StoreButton
              key={store.id}
              store={store}
              loading={loading}
              highlighted={store.id === preferred?.id}
              onSelect={handleSelect}
            />
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

      {pendingStore && preferred && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
          <div className="bg-zinc-800 rounded-2xl border border-zinc-700 w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-semibold text-white">¿Confirmás este local?</h2>
            <p className="text-sm text-zinc-300">
              El último local que usaste en esta PC fue{' '}
              <span className="font-medium text-white" title={preferred.name}>{preferred.name}</span>
              . Estás eligiendo{' '}
              <span className="font-medium text-white" title={pendingStore.name}>{pendingStore.name}</span>.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setPendingStore(null)}
                className="flex-1 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void commitSelect(pendingStore.id)}
                className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold transition-colors"
              >
                Sí, continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
