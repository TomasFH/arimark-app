/**
 * Gestión de locales — solo admin.
 * Lista locales activos; al “eliminar”, archiva (soft-delete) para que Firestore
 * y el resto de dispositivos vean el mismo estado. Los eliminados se muestran
 * en una sección colapsable.
 */
import { useState, useEffect } from 'react'
import StoreHoursScheduleEditor from '../components/StoreHoursScheduleEditor'
import { Button, Modal } from '../components/ui'
import type { StoreRow } from '../types/hw-api'
import {
  editorScheduleFromStore,
  formatWeekScheduleSummary,
  hoursFieldsForSave,
  validateWeekSchedule,
  type StoreHoursBlock,
} from '@carniceria/shared'

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
  const [formSchedule, setFormSchedule] = useState<StoreHoursBlock[]>([])
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
    setFormSchedule(editorScheduleFromStore(null))
    setSaveError(null)
    setModal({ mode: 'create' })
  }

  function openEdit(store: StoreRow) {
    setFormName(store.name)
    setFormAddress(store.address ?? '')
    setFormSchedule(editorScheduleFromStore(store))
    setSaveError(null)
    setModal({ mode: 'edit', store })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const name = formName.trim()
    if (!name) { setSaveError('El nombre del local es obligatorio.'); return }

    setSaving(true)
    setSaveError(null)

    const hoursError = validateWeekSchedule(formSchedule)
    if (hoursError) {
      setSaving(false)
      setSaveError(hoursError)
      return
    }
    const hours = hoursFieldsForSave(formSchedule)

    if (modal?.mode === 'create') {
      const r = await window.hw.createStore({
        name,
        address: formAddress.trim() || undefined,
        ...hours,
      })
      setSaving(false)
      if (!r.ok) { setSaveError(r.error); return }
      setStores(prev => [...prev, r.data])
    } else if (modal?.mode === 'edit' && modal.store) {
      const r = await window.hw.updateStore({
        id: modal.store.id,
        name,
        address: formAddress.trim() || null,
        ...hours,
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

  /** Soft-delete (archivar). El hard-delete local sin Firestore reaparece al sincronizar. */
  async function handleDelete() {
    if (!deleteTarget) return
    setActioning(true)
    setActionError(null)
    const ar = await window.hw.archiveStore({ id: deleteTarget.id })
    setActioning(false)
    if (!ar.ok) { setActionError(ar.error); return }
    setStores(prev => prev.map(s => s.id === ar.data.id ? ar.data : s))
    setDeleteTarget(null)
  }

  async function handleRestore(store: StoreRow) {
    const r = await window.hw.unarchiveStore({ id: store.id })
    if (!r.ok) { setError(r.error); return }
    setStores(prev => prev.map(s => s.id === r.data.id ? r.data : s))
  }

  const listed = showDeleted ? deletedStores : activeStores

  return (
    <>
    <Modal
      open
      onClose={onBack}
      size="lg"
      frame="hug"
      header={(
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-ink">Locales</h2>
            <p className="truncate text-xs text-muted">Nombre, dirección y horario</p>
          </div>
          {!showDeleted && (
            <Button type="button" size="sm" onClick={openCreate}>+ Nuevo</Button>
          )}
          <Button variant="ghost" size="sm" onClick={onBack} aria-label="Cerrar locales">Cerrar</Button>
        </div>
      )}
    >
        <div className="mb-4 grid grid-cols-2 rounded-xl bg-app p-1" role="tablist" aria-label="Estado de los locales">
          <button
            type="button"
            role="tab"
            aria-selected={!showDeleted}
            onClick={() => setShowDeleted(false)}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              !showDeleted ? 'bg-panel text-ink shadow-[0_1px_2px_rgba(28,28,30,0.12)]' : 'text-muted hover:text-ink'
            }`}
          >
            Activos
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showDeleted}
            onClick={() => setShowDeleted(true)}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              showDeleted ? 'bg-panel text-ink shadow-[0_1px_2px_rgba(28,28,30,0.12)]' : 'text-muted hover:text-ink'
            }`}
          >
            Eliminados
          </button>
        </div>

        {loading && <p className="text-sm text-muted">Cargando…</p>}
        {error && <p className="text-sm text-danger">{error}</p>}

        {saveSuccessMsg && (
          <p className="mb-3 text-sm text-success">{saveSuccessMsg}</p>
        )}

        {!loading && !error && (
          <>
            <div className="overflow-hidden rounded-2xl border border-line bg-panel">
              {listed.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-muted">
                  {showDeleted ? 'No hay locales eliminados.' : 'No hay locales activos.'}
                </p>
              )}
              {listed.map(store => (
                <div
                  key={store.id}
                  className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className={`font-medium truncate ${showDeleted ? 'text-muted' : 'text-ink'}`} title={store.name}>{store.name}</p>
                      {showDeleted && (
                        <span className="shrink-0 text-[10px] bg-raised text-muted px-1.5 py-0.5 rounded-full">Eliminado</span>
                      )}
                    </div>
                    {store.address && (
                      <p className="text-sm text-muted truncate" title={store.address}>
                        {store.address}
                      </p>
                    )}
                    {formatWeekScheduleSummary(store) && (
                      <p className="text-xs text-muted mt-0.5 truncate" title={formatWeekScheduleSummary(store)}>
                        {formatWeekScheduleSummary(store)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openEdit(store)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-line text-ink hover:bg-hover hover:text-ink transition-colors"
                    >
                      Editar
                    </button>
                    {showDeleted ? (
                      <button
                        onClick={() => void handleRestore(store)}
                        className="px-3 py-1.5 text-xs rounded-lg border border-line text-muted hover:bg-hover hover:text-ink transition-colors"
                      >
                        Restaurar
                      </button>
                    ) : (
                      <button
                        onClick={() => openDeleteConfirm(store)}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs text-danger transition-colors hover:bg-danger/10"
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
    </Modal>

      {/* Modal crear / editar */}
      {modal && (
        <Modal
          open
          onClose={() => { if (!saving) setModal(null) }}
          closeOnOverlay={!saving}
          closeOnEscape={!saving}
          size="lg"
          title={modal.mode === 'create' ? 'Nuevo local' : 'Editar local'}
          footer={(
            <>
              <Button type="button" variant="secondary" className="mr-auto" onClick={() => setModal(null)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" form="store-form" loading={saving} disabled={!formName.trim()}>
                {saving ? 'Guardando…' : modal.mode === 'create' ? 'Crear local' : 'Guardar'}
              </Button>
            </>
          )}
        >
            <form id="store-form" onSubmit={e => void handleSave(e)} className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm text-muted">Nombre del local *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  maxLength={100}
                  placeholder="Ej: Local Centro"
                  className="w-full bg-input border border-line-strong rounded-lg px-3 py-2 text-ink placeholder:text-muted focus:outline-none focus:border-line-accent"
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm text-muted">Dirección (opcional)</label>
                <input
                  type="text"
                  value={formAddress}
                  onChange={e => setFormAddress(e.target.value)}
                  maxLength={200}
                  placeholder="Ej: Av. Corrientes 1234"
                  className="w-full bg-input border border-line-strong rounded-lg px-3 py-2 text-ink placeholder:text-muted focus:outline-none focus:border-line-accent"
                />
              </div>

              <StoreHoursScheduleEditor schedule={formSchedule} onChange={setFormSchedule} />

              {saveError && <p className="text-sm text-danger">{saveError}</p>}
            </form>
        </Modal>
      )}

      {/* Modal confirmar eliminación */}
      {deleteTarget && (
        <Modal
          open
          onClose={() => { if (!actioning) setDeleteTarget(null) }}
          closeOnOverlay={!actioning}
          closeOnEscape={!actioning}
          size="sm"
          title="Eliminar local"
          footer={(
            <>
              <Button variant="secondary" className="mr-auto" onClick={() => setDeleteTarget(null)} disabled={actioning}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={() => void handleDelete()} loading={actioning}>
                {actioning ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </>
          )}
        >
            <p className="text-sm text-muted">
              ¿Eliminar{' '}
              <span className="font-medium text-ink" title={deleteTarget.name}>{deleteTarget.name}</span>
              ? Se puede restaurar desde Eliminados.
            </p>
            {actionError && <p className="mt-3 text-sm text-danger">{actionError}</p>}
        </Modal>
      )}
    </>
  )
}
