/**
 * Pantalla de clientes especiales.
 *
 * Muestra todos los clientes registrados en el local.
 * Las cajeras pueden ver la información. Solo los admins pueden editar las notas.
 *
 * Las notas de precios especiales son puramente informativas — no afectan
 * automáticamente los precios del carrito. El carnicero informa a la cajera
 * qué precio aplicar, quien lo ingresa manualmente.
 *
 * Idea futura documentada: integración dinámica de precios según cliente
 * seleccionado en el carrito (pendiente de hablar con los dueños).
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import type { CustomerRow } from '../types/hw-api'
import { formatPhoneInput } from '../lib/phoneInput'

interface Props {
  onBack?: () => void
  isAdmin?: boolean
}

interface CustomerCardProps {
  customer: CustomerRow
  isAdmin: boolean
  onUpdate: (id: string, notes: string) => Promise<void>
}

function CustomerCard({ customer, isAdmin, onUpdate }: CustomerCardProps) {
  const [editing, setEditing] = useState(false)
  const [notesText, setNotesText] = useState(customer.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && textareaRef.current) textareaRef.current.focus()
  }, [editing])

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    await onUpdate(customer.id, notesText)
    setSaving(false)
    setEditing(false)
  }

  const displayPhone = customer.phone ? formatPhoneInput(customer.phone) : null

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{customer.name}</p>
          {displayPhone && (
            <p className="text-xs text-gray-500 mt-0.5">{displayPhone}</p>
          )}
        </div>
        {!customer.active && (
          <span className="shrink-0 text-[10px] bg-gray-800 text-gray-500 rounded px-1.5 py-0.5">
            Inactivo
          </span>
        )}
      </div>

      {/* Notas de precios especiales */}
      <div className="border-t border-gray-800 px-4 py-3">
        <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">
          Notas de precio especial
        </p>

        {editing ? (
          <div className="space-y-2">
            <textarea
              ref={textareaRef}
              value={notesText}
              onChange={e => setNotesText(e.target.value)}
              placeholder="ej. Asado a $15.500, vacío a precio de lista…"
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
            />
            {saveError && <p className="text-xs text-red-400">{saveError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-lg bg-amber-500 py-1.5 text-xs font-semibold text-white hover:bg-amber-400 disabled:opacity-40 transition-colors"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
              <button
                onClick={() => { setEditing(false); setNotesText(customer.notes ?? ''); setSaveError(null) }}
                disabled={saving}
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <p className={`flex-1 text-xs ${notesText ? 'text-gray-300' : 'text-gray-600 italic'}`}>
              {notesText || 'Sin notas'}
            </p>
            {isAdmin && (
              <button
                onClick={() => setEditing(true)}
                className="shrink-0 text-xs text-gray-500 hover:text-amber-400 transition-colors"
              >
                ✏️
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function SpecialCustomersScreen({ onBack, isAdmin = false }: Props) {
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const loadCustomers = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await window.hw.getCustomers({ search: search.trim() || undefined, activeOnly: false })
    setLoading(false)
    if (res.ok) {
      setCustomers(res.data)
    } else {
      setError(res.error ?? 'Error al cargar clientes.')
    }
  }, [search])

  useEffect(() => {
    const t = setTimeout(loadCustomers, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [loadCustomers, search])

  async function handleUpdate(id: string, notes: string) {
    const res = await window.hw.updateCustomer({ id, notes: notes.trim() || undefined })
    if (!res.ok) throw new Error(res.error ?? 'Error al guardar.')
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, notes: notes.trim() || null } : c))
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-gray-800 bg-gray-900 px-6 py-4">
        {onBack && (
          <button
            onClick={onBack}
            className="rounded-lg p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          >
            ←
          </button>
        )}
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-white">👤 Clientes especiales</h1>
          <p className="text-xs text-gray-500">
            {isAdmin ? 'Podés editar las notas de precio por cliente' : 'Solo lectura'}
          </p>
        </div>
        <button
          onClick={loadCustomers}
          disabled={loading}
          className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
        >
          {loading ? '...' : '↺'}
        </button>
      </header>

      {/* Aviso informativo */}
      <div className="border-b border-amber-900/40 bg-amber-950/20 px-6 py-3">
        <p className="text-xs text-amber-400/80">
          Las notas son solo recordatorios para las cajeras. Los precios del carrito
          se ingresan manualmente — la app no los modifica automáticamente.
        </p>
      </div>

      {/* Buscador */}
      <div className="px-6 py-3 border-b border-gray-800">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre o teléfono..."
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
        />
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {loading && (
          <p className="text-sm text-gray-500 text-center mt-12">Cargando...</p>
        )}
        {error && (
          <p className="text-sm text-red-400 text-center mt-12">{error}</p>
        )}
        {!loading && !error && customers.length === 0 && (
          <div className="text-center mt-12 space-y-2">
            <p className="text-4xl">👤</p>
            <p className="text-sm text-gray-400">
              {search ? `No se encontró "${search}"` : 'No hay clientes registrados aún.'}
            </p>
            <p className="text-xs text-gray-600">
              Los clientes se registran cuando se crea un fiado.
            </p>
          </div>
        )}
        {customers.map(c => (
          <CustomerCard
            key={c.id}
            customer={c}
            isAdmin={isAdmin}
            onUpdate={handleUpdate}
          />
        ))}
      </div>
    </div>
  )
}
