/**
 * Gestión de locales — solo admin.
 * Lista los locales existentes y permite crear nuevos.
 */
import { useState, useEffect } from 'react'
import type { StoreRow } from '../types/hw-api'

interface Props {
  onBack: () => void
}

export default function StoreManagementScreen({ onBack }: Props) {
  const [stores, setStores] = useState<StoreRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    void window.hw.getStores().then(r => {
      if (r.ok) setStores(r.data)
      else setError(r.error)
      setLoading(false)
    })
  }, [])

  function openForm() {
    setFormName('')
    setFormAddress('')
    setSaveError(null)
    setShowForm(true)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = formName.trim()
    if (!name) { setSaveError('El nombre del local es obligatorio.'); return }

    setSaving(true)
    setSaveError(null)
    const r = await window.hw.createStore({ name, address: formAddress.trim() || undefined })
    setSaving(false)

    if (!r.ok) { setSaveError(r.error); return }
    setStores(prev => [...prev, r.data])
    setShowForm(false)
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
            onClick={openForm}
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
                  {'address' in store && store.address && (
                    <p className="text-sm text-gray-400 truncate" title={store.address}>
                      {store.address}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal de creación */}
        {showForm && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
            <div className="bg-gray-900 rounded-2xl border border-gray-800 w-full max-w-sm p-6 space-y-4">
              <h2 className="text-base font-semibold">Nuevo local</h2>

              <form onSubmit={e => void handleCreate(e)} className="space-y-4">
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
                    onClick={() => setShowForm(false)}
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
                    {saving ? 'Creando…' : 'Crear local'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
