/**
 * Pantalla de gestión de cajeras (ABM) — solo admins.
 *
 * Permite listar, crear y activar/desactivar cuentas de cajeras sin
 * necesidad de acceder a la consola de Firebase.
 */
import { useEffect, useState } from 'react'
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
  const [toggling, setToggling] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const [cashiersR, storesR] = await Promise.all([
      window.hw.listCashiers(),
      window.hw.getStores(),
    ])
    if (cashiersR.ok) setCashiers(cashiersR.data)
    else setError(cashiersR.error)
    if (storesR.ok) setStores(storesR.data)
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

  const storeName = (id: string) => stores.find(s => s.id === id)?.name ?? id

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

      {error && (
        <div className="mx-6 mt-3 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Lista */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : cashiers.length === 0 ? (
          <div className="text-center mt-16 space-y-2">
            <p className="text-gray-400 text-sm">No hay cajeras registradas.</p>
            <p className="text-gray-600 text-xs">Creá la primera cajera con el botón de arriba.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {cashiers.map(c => (
              <div
                key={c.uid}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-colors ${c.active ? 'border-gray-700 bg-gray-900/50' : 'border-gray-800 bg-gray-900/20 opacity-60'}`}
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{c.displayName}</p>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">{c.email}</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {c.authorizedStores.map(id => storeName(id)).join(', ')}
                  </p>
                </div>
                <div className="flex items-center gap-3 ml-4 shrink-0">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.active ? 'bg-green-900/50 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                    {c.active ? 'Activa' : 'Inactiva'}
                  </span>
                  <button
                    onClick={() => void handleToggle(c)}
                    disabled={toggling === c.uid}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${c.active ? 'bg-gray-800 hover:bg-red-900/40 text-gray-300 hover:text-red-300' : 'bg-gray-800 hover:bg-green-900/40 text-gray-300 hover:text-green-300'}`}
                  >
                    {toggling === c.uid ? '…' : c.active ? 'Desactivar' : 'Reactivar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateCashierModal
          stores={stores}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void load() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal crear cajera
// ---------------------------------------------------------------------------

interface CreateCashierModalProps {
  stores: StoreRow[]
  onClose: () => void
  onCreated: () => void
}

function CreateCashierModal({ stores, onClose, onCreated }: CreateCashierModalProps) {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [selectedStores, setSelectedStores] = useState<string[]>(stores.length === 1 ? [stores[0]!.id] : [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleStore(id: string) {
    setSelectedStores(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    )
  }

  async function handleCreate() {
    setError(null)
    if (!displayName.trim()) { setError('El nombre es obligatorio.'); return }
    if (!email.trim()) { setError('El email es obligatorio.'); return }
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return }
    if (password !== confirmPassword) { setError('Las contraseñas no coinciden.'); return }
    if (selectedStores.length === 0) { setError('Seleccioná al menos un local.'); return }

    setSaving(true)
    const r = await window.hw.createCashier({
      displayName: displayName.trim(),
      email: email.trim().toLowerCase(),
      password,
      authorizedStores: selectedStores,
    })
    setSaving(false)

    if (!r.ok) { setError(r.error); return }
    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-gray-900 rounded-xl w-full max-w-md p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-5">Nueva cajera</h2>

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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Contraseña</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Mín. 6 caracteres"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Confirmar contraseña</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repetir"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500" />
            </div>
          </div>
          {stores.length > 1 && (
            <div>
              <label className="block text-xs text-gray-400 mb-2">Locales autorizados</label>
              <div className="space-y-1">
                {stores.map(s => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedStores.includes(s.id)}
                      onChange={() => toggleStore(s.id)}
                      className="accent-red-500 h-4 w-4" />
                    <span className="text-sm text-gray-200">{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && <div className="mt-3 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-sm">{error}</div>}

        <p className="mt-3 text-xs text-gray-600">
          La cajera recibirá estas credenciales y deberá ingresar con ellas desde la pantalla de login.
        </p>

        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium py-2 rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={() => void handleCreate()} disabled={saving}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
            {saving ? 'Creando…' : 'Crear cajera'}
          </button>
        </div>
      </div>
    </div>
  )
}
