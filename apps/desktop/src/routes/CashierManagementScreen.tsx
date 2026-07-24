/**
 * Pantalla de gestión de cajeras (ABM) — solo admins.
 *
 * Flujo de creación:
 *  - El admin ingresa nombre, email y locales autorizados. NO ingresa contraseña.
 *  - El sistema crea la cuenta y envía un email automático a la cajera para que
 *    defina su propia contraseña. Esto garantiza privacidad: solo la cajera
 *    conoce su contraseña.
 *
 * Eliminación:
 *  - Soft-delete: el perfil Firestore queda marcado como deleted:true.
 *  - El Auth user de Firebase persiste (requiere Cloud Function para eliminación
 *    física — deuda técnica documentada en AGENTS.md).
 *  - Se pide doble confirmación antes de eliminar para prevenir errores.
 *
 * === Reglas de Firestore requeridas (si hay PERMISSION_DENIED) ===
 * Ver la documentación en cashiers.handler.ts.
 */
import { useEffect, useState } from 'react'
import type { CashierRow } from '../types/hw-api'

interface Props {
  onBack: () => void
}

export default function CashierManagementScreen({ onBack }: Props) {
  const [cashiers, setCashiers] = useState<CashierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CashierRow | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const cashiersR = await window.hw.listCashiers()
    if (cashiersR.ok) {
      setCashiers(cashiersR.data)
    } else {
      setError(cashiersR.error)
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
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors text-sm">
            ← Volver
          </button>
          <div>
            <h1 className="text-lg font-semibold">Gestión de cajeras</h1>
            <p className="text-xs text-gray-400 mt-0.5">Crear y administrar cuentas de cajeras</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Nueva cajera
        </button>
      </header>

      {/* Error — distinguir entre "sin permiso" y error temporal */}
      {error && (
        <div className="mx-6 mt-3 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm space-y-1">
          <p className="font-medium">{error}</p>
          {error.includes('Firestore') && (
            <p className="text-xs text-red-400">
              Es necesario configurar las reglas de seguridad de Firestore para que los admins puedan leer y escribir la subcolección de usuarios.
              Consultá a quien administre el proyecto de Firebase.
            </p>
          )}
        </div>
      )}

      {/* Lista */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : cashiers.length === 0 && !error ? (
          <div className="text-center mt-16 space-y-2">
            <p className="text-gray-400 text-sm">No hay cajeras registradas.</p>
            <p className="text-gray-600 text-xs">Creá la primera cajera con el botón de arriba.</p>
          </div>
        ) : cashiers.length === 0 && error ? null : (
          <div className="space-y-2">
            {cashiers.map(c => (
              <div
                key={c.uid}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-colors ${c.active ? 'border-gray-700 bg-gray-900/50' : 'border-gray-800 bg-gray-900/20 opacity-60'}`}
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{c.displayName}</p>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">{c.email}</p>
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.active ? 'bg-green-900/50 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                    {c.active ? 'Activa' : 'Inactiva'}
                  </span>
                  <button
                    onClick={() => void handleToggle(c)}
                    disabled={toggling === c.uid}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${c.active ? 'bg-gray-800 hover:bg-amber-900/40 text-gray-300 hover:text-amber-300' : 'bg-gray-800 hover:bg-green-900/40 text-gray-300 hover:text-green-300'}`}
                  >
                    {toggling === c.uid ? '…' : c.active ? 'Desactivar' : 'Reactivar'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(c)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium bg-gray-800 hover:bg-red-900/40 text-gray-500 hover:text-red-400 transition-colors"
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
        <CreateCashierModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void load() }}
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
// Modal crear cajera
// ---------------------------------------------------------------------------

interface CreateCashierModalProps {
  onClose: () => void
  onCreated: () => void
}

function CreateCashierModal({ onClose, onCreated }: CreateCashierModalProps) {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  async function handleCreate() {
    setError(null)
    if (!displayName.trim()) { setError('El nombre es obligatorio.'); return }
    if (!email.trim()) { setError('El email es obligatorio.'); return }

    setSaving(true)
    const r = await window.hw.createCashier({
      displayName: displayName.trim(),
      email: email.trim().toLowerCase(),
    })
    setSaving(false)

    if (!r.ok) { setError(r.error); return }
    setCreated(true)
  }

  if (created) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
        <div className="bg-gray-900 rounded-xl w-full max-w-md p-6 shadow-xl text-center space-y-3">
          <div className="text-4xl">✅</div>
          <h2 className="text-lg font-semibold">Cajera creada</h2>
          <p className="text-sm text-gray-400">
            Se envió un email a <strong className="text-white">{email}</strong> para que la cajera configure su contraseña.
            Compartile solo su email — ella elegirá su propia contraseña.
          </p>
          <p className="text-xs text-gray-600">
            Si el email no llega, podés reenviar el link desde la consola de Firebase (Authentication → usuarios).
          </p>
          <button onClick={onCreated} className="w-full mt-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-gray-900 rounded-xl w-full max-w-md p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-2">Nueva cajera</h2>
        <p className="text-xs text-gray-500 mb-5">
          La cajera recibirá un email para definir su propia contraseña. No es necesario que el admin la configure.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Nombre completo</label>
            <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
              autoFocus placeholder="Ej: María García"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="cajera@ejemplo.com"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500" />
          </div>
        </div>

        {error && <div className="mt-3 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-sm">{error}</div>}

        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium py-2 rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={() => void handleCreate()} disabled={saving}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
            {saving ? 'Creando…' : 'Crear y enviar email'}
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
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-gray-900 rounded-xl w-full max-w-sm p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-1 text-red-400">Eliminar cajera</h2>
        <p className="text-sm text-gray-300 mb-2">
          ¿Estás seguro de que querés eliminar a <strong>{cashier.displayName}</strong>?
        </p>
        <p className="text-xs text-gray-500 mb-4">
          La cajera quedará deshabilitada y no podrá volver a ingresar. Sus datos históricos
          (ventas, turnos) se conservan en la base de datos local. La cuenta de Firebase puede
          eliminarse físicamente desde Firebase Console si es necesario.
        </p>

        {!confirmed ? (
          <div className="space-y-2">
            <button onClick={() => setConfirmed(true)}
              className="w-full bg-red-700 hover:bg-red-600 text-white text-sm font-medium py-2 rounded-lg transition-colors">
              Sí, eliminar cajera
            </button>
            <button onClick={onCancel}
              className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium py-2 rounded-lg transition-colors">
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
              className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium py-2 rounded-lg transition-colors">
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
