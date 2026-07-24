/**
 * ProvidersScreen — gestión de proveedores (solo admin).
 *
 * Muestra lista de proveedores con deuda combinada cross-local leída desde Firestore.
 * Permite crear, editar y archivar proveedores.
 * Fallback a datos locales cuando Firebase no está disponible (dev / sin conexión).
 */
import { useEffect, useState } from 'react'
import { formatARS } from '../lib/datetime'
import type { ProviderWithDebtRow, ProviderRow } from '../types/hw-api'

interface Props {
  onBack: () => void
}

type ModalMode =
  | { type: 'none' }
  | { type: 'create' }
  | { type: 'edit'; provider: ProviderRow }
  | { type: 'archive'; provider: ProviderWithDebtRow }

export default function ProvidersScreen({ onBack }: Props) {
  const [loading, setLoading] = useState(true)
  const [list, setList] = useState<ProviderWithDebtRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalMode>({ type: 'none' })
  const [includeArchived, setIncludeArchived] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    const r = await window.hw.getProvidersWithDebt()
    setLoading(false)
    if (r.ok) {
      setList(r.data)
    } else {
      setError(r.error ?? 'Error al cargar proveedores.')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const displayed = includeArchived
    ? list
    : list // GET_PROVIDERS_WITH_DEBT ya filtra archivados sin deuda; los que tienen deuda se muestran igual

  function toggleExpand(id: string) {
    setExpandedId(prev => prev === id ? null : id)
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-4 border-b border-gray-800">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800 text-lg"
          title="Volver"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">Proveedores</h1>
          <p className="text-xs text-gray-500">Deuda combinada entre todos los locales</p>
        </div>
        <button
          onClick={() => setModal({ type: 'create' })}
          className="shrink-0 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium transition-colors"
        >
          + Nuevo
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center items-center py-16">
            <p className="text-gray-500 text-sm">Cargando proveedores…</p>
          </div>
        )}

        {error && !loading && (
          <div className="mx-4 mt-4 p-4 rounded-xl bg-red-950/40 border border-red-800/60">
            <p className="text-red-300 text-sm">{error}</p>
            <button onClick={() => void load()} className="mt-2 text-xs text-blue-400 hover:underline">
              Reintentar
            </button>
          </div>
        )}

        {!loading && !error && (
          <div className="p-4 space-y-3">
            {displayed.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500 text-sm">No hay proveedores registrados.</p>
                <p className="text-gray-600 text-xs mt-1">Los proveedores se crean al registrar gastos o desde el botón "+ Nuevo".</p>
              </div>
            )}

            {displayed.map(p => {
              const isExpanded = expandedId === p.id
              const hasDebt = p.total > 0

              return (
                <div
                  key={p.id}
                  className={`rounded-xl border transition-colors ${
                    hasDebt
                      ? 'border-orange-800/50 bg-orange-950/20'
                      : 'border-gray-800 bg-gray-900'
                  }`}
                >
                  {/* Fila principal */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      className="flex-1 min-w-0 flex items-center gap-3 text-left"
                      onClick={() => toggleExpand(p.id)}
                    >
                      <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 shrink-0">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate" title={p.name}>{p.name}</p>
                        {hasDebt && (
                          <p className="text-xs text-orange-400">
                            Deuda total: {formatARS(p.total)}
                          </p>
                        )}
                        {!hasDebt && (
                          <p className="text-xs text-green-500">Sin deuda pendiente</p>
                        )}
                      </div>
                      <span className="text-gray-600 text-sm shrink-0">
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </button>

                    {/* Acciones */}
                    <button
                      onClick={() => setModal({ type: 'edit', provider: { id: p.id, name: p.name } })}
                      className="shrink-0 text-xs text-gray-400 hover:text-white px-2 py-1 rounded-lg hover:bg-gray-800 transition-colors"
                      title="Editar proveedor"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => setModal({ type: 'archive', provider: p })}
                      className="shrink-0 text-xs text-gray-500 hover:text-red-400 px-2 py-1 rounded-lg hover:bg-gray-800 transition-colors"
                      title="Archivar proveedor"
                    >
                      Archivar
                    </button>
                  </div>

                  {/* Desglose por local */}
                  {isExpanded && (
                    <div className="border-t border-gray-800/60 px-4 py-3 space-y-2">
                      {p.perStore.length === 0 && (
                        <p className="text-xs text-gray-500">Sin eventos de deuda registrados.</p>
                      )}
                      {p.perStore.map(s => (
                        <div key={s.storeId} className="flex items-center justify-between gap-2">
                          <p className="text-sm text-gray-300 min-w-0 truncate" title={s.storeName}>{s.storeName}</p>
                          <p className={`text-sm font-semibold shrink-0 ${s.balance > 0 ? 'text-orange-400' : 'text-green-400'}`}>
                            {s.balance > 0 ? formatARS(s.balance) : 'Sin deuda'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modales */}
      {modal.type === 'create' && (
        <ProviderFormModal
          title="Nuevo proveedor"
          onSave={async (name, phone, notes) => {
            const r = await window.hw.createProvider({ name, phone: phone || undefined, notes: notes || undefined })
            if (!r.ok) return r.error ?? 'Error al crear proveedor.'
            setModal({ type: 'none' })
            void load()
            return null
          }}
          onCancel={() => setModal({ type: 'none' })}
        />
      )}

      {modal.type === 'edit' && (
        <ProviderFormModal
          title="Editar proveedor"
          initialName={modal.provider.name}
          onSave={async (name, phone, notes) => {
            const r = await window.hw.updateProvider({ id: modal.provider.id, name, phone: phone || null, notes: notes || null })
            if (!r.ok) return r.error ?? 'Error al actualizar proveedor.'
            setModal({ type: 'none' })
            void load()
            return null
          }}
          onCancel={() => setModal({ type: 'none' })}
        />
      )}

      {modal.type === 'archive' && (
        <ConfirmArchiveModal
          providerName={modal.provider.name}
          hasDebt={modal.provider.total > 0}
          debtAmount={modal.provider.total}
          onConfirm={async () => {
            const r = await window.hw.archiveProvider({ id: modal.provider.id })
            if (!r.ok) return r.error ?? 'Error al archivar proveedor.'
            setModal({ type: 'none' })
            void load()
            return null
          }}
          onCancel={() => setModal({ type: 'none' })}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

interface ProviderFormModalProps {
  title: string
  initialName?: string
  onSave: (name: string, phone: string, notes: string) => Promise<string | null>
  onCancel: () => void
}

function ProviderFormModal({ title, initialName = '', onSave, onCancel }: ProviderFormModalProps) {
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!name.trim()) { setError('El nombre es obligatorio.'); return }
    setSaving(true)
    setError(null)
    const err = await onSave(name.trim(), phone.trim(), notes.trim())
    setSaving(false)
    if (err) setError(err)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">{title}</h2>

        <div className="space-y-1">
          <label className="text-sm text-gray-400">Nombre *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nombre del proveedor"
            maxLength={100}
            autoFocus
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-400">Teléfono (opcional)</label>
          <input
            type="text"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="11-1234-5678"
            maxLength={50}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-400">Notas (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Días de visita, productos…"
            maxLength={300}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40 text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold transition-colors disabled:opacity-40 text-sm"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ConfirmArchiveModalProps {
  providerName: string
  hasDebt: boolean
  debtAmount: number
  onConfirm: () => Promise<string | null>
  onCancel: () => void
}

function ConfirmArchiveModal({ providerName, hasDebt, debtAmount, onConfirm, onCancel }: ConfirmArchiveModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setSaving(true)
    setError(null)
    const err = await onConfirm()
    setSaving(false)
    if (err) setError(err)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-red-400">Archivar proveedor</h2>

        <p className="text-sm text-gray-300 break-words">
          ¿Archivar a <strong className="break-all">{providerName}</strong>?
          Este proveedor dejará de aparecer en el autocomplete del registro de gastos.
        </p>

        {hasDebt && (
          <div className="rounded-xl bg-red-950/40 border border-red-800/60 px-4 py-3">
            <p className="text-sm text-red-300 font-medium">
              Atención: este proveedor tiene deuda pendiente de {formatARS(debtAmount)}.
            </p>
            <p className="text-xs text-red-400 mt-1">
              El registro de deuda no se borra. Solo se archiva el proveedor.
            </p>
          </div>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40 text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-red-700 hover:bg-red-600 font-semibold transition-colors disabled:opacity-40 text-sm"
          >
            {saving ? 'Archivando…' : 'Archivar'}
          </button>
        </div>
      </div>
    </div>
  )
}
