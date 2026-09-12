/**
 * Pantalla de gestión de cajeras (ABM) — solo admins.
 *
 * Flujo de creación:
 *  - El admin ingresa nombre y email. NO ingresa contraseña.
 *  - El sistema crea la cuenta y envía un email para que defina su contraseña.
 *  - Puede operar en todos los locales activos (no hay selector de “locales autorizados”).
 *
 * Edición: solo el nombre. Eliminación: soft-delete (deleted:true).
 */
import { useEffect, useState } from 'react'
import BackButton from '../components/BackButton'
import type { CashierRow, StoreRow } from '../types/hw-api'

interface Props {
  onBack?: () => void
  /** Sin chrome de página (sector dentro de Personal). */
  embedded?: boolean
  onCashierCreated?: () => void
}

export default function CashierManagementScreen({ onBack, embedded = false, onCashierCreated }: Props) {
  const [cashiers, setCashiers] = useState<CashierRow[]>([])
  const [stores, setStores] = useState<StoreRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<CashierRow | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CashierRow | null>(null)

  const activeStoreIds = stores.filter(s => !s.archivedAt).map(s => s.id)

  async function load() {
    setLoading(true)
    setError(null)
    const [cashiersR, storesR] = await Promise.all([
      window.hw.listCashiers(),
      window.hw.getStores(),
    ])
    if (cashiersR.ok) {
      setCashiers(cashiersR.data)
    } else {
      setError(cashiersR.error)
    }
    if (storesR.ok) {
      setStores(storesR.data.filter(s => !s.archivedAt))
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function handleToggle(cashier: CashierRow) {
    setToggling(cashier.uid)
    const r = await window.hw.toggleCashier({ uid: cashier.uid, active: !cashier.active })
    setToggling(null)
    if (r.ok) void load()
    else setError(r.error)
  }

  async function handleDelete(cashier: CashierRow) {
    const r = await window.hw.deleteCashier({ uid: cashier.uid })
    setConfirmDelete(null)
    if (r.ok) void load()
    else setError(r.error)
  }

  return (
    <div className={`flex flex-col ${embedded ? '' : 'h-screen'} bg-app text-ink`}>
      <header className="flex items-center gap-3 border-b border-line bg-panel/50 px-6 py-3 shrink-0">
        {!embedded && onBack && <BackButton onClick={onBack} />}
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold text-ink truncate">
            {embedded ? 'Cuentas' : 'Gestión de cajeras'}
          </h1>
          <p className="text-[10px] text-muted mt-0.5">
            {embedded ? 'Activar, desactivar y alta de login' : 'Cuentas, locales autorizados y estado'}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="shrink-0 bg-accent hover:bg-accent text-ink text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Nueva cajera
        </button>
      </header>

      {error && (
        <div className="mx-6 mt-3 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-400/90 space-y-1">
          <p className="font-medium">{error}</p>
          {error.includes('Firestore') && (
            <p className="text-xs text-red-400/70">
              Es necesario configurar las reglas de seguridad de Firestore para que los admins puedan leer y escribir la subcolección de usuarios.
            </p>
          )}
        </div>
      )}

      <div className={`${embedded ? '' : 'flex-1 overflow-auto'} px-6 py-4`}>
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-line-strong border-t-transparent rounded-full animate-spin" />
          </div>
        ) : cashiers.length === 0 && !error ? (
          <div className="text-center mt-16 space-y-2">
            <p className="text-muted text-sm">No hay cajeras registradas.</p>
            <p className="text-subtle text-xs">Creá la primera cajera con el botón de arriba.</p>
          </div>
        ) : cashiers.length === 0 && error ? null : (
          <div className="space-y-2">
            {cashiers.map(c => (
              <div
                key={c.uid}
                className={`flex items-center gap-3 min-w-0 rounded-xl border px-4 py-3 transition-colors ${c.active ? 'border-line bg-panel/50' : 'border-line bg-panel/20 opacity-60'}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate" title={c.displayName}>{c.displayName}</p>
                  <p className="text-xs text-muted mt-0.5 truncate" title={c.email}>{c.email}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.active ? 'bg-success/15 text-success' : 'bg-raised/80 text-muted'}`}>
                    {c.active ? 'Activa' : 'Inactiva'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium bg-raised hover:bg-hover text-ink transition-colors"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggle(c)}
                    disabled={toggling === c.uid}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium bg-raised hover:bg-hover text-ink transition-colors disabled:opacity-50"
                  >
                    {toggling === c.uid ? '…' : c.active ? 'Desactivar' : 'Reactivar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(c)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium bg-raised hover:bg-red-950/40 text-muted hover:text-red-400/80 transition-colors"
                    title="Eliminar cajera"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CashierFormModal
          mode="create"
          stores={stores}
          defaultStoreIds={activeStoreIds}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); void load(); onCashierCreated?.() }}
        />
      )}

      {editing && (
        <CashierFormModal
          mode="edit"
          cashier={editing}
          stores={stores}
          defaultStoreIds={activeStoreIds}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
        />
      )}

      {confirmDelete && (
        <DeleteConfirmModal
          cashier={confirmDelete}
          onConfirm={() => void handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal crear / editar cajera
// ---------------------------------------------------------------------------

interface CashierFormModalProps {
  mode: 'create' | 'edit'
  cashier?: CashierRow
  stores: StoreRow[]
  /** Locales activos: se persisten en Firestore por compatibilidad, sin mostrarlos en la UI. */
  defaultStoreIds: string[]
  onClose: () => void
  onSaved: () => void
}

function CashierFormModal({ mode, cashier, stores, defaultStoreIds, onClose, onSaved }: CashierFormModalProps) {
  const [displayName, setDisplayName] = useState(cashier?.displayName ?? '')
  const [email, setEmail] = useState(cashier?.email ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  const storeIds = defaultStoreIds.length > 0
    ? defaultStoreIds
    : cashier?.authorizedStores ?? []

  async function handleSubmit() {
    setError(null)
    if (!displayName.trim()) { setError('El nombre es obligatorio.'); return }
    if (mode === 'create' && !email.trim()) { setError('El email es obligatorio.'); return }
    if (storeIds.length === 0) {
      setError('No hay locales activos. Creá un local antes de dar de alta una cajera.')
      return
    }

    setSaving(true)
    if (mode === 'create') {
      const r = await window.hw.createCashier({
        displayName: displayName.trim(),
        email: email.trim().toLowerCase(),
        authorizedStores: storeIds,
      })
      setSaving(false)
      if (!r.ok) { setError(r.error); return }
      void window.hw.createEmployee({
        name: displayName.trim(),
        weeklyWage: 0,
        kind: 'cashier',
      })
      setCreated(true)
      return
    }

    const r = await window.hw.updateCashier({
      uid: cashier!.uid,
      displayName: displayName.trim(),
      authorizedStores: storeIds,
    })
    setSaving(false)
    if (!r.ok) { setError(r.error); return }
    onSaved()
  }

  if (created) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
        <div className="bg-panel rounded-xl w-full max-w-md p-6 shadow-xl text-center space-y-3">
          <div className="text-4xl">✅</div>
          <h2 className="text-lg font-semibold">Cajera creada</h2>
          <p className="text-sm text-muted">
            Se envió un email a <strong className="text-ink">{email}</strong> para que configure su contraseña.
          </p>
          <p className="text-xs text-subtle">
            Va a poder operar en todos los locales activos.
          </p>
          <button onClick={onSaved} className="w-full mt-2 bg-red-600 hover:bg-red-700 text-ink text-sm font-semibold py-2 rounded-lg transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade"
      onClick={e => { if (e.target === e.currentTarget && !saving) onClose() }}
    >
      <div className="bg-panel rounded-xl w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-2">
          {mode === 'create' ? 'Nueva cajera' : 'Editar cajera'}
        </h2>
        <p className="text-xs text-muted mb-5">
          {mode === 'create'
            ? 'Recibirá un email para definir su contraseña. Puede operar en todos los locales activos.'
            : 'Cambiá el nombre. La cajera puede operar en todos los locales activos.'}
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-muted mb-1">Nombre completo</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              autoFocus
              maxLength={80}
              placeholder="Ej: María García"
              disabled={saving}
              className="w-full bg-raised border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-red-500"
            />
          </div>

          {mode === 'create' && (
            <div>
              <label className="block text-xs text-muted mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                maxLength={120}
                placeholder="cajera@ejemplo.com"
                disabled={saving}
                className="w-full bg-raised border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>
          )}

          {mode === 'edit' && (
            <p className="text-xs text-muted truncate" title={email}>Email: {email}</p>
          )}

          {stores.filter(s => !s.archivedAt).length === 0 && (
            <p className="text-xs text-amber-400">
              No hay locales activos. Creá locales en Gestión de locales primero.
            </p>
          )}
        </div>

        {error && (
          <div className="mt-3 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 bg-raised hover:bg-hover text-ink text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving || storeIds.length === 0}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-input text-ink text-sm font-semibold py-2 rounded-lg transition-colors"
          >
            {saving ? 'Guardando…' : mode === 'create' ? 'Crear y enviar email' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal doble confirmación para eliminar cajera
// ---------------------------------------------------------------------------

interface DeleteConfirmModalProps {
  cashier: CashierRow
  onConfirm: () => void
  onCancel: () => void
}

function DeleteConfirmModal({ cashier, onConfirm, onCancel }: DeleteConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-panel rounded-2xl border border-line w-full max-w-sm p-6 space-y-4">
        <h2 className="text-base font-semibold text-ink min-w-0">
          ¿Estás seguro que querés eliminar{' '}
          <span className="truncate inline-block max-w-full align-bottom" title={cashier.displayName}>
            {cashier.displayName}
          </span>
          ?
        </h2>
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl border border-line text-ink hover:bg-hover"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 py-2 rounded-xl bg-red-900/60 hover:bg-red-900/80 border border-red-900/50 text-red-400/90 font-semibold"
          >
            Eliminar
          </button>
        </div>
      </div>
    </div>
  )
}
