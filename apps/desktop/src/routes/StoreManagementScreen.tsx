/**
 * Gestión de locales — solo admin.
 * Lista locales activos; al “eliminar”, borra si está vacío o soft-delete (archive)
 * si tiene datos. Los eliminados se muestran en una sección colapsable.
 */
import { useState, useEffect } from 'react'
import BackButton from '../components/BackButton'
import type { StoreRow } from '../types/hw-api'

interface Props {
  onBack: () => void
}

type ModalMode = 'create' | 'edit'

export default function StoreManagementScreen({ onBack }: Props) {
  const [stores, setStores] = useState<StoreRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)

  // Modal crear / editar
  const [modal, setModal] = useState<{ mode: ModalMode; store?: StoreRow } | null>(null)
  const [formName, setFormName] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [formMorningStart, setFormMorningStart] = useState('')
  const [formMorningEnd, setFormMorningEnd] = useState('')
  const [formAfternoonStart, setFormAfternoonStart] = useState('')
  const [formAfternoonEnd, setFormAfternoonEnd] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Feedback de guardado exitoso (solo para edición, no para creación)
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null)

  // Confirmación de eliminación
  const [deleteTarget, setDeleteTarget] = useState<StoreRow | null>(null)
  const [actioning, setActioning] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const activeStores = stores.filter(s => !s.archivedAt)
  const deletedStores = stores.filter(s => s.archivedAt)

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
    setFormMorningStart('')
    setFormMorningEnd('')
    setFormAfternoonStart('')
    setFormAfternoonEnd('')
    setSaveError(null)
    setModal({ mode: 'create' })
  }

  function openEdit(store: StoreRow) {
    setFormName(store.name)
    setFormAddress(store.address ?? '')
    setFormMorningStart(store.morningStart ?? '')
    setFormMorningEnd(store.morningEnd ?? '')
    setFormAfternoonStart(store.afternoonStart ?? '')
    setFormAfternoonEnd(store.afternoonEnd ?? '')
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
        morningStart: formMorningStart.trim() || null,
        morningEnd: formMorningEnd.trim() || null,
        afternoonStart: formAfternoonStart.trim() || null,
        afternoonEnd: formAfternoonEnd.trim() || null,
      })
      setSaving(false)
      if (!r.ok) { setSaveError(r.error); return }
      setStores(prev => prev.map(s => s.id === r.data.id ? { ...r.data, archivedAt: s.archivedAt } : s))
      setModal(null)
      setSaveSuccessMsg('Cambios guardados')
      setTimeout(() => setSaveSuccessMsg(null), 2500)
      return
    }

    setModal(null)
  }

  function openDeleteConfirm(store: StoreRow) {
    setActionError(null)
    setDeleteTarget(store)
  }

  /** Intenta borrar; si el local tiene datos, lo soft-deletea sin preguntar. */
  async function handleDelete() {
    if (!deleteTarget) return
    setActioning(true)
    setActionError(null)
    const r = await window.hw.deleteStore({ id: deleteTarget.id })

    if (r.ok) {
      setStores(prev => prev.filter(s => s.id !== deleteTarget.id))
      setDeleteTarget(null)
      setActioning(false)
      return
    }

    if ((r as { code?: string }).code === 'STORE_HAS_DATA') {
      const ar = await window.hw.archiveStore({ id: deleteTarget.id })
      setActioning(false)
      if (!ar.ok) { setActionError(ar.error); return }
      setStores(prev => prev.map(s => s.id === ar.data.id ? ar.data : s))
      setDeleteTarget(null)
      return
    }

    setActioning(false)
    setActionError(r.error)
  }

  async function handleRestore(store: StoreRow) {
    const r = await window.hw.unarchiveStore({ id: store.id })
    if (!r.ok) { setError(r.error); return }
    setStores(prev => prev.map(s => s.id === r.data.id ? r.data : s))
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/50 px-6 py-3 shrink-0">
        <BackButton onClick={onBack} />
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold text-zinc-100 truncate">Gestión de locales</h1>
          <p className="text-[10px] text-zinc-500">Locales registrados en el sistema</p>
        </div>
        <button
          onClick={openCreate}
          className="shrink-0 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold transition-colors"
        >
          + Nuevo local
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-4">

        {loading && <p className="text-zinc-500 text-sm animate-pulse">Cargando…</p>}
        {error && <p className="text-red-400/80 text-sm">{error}</p>}

        {saveSuccessMsg && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-emerald-900/50 bg-emerald-950/30 text-emerald-400/80 text-sm">
            <span>✓</span>
            {saveSuccessMsg}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Locales activos */}
            <div className="space-y-2">
              {activeStores.length === 0 && (
                <p className="text-zinc-500 text-sm text-center py-8">No hay locales activos.</p>
              )}
              {activeStores.map(store => (
                <div
                  key={store.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 flex items-center gap-3 min-w-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-white truncate" title={store.name}>{store.name}</p>
                    {store.address && (
                      <p className="text-sm text-zinc-400 truncate" title={store.address}>
                        {store.address}
                      </p>
                    )}
                    {(store.morningStart || store.afternoonStart) && (
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {store.morningStart && store.morningEnd
                          ? `Mañana: ${store.morningStart}–${store.morningEnd}`
                          : ''}
                        {store.morningStart && store.afternoonStart ? ' · ' : ''}
                        {store.afternoonStart && store.afternoonEnd
                          ? `Tarde: ${store.afternoonStart}–${store.afternoonEnd}`
                          : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openEdit(store)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => openDeleteConfirm(store)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-500 hover:bg-red-950/30 hover:text-red-400/80 hover:border-red-900/50 transition-colors"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Sección de eliminados (soft-delete / archive interno) */}
            {deletedStores.length > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setShowDeleted(v => !v)}
                  className="flex items-center gap-2 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  <span>{showDeleted ? '▾' : '▸'}</span>
                  <span>Locales eliminados ({deletedStores.length})</span>
                </button>

                {showDeleted && (
                  <div className="space-y-2">
                    {deletedStores.map(store => (
                      <div
                        key={store.id}
                        className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl px-5 py-4 flex items-center gap-3 min-w-0 opacity-60"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="font-medium text-zinc-400 truncate" title={store.name}>{store.name}</p>
                            <span className="shrink-0 text-[10px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded-full">Eliminado</span>
                          </div>
                          {store.address && (
                            <p className="text-sm text-zinc-500 truncate" title={store.address}>
                              {store.address}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => openEdit(store)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => void handleRestore(store)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                          >
                            Restaurar
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
      </div>

      {/* Modal crear / editar */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto animate-modal-enter">
            <h2 className="text-base font-semibold">
              {modal.mode === 'create' ? 'Nuevo local' : `Editar "${modal.store?.name}"`}
            </h2>

            <form onSubmit={e => void handleSave(e)} className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm text-zinc-400">Nombre del local *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  maxLength={100}
                  placeholder="Ej: Local Centro"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm text-zinc-400">Dirección (opcional)</label>
                <input
                  type="text"
                  value={formAddress}
                  onChange={e => setFormAddress(e.target.value)}
                  maxLength={200}
                  placeholder="Ej: Av. Corrientes 1234"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                />
              </div>

              {/* Horarios de turno — solo en modo edición */}
              {modal.mode === 'edit' && (
                <div className="space-y-3 border-t border-zinc-700 pt-3">
                  <p className="text-sm font-medium text-zinc-300">Horarios de turno (opcional)</p>
                  <p className="text-xs text-zinc-500">Si se configuran, la app sugerirá el turno automáticamente al abrir.</p>

                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400">Turno Mañana</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={formMorningStart}
                        onChange={e => setFormMorningStart(e.target.value)}
                        placeholder="HH:MM"
                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 text-sm"
                      />
                      <span className="text-zinc-500 shrink-0 text-xs">hasta</span>
                      <input
                        type="time"
                        value={formMorningEnd}
                        onChange={e => setFormMorningEnd(e.target.value)}
                        placeholder="HH:MM"
                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400">Turno Tarde</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={formAfternoonStart}
                        onChange={e => setFormAfternoonStart(e.target.value)}
                        placeholder="HH:MM"
                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 text-sm"
                      />
                      <span className="text-zinc-500 shrink-0 text-xs">hasta</span>
                      <input
                        type="time"
                        value={formAfternoonEnd}
                        onChange={e => setFormAfternoonEnd(e.target.value)}
                        placeholder="HH:MM"
                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}

              {saveError && <p className="text-red-400 text-sm">{saveError}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  disabled={saving}
                  className="flex-1 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
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
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-semibold text-white min-w-0">
              ¿Eliminar{' '}
              <span className="truncate inline-block max-w-full align-bottom" title={deleteTarget.name}>
                "{deleteTarget.name}"
              </span>
              ?
            </h2>
            {actionError && (
              <p className="text-red-400/80 text-sm bg-red-950/30 border border-red-900/40 rounded-lg p-3">{actionError}</p>
            )}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={actioning}
                className="flex-1 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={actioning}
                className="flex-1 py-2 rounded-xl bg-red-900/60 hover:bg-red-900/80 border border-red-900/50 text-red-400/90 font-semibold text-white transition-colors disabled:opacity-40"
              >
                {actioning ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
