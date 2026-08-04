/**
 * Pantalla de gestión de cajeras (ABM) — solo admins.
 *
 * Flujo de creación:
 *  - El admin ingresa nombre, email y locales autorizados. NO ingresa contraseña.
 *  - El sistema crea la cuenta y envía un email automático a la cajera para que
 *    defina su propia contraseña.
 *
 * Edición:
 *  - Se pueden cambiar nombre y locales autorizados (authorizedStores en Firestore).
 *  - Eso define en qué locales aparece el selector (móvil) / pertenece la cajera.
 *
 * Eliminación: soft-delete (deleted:true). Auth user persiste hasta Cloud Function.
 */
import { useEffect, useState } from 'react'
import BackButton from '../components/BackButton'
import type { CashierRow, StoreRow } from '../types/hw-api'

interface Props {
  onBack: () => void
}

export default function CashierManagementScreen({ onBack }: Props) {
  const [cashiers, setCashiers] = useState<CashierRow[]>([])
  const [stores, setStores] = useState<StoreRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<CashierRow | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CashierRow | null>(null)

  const storeNameById = new Map(stores.map(s => [s.id, s.name]))

  function formatStores(ids: string[]): string {
    if (ids.length === 0) return 'Sin locales asignados'
    return ids.map(id => storeNameById.get(id) ?? id).join(' · ')
  }

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
    <div className="flex flex-col h-screen bg-zinc-950 text-white">
      <header className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/50 px-6 py-3 shrink-0">
        <BackButton onClick={onBack} />
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold text-zinc-100 truncate">Gestión de cajeras</h1>
          <p className="text-[10px] text-zinc-500 mt-0.5">Cuentas, locales autorizados y estado</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
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

      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : cashiers.length === 0 && !error ? (
          <div className="text-center mt-16 space-y-2">
            <p className="text-zinc-400 text-sm">No hay cajeras registradas.</p>
            <p className="text-zinc-600 text-xs">Creá la primera cajera con el botón de arriba.</p>
          </div>
        ) : cashiers.length === 0 && error ? null : (
          <div className="space-y-2">
            {cashiers.map(c => (
              <div
                key={c.uid}
                className={`flex items-center gap-3 min-w-0 rounded-xl border px-4 py-3 transition-colors ${c.active ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-800 bg-zinc-900/20 opacity-60'}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate" title={c.displayName}>{c.displayName}</p>
                  <p className="text-xs text-zinc-400 mt-0.5 truncate" title={c.email}>{c.email}</p>
                  <p
                    className={`text-xs mt-1 truncate ${c.authorizedStores.length === 0 ? 'text-amber-400/70' : 'text-zinc-500'}`}
                    title={formatStores(c.authorizedStores)}
                  >
                    {formatStores(c.authorizedStores)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.active ? 'bg-emerald-950/50 text-emerald-400/80' : 'bg-zinc-800/80 text-zinc-500'}`}>
                    {c.active ? 'Activa' : 'Inactiva'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                  >
                    Locales
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggle(c)}
                    disabled={toggling === c.uid}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-50"
                  >
                    {toggling === c.uid ? '…' : c.active ? 'Desactivar' : 'Reactivar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(c)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium bg-zinc-800 hover:bg-red-950/40 text-zinc-500 hover:text-red-400/80 transition-colors"
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
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); void load() }}
        />
      )}

      {editing && (
        <CashierFormModal
          mode="edit"
          cashier={editing}
          stores={stores}
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
// Modal crear / editar cajera (locales)
// ---------------------------------------------------------------------------

interface CashierFormModalProps {
  mode: 'create' | 'edit'
  cashier?: CashierRow
  stores: StoreRow[]
  onClose: () => void
  onSaved: () => void
}

function CashierFormModal({ mode, cashier, stores, onClose, onSaved }: CashierFormModalProps) {
  const [displayName, setDisplayName] = useState(cashier?.displayName ?? '')
  const [email, setEmail] = useState(cashier?.email ?? '')
  const [selectedStores, setSelectedStores] = useState<string[]>(cashier?.authorizedStores ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  function toggleStore(storeId: string) {
    setSelectedStores(prev =>
      prev.includes(storeId) ? prev.filter(id => id !== storeId) : [...prev, storeId],
    )
    setError(null)
  }

  async function handleSubmit() {
    setError(null)
    if (!displayName.trim()) { setError('El nombre es obligatorio.'); return }
    if (mode === 'create' && !email.trim()) { setError('El email es obligatorio.'); return }
    if (selectedStores.length === 0) {
      setError('Seleccioná al menos un local.')
      return
    }

    setSaving(true)
    if (mode === 'create') {
      const r = await window.hw.createCashier({
        displayName: displayName.trim(),
        email: email.trim().toLowerCase(),
        authorizedStores: selectedStores,
      })
      setSaving(false)
      if (!r.ok) { setError(r.error); return }
      setCreated(true)
      return
    }

    const r = await window.hw.updateCashier({
      uid: cashier!.uid,
      displayName: displayName.trim(),
      authorizedStores: selectedStores,
    })
    setSaving(false)
    if (!r.ok) { setError(r.error); return }
    onSaved()
  }

  if (created) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
        <div className="bg-zinc-900 rounded-xl w-full max-w-md p-6 shadow-xl text-center space-y-3">
          <div className="text-4xl">✅</div>
          <h2 className="text-lg font-semibold">Cajera creada</h2>
          <p className="text-sm text-zinc-400">
            Se envió un email a <strong className="text-white">{email}</strong> para que configure su contraseña.
          </p>
          <p className="text-xs text-zinc-600">
            Locales asignados: {selectedStores.map(id => stores.find(s => s.id === id)?.name ?? id).join(', ')}
          </p>
          <button onClick={onSaved} className="w-full mt-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
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
      <div className="bg-zinc-900 rounded-xl w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-2">
          {mode === 'create' ? 'Nueva cajera' : 'Editar cajera'}
        </h2>
        <p className="text-xs text-zinc-500 mb-5">
          {mode === 'create'
            ? 'Recibirá un email para definir su contraseña. Asigná en qué locales puede operar.'
            : 'Cambiá el nombre o los locales autorizados. En el celular, el selector de local usa esta lista.'}
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Nombre completo</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              autoFocus
              maxLength={80}
              placeholder="Ej: María García"
              disabled={saving}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
            />
          </div>

          {mode === 'create' && (
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                maxLength={120}
                placeholder="cajera@ejemplo.com"
                disabled={saving}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>
          )}

          {mode === 'edit' && (
            <p className="text-xs text-zinc-500 truncate" title={email}>Email: {email}</p>
          )}

          <div>
            <p className="text-xs text-zinc-400 mb-2">Locales autorizados</p>
            {stores.length === 0 ? (
              <p className="text-xs text-amber-400">
                No hay locales activos. Creá locales en Gestión de locales primero.
              </p>
            ) : (
              <ul className="space-y-2">
                {stores.map(s => {
                  const checked = selectedStores.includes(s.id)
                  return (
                    <li key={s.id}>
                      <label className="flex items-center gap-3 min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5 cursor-pointer hover:border-zinc-600">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStore(s.id)}
                          disabled={saving}
                          className="shrink-0 rounded border-zinc-600"
                        />
                        <span className="min-w-0 flex-1 text-sm text-white truncate" title={s.name}>
                          {s.name}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
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
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving || stores.length === 0}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-zinc-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
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
  const [confirmed, setConfirmed] = useState(false)

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-zinc-900 rounded-xl w-full max-w-sm p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-1 text-red-400">Eliminar cajera</h2>
        <p className="text-sm text-zinc-300 mb-2">
          ¿Estás seguro de que querés eliminar a <strong className="truncate inline-block max-w-full align-bottom" title={cashier.displayName}>{cashier.displayName}</strong>?
        </p>
        <p className="text-xs text-zinc-500 mb-4">
          La cajera quedará deshabilitada y no podrá volver a ingresar. Sus datos históricos
          (ventas, turnos) se conservan. La cuenta de Firebase puede eliminarse físicamente
          desde Firebase Console si es necesario.
        </p>

        {!confirmed ? (
          <div className="space-y-2">
            <button onClick={() => setConfirmed(true)}
              className="w-full bg-red-700 hover:bg-red-600 text-white text-sm font-medium py-2 rounded-lg transition-colors">
              Sí, eliminar cajera
            </button>
            <button onClick={onCancel}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2 rounded-lg transition-colors">
              Cancelar
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-red-400 font-medium text-center mb-2">Confirmación final — esta acción no se puede deshacer</p>
            <button onClick={onConfirm}
              className="w-full bg-red-600 hover:bg-red-500 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
              Confirmar eliminación definitiva
            </button>
            <button onClick={onCancel}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2 rounded-lg transition-colors">
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
