/**
 * Modal para registrar un gasto durante el turno activo.
 *
 * Flujo:
 *   - Proveedor es el campo principal. Autocomplete global (LIST_PROVIDERS).
 *     Al seleccionar del autocomplete se pasa providerId exacto.
 *     Al tipear nombre nuevo, se crea el proveedor al guardar.
 *   - Concepto: campo libre para gastos sin proveedor.
 *   - Regla: se requiere proveedor O concepto (o ambos).
 *   - Si el proveedor tiene deuda pendiente, se muestra aviso y campos de gestión.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import NumericInput from '../components/NumericInput'
import { parseNumericInput, formatNumericInputValue } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import type { ProviderDebtRow, ProviderRow } from '../types/hw-api'

interface Props {
  onRegistered: () => void
  onCancel: () => void
}

export default function ExpenseModal({ onRegistered, onCancel }: Props) {
  // --- Proveedor ---
  const [providerInput, setProviderInput] = useState('')
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [providerSuggestions, setProviderSuggestions] = useState<ProviderRow[]>([])
  const [showProviderSuggestions, setShowProviderSuggestions] = useState(false)
  const providerInteractedRef = useRef(false)

  // --- Concepto ---
  const [concept, setConcept] = useState('')
  const [conceptSuggestions, setConceptSuggestions] = useState<string[]>([])
  const [showConceptSuggestions, setShowConceptSuggestions] = useState(false)
  const conceptInteractedRef = useRef(false)

  // --- Deuda ---
  const [providerDebt, setProviderDebt] = useState<ProviderDebtRow | null>(null)
  const [loadingDebt, setLoadingDebt] = useState(false)

  // --- Montos ---
  const [amountRaw, setAmountRaw] = useState('')
  const [newDebtAmountRaw, setNewDebtAmountRaw] = useState('')
  const [paysOldDebtRaw, setPaysOldDebtRaw] = useState('')
  const [notes, setNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const providerInputRef = useRef<HTMLInputElement>(null)

  // Cargar providers globales y conceptos previos
  useEffect(() => {
    void window.hw.listProviders().then(r => {
      if (r.ok) setProviderSuggestions(r.data)
    })
    void window.hw.getExpenseCategories().then(r => {
      if (r.ok) setConceptSuggestions([...r.data].sort((a, b) => a.localeCompare(b, 'es-AR')))
    })
    providerInputRef.current?.focus()
  }, [])

  // Filtros de autocomplete
  const filteredProviders = providerInput.trim().length === 0
    ? providerSuggestions
    : providerSuggestions.filter(p => p.name.toLowerCase().includes(providerInput.toLowerCase()))

  const filteredConcepts = concept.trim().length === 0
    ? conceptSuggestions
    : conceptSuggestions.filter(s => s.toLowerCase().includes(concept.toLowerCase()))

  // Consultar deuda cuando el proveedor queda fijo (por selección o al perder foco)
  const fetchProviderDebt = useCallback(async (pid: string) => {
    if (!pid) { setProviderDebt(null); return }
    setLoadingDebt(true)
    const r = await window.hw.getProviderDebt({ providerId: pid })
    setLoadingDebt(false)
    if (r.ok) setProviderDebt(r.data)
  }, [])

  const debtTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleProviderInputChange(value: string) {
    setProviderInput(value)
    // Al escribir manualmente, desvinculamos del id seleccionado
    setSelectedProviderId(null)
    setProviderDebt(null)
    providerInteractedRef.current = true
    setShowProviderSuggestions(true)
  }

  function selectProviderFromList(p: ProviderRow) {
    setProviderInput(p.name)
    setSelectedProviderId(p.id)
    setShowProviderSuggestions(false)
    if (debtTimerRef.current) clearTimeout(debtTimerRef.current)
    void fetchProviderDebt(p.id)
  }

  const hasProviderDebt = providerDebt && providerDebt.balance > 0

  async function handleSubmit() {
    const amount = parseNumericInput(amountRaw)
    const newDebtAmount = parseNumericInput(newDebtAmountRaw) ?? 0
    const paysOldDebt = parseNumericInput(paysOldDebtRaw) ?? 0

    const hasProvider = providerInput.trim().length > 0
    const hasConcept = concept.trim().length > 0

    if (!hasProvider && !hasConcept) {
      setError('Ingresá un proveedor o un concepto para el gasto.')
      return
    }
    if (!amount || amount <= 0) { setError('Ingresá un monto válido.'); return }

    setSaving(true)
    setError(null)

    const payload: Parameters<typeof window.hw.registerExpense>[0] = {
      amount,
      notes: notes.trim() || undefined,
      newDebtAmount: newDebtAmount > 0 ? newDebtAmount : undefined,
      paysOldDebt: paysOldDebt > 0 ? paysOldDebt : undefined,
    }

    if (hasProvider) {
      if (selectedProviderId) {
        payload.providerId = selectedProviderId
      } else {
        payload.provider = providerInput.trim()
      }
    }
    if (hasConcept) {
      payload.concept = concept.trim()
    }

    const r = await window.hw.registerExpense(payload)
    setSaving(false)

    if (!r.ok) { setError(r.error); return }
    onRegistered()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm shadow-xl space-y-4 p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">Registrar gasto</h2>

        {/* Proveedor — campo principal con autocomplete global */}
        <div className="space-y-1 relative">
          <label className="text-sm text-gray-400">Proveedor</label>
          <input
            ref={providerInputRef}
            type="text"
            value={providerInput}
            onChange={e => handleProviderInputChange(e.target.value)}
            onFocus={() => { if (providerInteractedRef.current) setShowProviderSuggestions(true) }}
            onClick={() => { providerInteractedRef.current = true; setShowProviderSuggestions(true) }}
            onBlur={() => setTimeout(() => setShowProviderSuggestions(false), 150)}
            placeholder="Nombre del proveedor…"
            maxLength={100}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          {showProviderSuggestions && filteredProviders.length > 0 && (
            <ul className="absolute z-10 w-full bg-gray-800 border border-gray-700 rounded-lg mt-1 max-h-40 overflow-y-auto shadow-lg">
              {filteredProviders.map(p => (
                <li
                  key={p.id}
                  onMouseDown={() => selectProviderFromList(p)}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-700 flex items-center gap-2"
                >
                  <span className="flex-1 min-w-0 truncate" title={p.name}>{p.name}</span>
                  {p.phone && <span className="shrink-0 text-xs text-gray-500">{p.phone}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Concepto (libre) — obligatorio si no hay proveedor */}
        <div className="space-y-1 relative">
          <label className="text-sm text-gray-400">
            Concepto
            {providerInput.trim() ? <span className="text-gray-600 ml-1">(opcional)</span> : <span className="text-gray-400 ml-1">*</span>}
          </label>
          <input
            type="text"
            value={concept}
            onChange={e => {
              setConcept(e.target.value)
              conceptInteractedRef.current = true
              setShowConceptSuggestions(true)
            }}
            onFocus={() => { if (conceptInteractedRef.current) setShowConceptSuggestions(true) }}
            onClick={() => { conceptInteractedRef.current = true; setShowConceptSuggestions(true) }}
            onBlur={() => setTimeout(() => setShowConceptSuggestions(false), 150)}
            placeholder={providerInput.trim() ? 'Descripción adicional…' : 'Insumos, Limpieza…'}
            maxLength={80}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          {showConceptSuggestions && filteredConcepts.length > 0 && (
            <ul className="absolute z-10 w-full bg-gray-800 border border-gray-700 rounded-lg mt-1 max-h-40 overflow-y-auto shadow-lg">
              {filteredConcepts.map(s => (
                <li
                  key={s}
                  onMouseDown={() => { setConcept(s); setShowConceptSuggestions(false) }}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-700"
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Monto */}
        <div className="space-y-1">
          <label className="text-sm text-gray-400">Monto pagado ($)</label>
          <NumericInput
            value={amountRaw}
            onChange={setAmountRaw}
            placeholder="0"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Aviso de deuda existente del proveedor */}
        {providerInput.trim() && !loadingDebt && hasProviderDebt && (
          <div className="rounded-xl bg-red-950/40 border border-red-800/60 px-4 py-3 space-y-1">
            <p className="text-sm font-semibold text-red-300">
              ⚠ Deuda pendiente con {providerInput.trim()}: {formatARS(providerDebt!.balance)}
            </p>
            <p className="text-xs text-red-400">
              En la última visita no se pagó el total. Si corresponde, registrá el pago de esa deuda abajo.
            </p>
          </div>
        )}

        {/* Campos de deuda — solo si hay proveedor ingresado */}
        {providerInput.trim() && (
          <div className="space-y-3 bg-gray-800/40 rounded-xl p-4 border border-gray-700/50">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Gestión de deuda</p>

            {hasProviderDebt && (
              <div className="space-y-1">
                <label className="text-xs text-gray-400">
                  Pago de deuda anterior ({formatARS(providerDebt!.balance)}) ($)
                </label>
                <NumericInput
                  value={paysOldDebtRaw}
                  onChange={v => {
                    const val = parseNumericInput(v) ?? 0
                    const max = providerDebt!.balance
                    setPaysOldDebtRaw(val > max ? formatNumericInputValue(String(max)) : v)
                  }}
                  placeholder="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                <p className="text-[10px] text-gray-500">Ingresá cuánto de la deuda anterior se pagó en esta visita.</p>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-gray-400">Monto que queda adeudado al proveedor esta vez ($)</label>
              <NumericInput
                value={newDebtAmountRaw}
                onChange={setNewDebtAmountRaw}
                placeholder="0"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <p className="text-[10px] text-gray-500">Si no se pagó todo lo que trajo, ingresá la diferencia.</p>
            </div>
          </div>
        )}

        {/* Notas */}
        <div className="space-y-1">
          <label className="text-sm text-gray-400">Notas (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Detalle del gasto…"
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
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold transition-colors disabled:opacity-40 text-sm"
          >
            {saving ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
