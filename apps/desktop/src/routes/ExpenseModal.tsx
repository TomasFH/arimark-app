/**
 * Modal para registrar un gasto durante el turno activo.
 * Categoría: campo de texto libre con autocompletado de valores previos.
 * Proveedor: campo opcional con autocomplete. Si el proveedor tiene deuda pendiente se muestra aviso.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import NumericInput from '../components/NumericInput'
import { parseNumericInput, formatNumericInputValue } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import type { ProviderDebtRow } from '../types/hw-api'

interface Props {
  onRegistered: () => void
  onCancel: () => void
}

export default function ExpenseModal({ onRegistered, onCancel }: Props) {
  const [category, setCategory] = useState('')
  const [amountRaw, setAmountRaw] = useState('')
  const [notes, setNotes] = useState('')
  const [provider, setProvider] = useState('')
  const [newDebtAmountRaw, setNewDebtAmountRaw] = useState('')
  const [paysOldDebtRaw, setPaysOldDebtRaw] = useState('')
  const [providerDebt, setProviderDebt] = useState<ProviderDebtRow | null>(null)
  const [loadingDebt, setLoadingDebt] = useState(false)

  const [categorySuggestions, setCategorySuggestions] = useState<string[]>([])
  const [providerSuggestions, setProviderSuggestions] = useState<string[]>([])
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false)
  const [showProviderSuggestions, setShowProviderSuggestions] = useState(false)
  const categoryInteractedRef = useRef(false)
  const providerInteractedRef = useRef(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const categoryRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.hw.getExpenseCategories().then(r => {
      if (r.ok) setCategorySuggestions([...r.data].sort((a, b) => a.localeCompare(b, 'es-AR')))
    })
    void window.hw.getProviderNames().then(r => {
      if (r.ok) setProviderSuggestions([...r.data].sort((a, b) => a.localeCompare(b, 'es-AR')))
    })
    categoryRef.current?.focus()
  }, [])

  const fetchProviderDebt = useCallback(async (providerName: string) => {
    if (!providerName.trim()) { setProviderDebt(null); return }
    setLoadingDebt(true)
    const r = await window.hw.getProviderDebt({ provider: providerName.trim() })
    setLoadingDebt(false)
    if (r.ok) setProviderDebt(r.data)
  }, [])

  // Debounce la búsqueda de deuda del proveedor
  const debtTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleProviderChange(value: string) {
    setProvider(value)
    providerInteractedRef.current = true
    setShowProviderSuggestions(true)
    if (debtTimerRef.current) clearTimeout(debtTimerRef.current)
    debtTimerRef.current = setTimeout(() => void fetchProviderDebt(value), 500)
  }

  const filteredCategories = category.trim().length === 0
    ? categorySuggestions
    : categorySuggestions.filter(s => s.toLowerCase().includes(category.toLowerCase()))

  const filteredProviders = provider.trim().length === 0
    ? providerSuggestions
    : providerSuggestions.filter(s => s.toLowerCase().includes(provider.toLowerCase()))

  async function handleSubmit() {
    const amount = parseNumericInput(amountRaw)
    const newDebtAmount = parseNumericInput(newDebtAmountRaw) ?? 0
    const paysOldDebt = parseNumericInput(paysOldDebtRaw) ?? 0

    if (!category.trim()) { setError('Ingresá la categoría del gasto.'); return }
    if (!amount || amount <= 0) { setError('Ingresá un monto válido.'); return }

    setSaving(true)
    setError(null)
    const r = await window.hw.registerExpense({
      category: category.trim(),
      amount,
      notes: notes.trim() || undefined,
      provider: provider.trim() || undefined,
      newDebtAmount: newDebtAmount > 0 ? newDebtAmount : undefined,
      paysOldDebt: paysOldDebt > 0 ? paysOldDebt : undefined,
    })
    setSaving(false)

    if (!r.ok) { setError(r.error); return }
    onRegistered()
  }

  const hasProviderDebt = providerDebt && providerDebt.balance > 0

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm shadow-xl space-y-4 p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">Registrar gasto</h2>

        {/* Categoría con autocomplete */}
        <div className="space-y-1 relative">
          <label className="text-sm text-gray-400">Categoría</label>
          <input
            ref={categoryRef}
            type="text"
            value={category}
            onChange={e => {
              setCategory(e.target.value)
              categoryInteractedRef.current = true
              setShowCategorySuggestions(true)
            }}
            onFocus={() => { if (categoryInteractedRef.current) setShowCategorySuggestions(true) }}
            onClick={() => { categoryInteractedRef.current = true; setShowCategorySuggestions(true) }}
            onBlur={() => setTimeout(() => setShowCategorySuggestions(false), 150)}
            placeholder="Insumos, Limpieza…"
            maxLength={80}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          {showCategorySuggestions && filteredCategories.length > 0 && (
            <ul className="absolute z-10 w-full bg-gray-800 border border-gray-700 rounded-lg mt-1 max-h-40 overflow-y-auto shadow-lg">
              {filteredCategories.map(s => (
                <li
                  key={s}
                  onMouseDown={() => { setCategory(s); setShowCategorySuggestions(false) }}
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

        {/* Proveedor con autocomplete */}
        <div className="space-y-1 relative">
          <label className="text-sm text-gray-400">Proveedor (opcional)</label>
          <input
            type="text"
            value={provider}
            onChange={e => handleProviderChange(e.target.value)}
            onFocus={() => { if (providerInteractedRef.current) setShowProviderSuggestions(true) }}
            onClick={() => { providerInteractedRef.current = true; setShowProviderSuggestions(true) }}
            onBlur={() => setTimeout(() => setShowProviderSuggestions(false), 150)}
            placeholder="Nombre del proveedor…"
            maxLength={100}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          {showProviderSuggestions && filteredProviders.length > 0 && (
            <ul className="absolute z-10 w-full bg-gray-800 border border-gray-700 rounded-lg mt-1 max-h-40 overflow-y-auto shadow-lg">
              {filteredProviders.map(s => (
                <li
                  key={s}
                  onMouseDown={() => { setProvider(s); setShowProviderSuggestions(false); void fetchProviderDebt(s) }}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-700"
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Aviso de deuda existente */}
        {provider.trim() && !loadingDebt && hasProviderDebt && (
          <div className="rounded-xl bg-red-950/40 border border-red-800/60 px-4 py-3 space-y-1">
            <p className="text-sm font-semibold text-red-300">
              ⚠ Deuda pendiente con {provider.trim()}: {formatARS(providerDebt!.balance)}
            </p>
            <p className="text-xs text-red-400">
              En la última visita no se pagó el total. Si corresponde, registrá el pago de esa deuda abajo.
            </p>
          </div>
        )}

        {/* Campos de deuda (solo si hay proveedor) */}
        {provider.trim() && (
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
