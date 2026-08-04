import { useState, useEffect, useCallback } from 'react'
import { useOnlineStatus } from '../../lib/connectivity'
import {
  ScreenHeader,
  OfflineBanner,
  ErrorBanner,
  Spinner,
  EmptyState,
  Modal,
  Btn,
} from './shared'
import {
  fetchCashierUsers,
  updateUserActive,
  updateUserAuthorizedStores,
  type AdminUser,
  type StoreDoc,
} from '../../lib/adminFirestore'

interface Props {
  onBack: () => void
  stores: StoreDoc[]
}

export function CashiersScreen({ onBack, stores }: Props) {
  const online = useOnlineStatus()
  const [cashiers, setCashiers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AdminUser | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchCashierUsers()
      setCashiers(list)
    } catch {
      setError('No se pudieron cargar las cajeras.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const storeMap = new Map(stores.map(s => [s.id, s.name]))

  const handleToggleActive = async (cashier: AdminUser) => {
    const newActive = !cashier.active
    try {
      await updateUserActive(cashier.uid, newActive)
      const updated = { ...cashier, active: newActive }
      setCashiers(prev => prev.map(c => c.uid === cashier.uid ? updated : c))
      if (selected?.uid === cashier.uid) setSelected(updated)
    } catch {
      setError('No se pudo actualizar el estado.')
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <ScreenHeader title="Cajeras" onBack={onBack} />

      {!online && <OfflineBanner />}

      {/* Info banner */}
      <div className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-2.5">
        <p className="text-xs text-zinc-500">
          Alta de cajeras solo desde la app de escritorio.
          Aquí podés ver, activar/desactivar y editar locales autorizados.
        </p>
      </div>

      <main className="flex-1 px-4 py-4">
        {error && <ErrorBanner message={error} onRetry={load} />}
        {loading && <Spinner />}
        {!loading && !error && cashiers.length === 0 && (
          <EmptyState message="No hay cajeras registradas." />
        )}
        {!loading && !error && cashiers.length > 0 && (
          <ul className="space-y-2">
            {cashiers.map(cashier => {
              const storeNames = cashier.authorizedStores
                .map(id => storeMap.get(id) ?? id)
                .join(', ')
              return (
                <li key={cashier.uid}>
                  <button
                    type="button"
                    onClick={() => setSelected(cashier)}
                    className={`w-full rounded-xl border px-4 py-3 text-left hover:border-zinc-700 transition-colors ${
                      cashier.active
                        ? 'border-zinc-800 bg-zinc-900'
                        : 'border-zinc-800/50 bg-zinc-900/50 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="min-w-0 flex-1 truncate font-medium text-zinc-100"
                        title={cashier.displayName}
                      >
                        {cashier.displayName || cashier.email}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                          cashier.active
                            ? 'bg-emerald-950/50 text-emerald-400/70 border border-emerald-900/40'
                            : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                        }`}
                      >
                        {cashier.active ? 'Activa' : 'Inactiva'}
                      </span>
                    </div>
                    <p
                      className="mt-0.5 truncate text-xs text-zinc-500"
                      title={cashier.email}
                    >
                      {cashier.email}
                    </p>
                    {storeNames && (
                      <p
                        className="mt-0.5 truncate text-xs text-zinc-500"
                        title={storeNames}
                      >
                        {storeNames}
                      </p>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {selected && (
        <CashierDetailModal
          cashier={selected}
          stores={stores}
          storeMap={storeMap}
          onClose={() => setSelected(null)}
          onToggleActive={handleToggleActive}
          onStoresUpdated={updatedStores => {
            const updated = { ...selected, authorizedStores: updatedStores }
            setCashiers(prev => prev.map(c => c.uid === selected.uid ? updated : c))
            setSelected(updated)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cashier detail modal
// ---------------------------------------------------------------------------

interface CashierDetailModalProps {
  cashier: AdminUser
  stores: StoreDoc[]
  storeMap: Map<string, string>
  onClose: () => void
  onToggleActive: (c: AdminUser) => Promise<void>
  onStoresUpdated: (stores: string[]) => void
}

function CashierDetailModal({
  cashier,
  stores,
  storeMap,
  onClose,
  onToggleActive,
  onStoresUpdated,
}: CashierDetailModalProps) {
  const activeStores = stores.filter(s => !s.archivedAt)
  const [editingStores, setEditingStores] = useState(false)
  const [selectedStores, setSelectedStores] = useState<string[]>(cashier.authorizedStores)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)

  const toggleStore = (storeId: string) => {
    setSelectedStores(prev =>
      prev.includes(storeId) ? prev.filter(id => id !== storeId) : [...prev, storeId],
    )
  }

  const handleSaveStores = async () => {
    setSaving(true)
    try {
      await updateUserAuthorizedStores(cashier.uid, selectedStores)
      onStoresUpdated(selectedStores)
      setEditingStores(false)
    } catch {
      // keep editing open on error
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async () => {
    setToggling(true)
    await onToggleActive(cashier)
    setToggling(false)
  }

  return (
    <Modal title={cashier.displayName || cashier.email} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm">
          <p className="text-zinc-400">
            Email: <span className="text-zinc-200" title={cashier.email}>{cashier.email}</span>
          </p>
          <p className="mt-1 text-zinc-400">
            Estado:{' '}
            <span className={cashier.active ? 'text-emerald-400' : 'text-zinc-500'}>
              {cashier.active ? 'Activa' : 'Inactiva'}
            </span>
          </p>
        </div>

        {/* Authorized stores */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">
              Locales autorizados
            </p>
            {!editingStores && (
              <button
                type="button"
                onClick={() => setEditingStores(true)}
                className="text-xs text-zinc-500 underline"
              >
                Editar
              </button>
            )}
          </div>

          {editingStores ? (
            <div className="space-y-2">
              {activeStores.map(s => (
                <label
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedStores.includes(s.id)}
                    onChange={() => toggleStore(s.id)}
                    className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="flex-1 truncate text-sm text-zinc-200" title={s.name}>
                    {s.name}
                  </span>
                </label>
              ))}
              <div className="flex gap-2 mt-1">
                <Btn
                  variant="ghost"
                  className="flex-1"
                  onClick={() => {
                    setEditingStores(false)
                    setSelectedStores(cashier.authorizedStores)
                  }}
                >
                  Cancelar
                </Btn>
                <Btn className="flex-1" loading={saving} onClick={handleSaveStores}>
                  Guardar
                </Btn>
              </div>
            </div>
          ) : cashier.authorizedStores.length === 0 ? (
            <p className="text-sm text-zinc-500">Sin locales asignados.</p>
          ) : (
            <ul className="space-y-1">
              {cashier.authorizedStores.map(id => (
                <li key={id} className="text-sm text-zinc-300">
                  {storeMap.get(id) ?? id}
                </li>
              ))}
            </ul>
          )}
        </div>

        <Btn
          className="w-full"
          variant={cashier.active ? 'danger' : 'primary'}
          loading={toggling}
          onClick={handleToggle}
        >
          {cashier.active ? 'Desactivar cajera' : 'Activar cajera'}
        </Btn>
      </div>
    </Modal>
  )
}
