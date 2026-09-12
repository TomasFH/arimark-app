/**
 * Selector de local tras el login.
 * Se muestra cuando hay más de un local. Resalta el último usado en esta PC.
 * Elegir otro pide una confirmación extra (DT-04).
 */
import { useState } from 'react'
import type { StoreRow } from '../types/hw-api'
import { Button, Modal } from '../components/ui'

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
          ? 'bg-accent-soft border-line-accent hover:border-line-accent'
          : 'bg-panel border-line hover:border-line-accent hover:bg-accent-soft'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <p className="font-semibold text-ink min-w-0 flex-1 truncate" title={store.name}>
          {store.name}
        </p>
        {highlighted && (
          <span className="shrink-0 text-[10px] bg-accent-soft text-accent px-1.5 py-0.5 rounded-full border border-line-accent">
            Último local
          </span>
        )}
      </div>
      {store.address && (
        <p className="text-sm text-muted mt-0.5 truncate" title={store.address}>
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
    <div className="flex flex-1 items-center justify-center bg-app p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-ink">¿En qué local trabajás hoy?</h1>
          <p className="text-sm text-muted">
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
          <p className="text-sm text-danger bg-panel border border-danger rounded-lg p-3 text-center">{error}</p>
        )}

        {loading && (
          <p className="text-center text-sm text-muted animate-pulse">Conectando…</p>
        )}

        <button
          onClick={onLogout}
          disabled={loading}
          className="w-full text-sm text-muted hover:text-ink transition-colors disabled:opacity-40 pt-2"
        >
          {isCashierMode ? '← Volver al hub' : '← Volver al login'}
        </button>
      </div>

      <Modal
        open={pendingStore != null && preferred != null}
        onClose={() => setPendingStore(null)}
        title="¿Confirmás este local?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingStore(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (pendingStore) void commitSelect(pendingStore.id)
              }}
            >
              Sí, continuar
            </Button>
          </>
        }
      >
        {pendingStore && preferred && (
          <p className="text-sm text-muted">
            El último local que usaste en esta PC fue{' '}
            <span className="font-medium text-ink" title={preferred.name}>{preferred.name}</span>
            . Estás eligiendo{' '}
            <span className="font-medium text-ink" title={pendingStore.name}>{pendingStore.name}</span>.
          </p>
        )}
      </Modal>
    </div>
  )
}
