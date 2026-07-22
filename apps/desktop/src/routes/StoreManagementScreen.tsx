/**
 * Gestión de locales — solo admin.
 * Lista los locales activos con opciones de crear, editar, archivar y eliminar.
 * Los locales con datos se archivan (soft-delete); solo los vacíos se eliminan.
 * Los archivados se muestran en una sección colapsable al final.
 */
import { useState, useEffect } from 'react'
import type { StoreRow } from '../types/hw-api'

interface Props {
  onBack: () => void
}

type ModalMode = 'create' | 'edit'

export default function StoreManagementScreen({ onBack }: Props) {
  const [stores, setStores] = useState<StoreRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  // Modal crear / editar
  const [modal, setModal] = useState<{ mode: ModalMode; store?: StoreRow } | null>(null)
  const [formName, setFormName] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Confirmación de eliminación / archivo
  const [deleteTarget, setDeleteTarget] = useState<StoreRow | null>(null)
  const [deleteState, setDeleteState] = useState<'confirm' | 'archive-offer'>('confirm')
  const [actioning, setActioning] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const activeStores = stores.filter(s => !s.archivedAt)
  const archivedStores = stores.filter(s => s.archivedAt)

  useEffect(() => {
    void window.hw.getStores({ includeArchived: true }).then(r => {
      if (r.ok) setStores(r.data)
      else setError(r.error)
      setLoading(false)
    })
  }, [])

  function openCreate() {
    setFormName('')
    setFormAddress('')
    setSaveError(null)
    setModal({ mode: 'create' })
  }

  function openEdit(store: StoreRow) {
    setFormName(store.name)
    setFormAddress(store.address ?? '')
    setSaveError(null)
    setModal({ mode: 'edit', store })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const name = formName.trim()
    if (!name) { setSaveError('El nombre del local es obligatorio.'); return }

    setSaving(true)
    setSaveError(null)

    if (modal?.mode === 'create') {
      const r = await window.hw.createStore({ name, address: formAddress.trim() || undefined })
      setSaving(false)
      if (!r.ok) { setSaveError(r.error); return }
      setStores(prev => [...prev, r.data])
    } else if (modal?.mode === 'edit' && modal.store) {
      const r = await window.hw.updateStore({
        id: modal.store.id,
        name,
        address: formAddress.trim() || null,
      })
      setSaving(false)
      if (!r.ok) { setSaveError(r.error); return }
      setStores(prev => prev.map(s => s.id === r.data.id ? { ...r.data, archivedAt: s.archivedAt } : s))
    }

    setModal(null)
  }

  function openDeleteConfirm(store: StoreRow) {
    setActionError(null)
    setDeleteState('confirm')
    setDeleteTarget(store)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setActioning(true)
    setActionError(null)
    const r = await window.hw.deleteStore({ id: deleteTarget.id })
    setActioning(false)

    if (r.ok) {
      setStores(prev => prev.filter(s => s.id !== deleteTarget.id))
      setDeleteTarget(null)
      return
    }

    // Si el motivo es que tiene datos, ofrecer archivar en su lugar
    if ((r as { code?: string }).code === 'STORE_HAS_DATA') {
      setDeleteState('archive-offer')
    } else {
      setActionError(r.error)
    }
  }

  async function handleArchive() {
    if (!deleteTarget) return
    setActioning(true)
    setActionError(null)
    const r = await window.hw.archiveStore({ id: deleteTarget.id })
    setActioning(false)

    if (!r.ok) { setActionError(r.error); return }
    setStores(prev => prev.map(s => s.id === r.data.id ? r.data : s))
    setDeleteTarget(null)
  }

  async function handleUnarchive(store: StoreRow) {
    const r = await window.hw.unarchiveStore({ id: store.id })
    if (!r.ok) { setError(r.error); return }
    setStores(prev => prev.map(s => s.id === r.data.id ? r.data : s))
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white transition-colors text-xl shrink-0"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold truncate">Gestión de locales</h1>
            <p className="text-sm text-gray-400">Locales registrados en el sistema</p>
          </div>
          <button
            onClick={openCreate}
            className="shrink-0 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-sm font-semibold transition-colors"
          >
            + Nuevo local
          </button>
        </div>

        {loading && <p className="text-gray-500 text-sm animate-pulse">Cargando…</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {!loading && !error && (
          <>
            {/* Locales activos */}
            <div className="space-y-2">
              {activeStores.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-8">No hay locales activos.</p>
              )}
              {activeStores.map(store => (
                <div
                  key={store.id}
                  className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 flex items-center gap-3 min-w-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-white truncate" title={store.name}>{store.name}</p>
                    {store.address && (
                      <p className="text-sm text-gray-400 truncate" title={store.address}>
                        {store.address}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openEdit(store)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => openDeleteConfirm(store)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-red-800/60 text-red-400 hover:bg-red-900/20 hover:text-red-300 transition-colors"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Sección de archivados */}
            {archivedStores.length > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setShowArchived(v => !v)}
                  className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <span>{showArchived ? '▾' : '▸'}</span>
                  <span>Locales archivados ({archivedStores.length})</span>
                </button>

                {showArchived && (
                  <div className="space-y-2">
                    {archivedStores.map(store => (
                      <div
                        key={store.id}
                        className="bg-gray-900/50 border border-gray-800/50 rounded-xl px-5 py-4 flex items-center gap-3 min-w-0 opacity-70"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="font-medium text-gray-400 truncate" title={store.name}>{store.name}</p>
                            <span className="shrink-0 text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">Archivado</span>
                          </div>
                          {store.address && (
                            <p className="text-sm text-gray-500 truncate" title={store.address}>
                              {store.address}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => openEdit(store)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => void handleUnarchive(store)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-green-800/60 text-green-400 hover:bg-green-900/20 transition-colors"
                          >
                            Desarchivar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal crear / editar */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl border border-gray-800 w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-semibold">
              {modal.mode === 'create' ? 'Nuevo local' : `Editar "${modal.store?.name}"`}
            </h2>

            <form onSubmit={e => void handleSave(e)} className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm text-gray-400">Nombre del local *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  maxLength={100}
                  placeholder="Ej: Local Centro"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm text-gray-400">Dirección (opcional)</label>
                <input
                  type="text"
                  value={formAddress}
                  onChange={e => setFormAddress(e.target.value)}
                  maxLength={200}
                  placeholder="Ej: Av. Corrientes 1234"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {saveError && <p className="text-red-400 text-sm">{saveError}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  disabled={saving}
                  className="flex-1 py-2 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !formName.trim()}
                  className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 font-semibold transition-colors disabled:opacity-40"
                >
                  {saving ? 'Guardando…' : modal.mode === 'create' ? 'Crear local' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal confirmar eliminación / ofrecer archivo */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl border border-gray-800 w-full max-w-sm p-6 space-y-4">
            {deleteState === 'confirm' ? (
              <>
                <h2 className="text-base font-semibold text-white">¿Eliminar "{deleteTarget.name}"?</h2>
                <p className="text-sm text-gray-400">
                  Si el local no tiene datos, se eliminará definitivamente.
                  Si tiene turnos, pedidos o productos, se ofrecerá archivarlo.
                </p>
                {actionError && (
                  <p className="text-red-400 text-sm bg-red-900/20 rounded-lg p-3">{actionError}</p>
                )}
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setDeleteTarget(null)}
                    disabled={actioning}
                    className="flex-1 py-2 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => void handleDelete()}
                    disabled={actioning}
                    className="flex-1 py-2 rounded-xl bg-red-700 hover:bg-red-600 font-semibold text-white transition-colors disabled:opacity-40"
                  >
                    {actioning ? 'Procesando…' : 'Eliminar'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <span className="text-yellow-400 text-xl shrink-0">⚠</span>
                  <div>
                    <h2 className="text-base font-semibold text-white">No se puede eliminar</h2>
                    <p className="text-sm text-gray-400 mt-1">
                      "{deleteTarget.name}" tiene datos registrados (turnos, ventas o pedidos).
                      Eliminarlo borraria el historial.
                    </p>
                    <p className="text-sm text-gray-300 mt-2 font-medium">
                      ¿Querés archivarlo en su lugar?
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      El local quedará oculto de las operaciones del día a día pero su historial se conservará.
                    </p>
                  </div>
                </div>
                {actionError && (
                  <p className="text-red-400 text-sm bg-red-900/20 rounded-lg p-3">{actionError}</p>
                )}
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setDeleteTarget(null)}
                    disabled={actioning}
                    className="flex-1 py-2 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => void handleArchive()}
                    disabled={actioning}
                    className="flex-1 py-2 rounded-xl bg-amber-700 hover:bg-amber-600 font-semibold text-white transition-colors disabled:opacity-40"
                  >
                    {actioning ? 'Archivando…' : 'Archivar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
