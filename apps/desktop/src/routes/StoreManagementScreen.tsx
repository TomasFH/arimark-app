/**
 * Gestión de locales — solo admin.
 * Lista los locales existentes y permite crear, editar y eliminar.
 * La eliminación está bloqueada si el local tiene datos asociados
 * (turnos, pedidos, productos).
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

  // Modal crear / editar
  const [modal, setModal] = useState<{ mode: ModalMode; store?: StoreRow } | null>(null)
  const [formName, setFormName] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Confirmación de eliminación
  const [deleteTarget, setDeleteTarget] = useState<StoreRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    void window.hw.getStores().then(r => {
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
      setStores(prev => prev.map(s => s.id === r.data.id ? r.data : s))
    }

    setModal(null)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    const r = await window.hw.deleteStore({ id: deleteTarget.id })
    setDeleting(false)
    if (!r.ok) { setDeleteError(r.error); return }
    setStores(prev => prev.filter(s => s.id !== deleteTarget.id))
    setDeleteTarget(null)
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

        {/* Lista */}
        {loading && <p className="text-gray-500 text-sm animate-pulse">Cargando…</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {!loading && !error && (
          <div className="space-y-2">
            {stores.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-8">No hay locales registrados.</p>
            )}
            {stores.map(store => (
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
                    onClick={() => { setDeleteError(null); setDeleteTarget(store) }}
                    className="px-3 py-1.5 text-xs rounded-lg border border-red-800/60 text-red-400 hover:bg-red-900/20 hover:text-red-300 transition-colors"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
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

      {/* Modal confirmar eliminación */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl border border-red-900/40 w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-semibold text-white">¿Eliminar "{deleteTarget.name}"?</h2>
            <p className="text-sm text-gray-400">
              Esta acción es permanente. Solo se permite si el local no tiene turnos,
              pedidos ni productos configurados.
            </p>

            {deleteError && (
              <p className="text-red-400 text-sm bg-red-900/20 rounded-lg p-3">{deleteError}</p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 py-2 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="flex-1 py-2 rounded-xl bg-red-700 hover:bg-red-600 font-semibold text-white transition-colors disabled:opacity-40"
              >
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
