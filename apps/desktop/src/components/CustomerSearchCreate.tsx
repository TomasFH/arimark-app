/**
 * Búsqueda de clientes con creación inline cuando no se selecciona ninguno.
 *
 * Flujo:
 * - Cajera escribe nombre o teléfono → se muestran sugerencias.
 * - Si elige una → onSelect con el cliente existente.
 * - Si escribe y confirma sin elegir (Enter o botón) → se pide el teléfono y
 *   se llama a onCreateNew.  No hay botón "+ Crear nuevo" separado.
 */
import { useState, useEffect, useRef } from 'react'
import type { CustomerRow } from '../types/hw-api'
import { formatPhoneInput, parsePhoneNumber } from '../lib/phoneInput'

interface Props {
  onSelect: (customer: CustomerRow) => void
  onCreateNew: (data: { name: string; phone: string }) => void
  autoFocus?: boolean
}

type Mode = 'search' | 'new-phone'

export default function CustomerSearchCreate({ onSelect, onCreateNew, autoFocus }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>('search')

  // Solo se usa en modo 'new-phone'
  const [phoneRaw, setPhoneRaw] = useState('')
  const [phoneError, setPhoneError] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus()
  }, [autoFocus])

  useEffect(() => {
    if (mode === 'new-phone' && phoneRef.current) phoneRef.current.focus()
  }, [mode])

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    let cancelled = false
    setLoading(true)
    window.hw.getCustomers({ search: query.trim(), activeOnly: true }).then(res => {
      if (cancelled) return
      setLoading(false)
      if (res.ok) setResults(res.data)
    })
    return () => { cancelled = true }
  }, [query])

  function handleConfirmName() {
    if (!query.trim()) return
    setMode('new-phone')
    setPhoneRaw('')
    setPhoneError('')
  }

  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    const formatted = formatPhoneInput(e.target.value)
    setPhoneRaw(formatted)
    setPhoneError('')
  }

  function handlePhoneConfirm() {
    const clean = parsePhoneNumber(phoneRaw)
    if (!clean) {
      setPhoneError('Ingresá un número válido de 10 dígitos (ej. 11 4567-8901).')
      return
    }
    onCreateNew({ name: query.trim(), phone: clean })
  }

  // ── Modo búsqueda ────────────────────────────────────────────────────
  if (mode === 'search') {
    return (
      <div className="space-y-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && query.trim() && results.length === 0 && !loading) {
              e.preventDefault()
              handleConfirmName()
            }
          }}
          placeholder="Buscar por nombre o teléfono..."
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
        />

        {loading && <p className="text-xs text-gray-500 py-1">Buscando...</p>}

        {results.length > 0 && (
          <ul className="divide-y divide-gray-800 rounded-lg border border-gray-700 overflow-hidden max-h-48 overflow-y-auto">
            {results.map(c => (
              <li key={c.id}>
                <button
                  onClick={() => onSelect(c)}
                  className="w-full text-left px-3 py-2.5 hover:bg-gray-800 transition-colors"
                >
                  <span className="text-sm font-medium text-white">{c.name}</span>
                  {c.phone && (
                    <span className="ml-2 text-xs text-gray-500">{c.phone}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {query.trim().length >= 2 && !loading && results.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-700 px-3 py-2.5 flex items-center justify-between gap-2">
            <p className="text-xs text-gray-400">
              No se encontró <span className="text-white font-medium">"{query.trim()}"</span>
            </p>
            <button
              onClick={handleConfirmName}
              className="shrink-0 rounded-md bg-amber-500/20 border border-amber-500/40 px-2 py-1 text-xs text-amber-400 hover:bg-amber-500/30 transition-colors"
            >
              Registrar como nuevo
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Modo nuevo cliente: pedir teléfono ────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setMode('search'); setPhoneError('') }}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          ←
        </button>
        <p className="text-xs text-gray-400">
          Nuevo cliente: <span className="text-white font-medium">{query.trim()}</span>
        </p>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Teléfono *</label>
        <input
          ref={phoneRef}
          type="text"
          inputMode="tel"
          value={phoneRaw}
          onChange={handlePhoneChange}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handlePhoneConfirm() } }}
          placeholder="Ej. 11 4567-8901"
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
          maxLength={15}
        />
        {phoneError && <p className="text-xs text-red-400 mt-1">{phoneError}</p>}
      </div>

      <button
        onClick={handlePhoneConfirm}
        className="w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-white hover:bg-amber-400 transition-colors"
      >
        Continuar
      </button>
    </div>
  )
}
