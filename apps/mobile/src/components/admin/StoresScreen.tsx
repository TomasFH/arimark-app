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
  LabeledInput,
} from './shared'
import {
  fetchAllStores,
  createStore,
  updateStore,
  archiveStore,
  restoreStore,
  formatDate,
  type StoreDoc,
} from '../../lib/adminFirestore'

interface Props {
  onBack: () => void
}

export function StoresScreen({ onBack }: Props) {
  const online = useOnlineStatus()
  const [stores, setStores] = useState<StoreDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [selected, setSelected] = useState<StoreDoc | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchAllStores()
      setStores(list)
    } catch {
      setError('No se pudieron cargar los locales.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const displayed = stores.filter(s => showArchived || !s.archivedAt)

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <ScreenHeader
        title="Locales"
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
            aria-label="Nuevo local"
          >
            +
          </button>
        }
      />

      {!online && <OfflineBanner />}

      <div className="border-b border-zinc-800 px-4 py-2">
        <button
          type="button"
          onClick={() => setShowArchived(p => !p)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            showArchived ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {showArchived ? 'Con archivados' : 'Activos'}
        </button>
      </div>

      <main className="flex-1 px-4 py-4">
        {error && <ErrorBanner message={error} onRetry={load} />}
        {loading && <Spinner />}
        {!loading && !error && displayed.length === 0 && (
          <EmptyState message="No hay locales." />
        )}
        {!loading && !error && displayed.length > 0 && (
          <ul className="space-y-2">
            {displayed.map(store => (
              <li key={store.id}>
                <button
                  type="button"
                  onClick={() => setSelected(store)}
                  className={`w-full rounded-xl border px-4 py-3 text-left hover:border-zinc-700 transition-colors ${
                    store.archivedAt
                      ? 'border-zinc-800/50 bg-zinc-900/50 opacity-60'
                      : 'border-zinc-800 bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="min-w-0 flex-1 truncate font-medium text-zinc-100"
                      title={store.name}
                    >
                      {store.name}
                    </span>
                    {store.archivedAt && (
                      <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
                        Archivado
                      </span>
                    )}
                  </div>
                  {store.address && (
                    <p
                      className="mt-0.5 truncate text-xs text-zinc-500"
                      title={store.address}
                    >
                      {store.address}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-zinc-600">
                    {store.archivedAt
                      ? `Archivado el ${formatDate(store.archivedAt)}`
                      : `Creado el ${formatDate(store.createdAt)}`}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {selected && (
        <StoreDetailModal
          store={selected}
          onClose={() => setSelected(null)}
          onUpdated={updated => {
            setStores(prev => prev.map(s => s.id === updated.id ? updated : s))
            setSelected(updated)
          }}
          onRefresh={load}
        />
      )}

      {showCreate && (
        <CreateStoreModal
          onClose={() => setShowCreate(false)}
          onCreate={async () => {
            setShowCreate(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Store detail modal
// ---------------------------------------------------------------------------

interface StoreDetailModalProps {
  store: StoreDoc
  onClose: () => void
  onUpdated: (s: StoreDoc) => void
  onRefresh: () => void
}

function StoreDetailModal({ store, onClose, onUpdated, onRefresh }: StoreDetailModalProps) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(store.name)
  const [editAddress, setEditAddress] = useState(store.address ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!editName.trim()) return
    setSaving(true)
    await updateStore(store.id, {
      name: editName.trim(),
      address: editAddress.trim() || null,
    })
    const updated = { ...store, name: editName.trim(), address: editAddress.trim() || null }
    onUpdated(updated)
    onRefresh()
    setEditing(false)
    setSaving(false)
  }

  const handleArchive = async () => {
    if (!confirm(`¿${store.archivedAt ? 'Restaurar' : 'Archivar'} ${store.name}?`)) return
    if (store.archivedAt) {
      await restoreStore(store.id)
      onUpdated({ ...store, archivedAt: null })
    } else {
      await archiveStore(store.id)
      const now = new Date().toISOString()
      onUpdated({ ...store, archivedAt: now })
    }
    onRefresh()
  }

  return (
    <Modal title={store.name} onClose={onClose}>
      <div className="space-y-4">
        {editing ? (
          <div className="space-y-2">
            <LabeledInput
              label="Nombre"
              value={editName}
              onChange={setEditName}
              maxLength={100}
            />
            <LabeledInput
              label="Dirección"
              value={editAddress}
              onChange={setEditAddress}
              placeholder="Calle 123, Ciudad"
              maxLength={200}
            />
            <div className="flex gap-2">
              <Btn className="flex-1" onClick={handleSave} loading={saving}>
                Guardar
              </Btn>
              <Btn
                variant="ghost"
                className="flex-1"
                onClick={() => {
                  setEditing(false)
                  setEditName(store.name)
                  setEditAddress(store.address ?? '')
                }}
              >
                Cancelar
              </Btn>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm">
            <p className="font-medium text-zinc-100" title={store.name}>
              {store.name}
            </p>
            {store.address && (
              <p className="mt-1 text-zinc-400" title={store.address}>
                {store.address}
              </p>
            )}
            <p className="mt-1 text-zinc-600">
              Creado: {formatDate(store.createdAt)}
            </p>
            {store.archivedAt && (
              <p className="text-zinc-600">
                Archivado: {formatDate(store.archivedAt)}
              </p>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-2 text-sm text-zinc-500 underline"
            >
              Editar datos
            </button>
          </div>
        )}

        <Btn
          variant={store.archivedAt ? 'ghost' : 'danger'}
          className="w-full"
          onClick={handleArchive}
        >
          {store.archivedAt ? 'Restaurar local' : 'Archivar local'}
        </Btn>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Create store modal
// ---------------------------------------------------------------------------

interface CreateStoreModalProps {
  onClose: () => void
  onCreate: () => Promise<void>
}

function CreateStoreModal({ onClose, onCreate }: CreateStoreModalProps) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setErr('El nombre es obligatorio.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await createStore(name.trim(), address.trim() || null)
      await onCreate()
    } catch {
      setErr('No se pudo crear el local.')
      setSaving(false)
    }
  }

  return (
    <Modal title="Nuevo local" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <LabeledInput
          label="Nombre *"
          value={name}
          onChange={setName}
          placeholder="Nombre del local"
          maxLength={100}
          required
        />
        <LabeledInput
          label="Dirección"
          value={address}
          onChange={setAddress}
          placeholder="Calle 123, Ciudad (opcional)"
          maxLength={200}
        />
        {err && <p className="text-sm text-red-400/80">{err}</p>}
        <div className="flex gap-2">
          <Btn variant="ghost" className="flex-1" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn type="submit" className="flex-1" loading={saving}>
            Crear
          </Btn>
        </div>
      </form>
    </Modal>
  )
}
