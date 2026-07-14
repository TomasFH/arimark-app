/**
 * Componente de búsqueda/creación de clientes.
 * Permite buscar un cliente existente por nombre, DNI o teléfono,
 * o iniciar la creación de uno nuevo inline.
 */
import { useState, useEffect, useRef } from 'react'
import type { CustomerRow } from '../types/hw-api'

interface Props {
  onSelect: (customer: CustomerRow) => void
  onCreateNew: (data: { name: string; dni?: string; phone?: string }) => void
  autoFocus?: boolean
}

export default function CustomerSearchCreate({ onSelect, onCreateNew, autoFocus }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'search' | 'create'>('search')

  // Formulario de creación
  const [newName, setNewName] = useState('')
  const [newDni, setNewDni] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [createError, setCreateError] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus()
    }
  }, [autoFocus])

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setLoading(true)
    window.hw.getCustomers({ search: query.trim(), activeOnly: true }).then(res => {
      if (cancelled) return
      setLoading(false)
      if (res.ok) setResults(res.data)
    })
    return () => { cancelled = true }
  }, [query])

  function handleCreateConfirm() {
    if (!newName.trim()) {
      setCreateError('El nombre es obligatorio.')
      return
    }
    onCreateNew({
      name: newName.trim(),
      dni: newDni.trim() || undefined,
      phone: newPhone.trim() || undefined,
    })
  }

  if (mode === 'create') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <button
            onClick={() => { setMode('search'); setCreateError('') }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← Volver a búsqueda
          </button>
          <span className="text-xs text-gray-400 font-semibold">Nuevo cliente</span>
        </div>

        <div className="space-y-2">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Nombre *</label>
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={e => { setNewName(e.target.value); setCreateError('') }}
              placeholder="Nombre del cliente o negocio"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">DNI</label>
              <input
                type="text"
                value={newDni}
                onChange={e => setNewDni(e.target.value.replace(/\D/g, ''))}
                placeholder="sin puntos"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
                maxLength={12}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Teléfono</label>
              <input
                type="text"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                placeholder="ej. 11-4567-8901"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
                maxLength={20}
              />
            </div>
          </div>
        </div>

        {createError && (
          <p className="text-xs text-red-400">{createError}</p>
        )}

        <button
          onClick={handleCreateConfirm}
          className="w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-white hover:bg-amber-400 transition-colors"
        >
          Crear cliente y continuar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Buscar por nombre, DNI o teléfono..."
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
      />

      {loading && (
        <p className="text-xs text-gray-500 py-1">Buscando...</p>
      )}

      {results.length > 0 && (
        <ul className="divide-y divide-gray-800 rounded-lg border border-gray-700 bg-gray-850 overflow-hidden max-h-48 overflow-y-auto">
          {results.map(c => (
            <li key={c.id}>
              <button
                onClick={() => onSelect(c)}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-800 transition-colors"
              >
                <span className="text-sm font-medium text-white">{c.name}</span>
                {(c.dni || c.phone) && (
                  <span className="ml-2 text-xs text-gray-500">
                    {[c.dni, c.phone].filter(Boolean).join(' · ')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.trim().length >= 2 && !loading && results.length === 0 && (
        <p className="text-xs text-gray-500 py-1">
          No se encontró "{query.trim()}"
        </p>
      )}

      <div className="pt-1">
        <button
          onClick={() => { setMode('create'); setNewName(query.trim()) }}
          className="text-xs text-amber-500 hover:text-amber-300 transition-colors underline underline-offset-2"
        >
          + Crear nuevo cliente
        </button>
      </div>
    </div>
  )
}
