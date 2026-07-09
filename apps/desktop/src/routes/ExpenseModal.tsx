/**
 * Modal para registrar un gasto durante el turno activo.
 * Categoría: campo de texto libre con autocompletado de valores previos.
 */
import { useEffect, useRef, useState } from 'react'
import NumericInput from '../components/NumericInput'
import { parseNumericInput } from '../lib/numericInput'

interface Props {
  onRegistered: () => void
  onCancel: () => void
}

export default function ExpenseModal({ onRegistered, onCancel }: Props) {
  const [category, setCategory] = useState('')
  const [amountRaw, setAmountRaw] = useState('')
  const [notes, setNotes] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const categoryRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.hw.getExpenseCategories().then(r => {
      if (r.ok) setSuggestions(r.data)
    })
    categoryRef.current?.focus()
  }, [])

  const filtered = category.trim().length === 0
    ? suggestions
    : suggestions.filter(s => s.toLowerCase().includes(category.toLowerCase()))

  async function handleSubmit() {
    const amount = parseNumericInput(amountRaw)
    if (!category.trim()) { setError('Ingresá la categoría del gasto.'); return }
    if (!amount || amount <= 0) { setError('Ingresá un monto válido.'); return }

    setSaving(true)
    setError(null)
    const r = await window.hw.registerExpense({
      category: category.trim(),
      amount,
      notes: notes.trim() || undefined,
    })
    setSaving(false)

    if (!r.ok) { setError(r.error); return }
    onRegistered()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm shadow-xl space-y-4 p-6">
        <h2 className="text-lg font-semibold">Registrar gasto</h2>

        {/* Categoría con autocomplete */}
        <div className="space-y-1 relative">
          <label className="text-sm text-gray-400">Categoría</label>
          <input
            ref={categoryRef}
            type="text"
            value={category}
            onChange={e => { setCategory(e.target.value); setShowSuggestions(true) }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="Insumos, Limpieza…"
            maxLength={80}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          {showSuggestions && filtered.length > 0 && (
            <ul className="absolute z-10 w-full bg-gray-800 border border-gray-700 rounded-lg mt-1 max-h-40 overflow-y-auto shadow-lg">
              {filtered.map(s => (
                <li
                  key={s}
                  onMouseDown={() => { setCategory(s); setShowSuggestions(false) }}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-700"
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-400">Monto ($)</label>
          <NumericInput
            value={amountRaw}
            onChange={setAmountRaw}
            placeholder="0"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

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
