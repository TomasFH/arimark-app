/**
 * Entrada manual de producto en el POS móvil.
 * PLU o nombre → autocompletado del catálogo → cálculo de peso si aplica.
 * Se usa cuando no hay ticket para escanear.
 */
import { useState, useMemo } from 'react'
import { searchCatalog } from '../lib/catalog'
import type { CatalogProduct, SaleItemDraft } from '../types/pos'

interface Props {
  catalog: CatalogProduct[]
  onAdd: (item: SaleItemDraft) => void
  onClose: () => void
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n)
}

export function ManualEntry({ catalog, onAdd, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<CatalogProduct | null>(null)
  const [totalInput, setTotalInput] = useState('')
  const [qtyInput, setQtyInput] = useState('1')

  const suggestions = useMemo(
    () => (query.length >= 1 && !selected ? searchCatalog(catalog, query).slice(0, 6) : []),
    [query, selected, catalog]
  )

  const totalParsed = parseFloat(totalInput.replace(',', '.')) || 0
  const qtyParsed = parseInt(qtyInput) || 1

  const weightKg =
    selected?.unit === 'kg' && selected.price > 0 && totalParsed > 0
      ? Math.round((totalParsed / selected.price) * 1000) / 1000
      : null

  function handleSelect(p: CatalogProduct) {
    setSelected(p)
    setQuery(p.name)
    if (p.unit === 'unit') {
      setTotalInput(String(p.price * qtyParsed))
    }
  }

  function handleQtyChange(v: string) {
    const q = parseInt(v.replace(/\D/g, '')) || 1
    setQtyInput(String(q))
    if (selected?.unit === 'unit') {
      setTotalInput(String(selected.price * q))
    }
  }

  function handleAdd() {
    if (!selected || totalParsed <= 0) return

    const item: SaleItemDraft = {
      productId: selected.productId,
      productName: selected.name,
      pluNumber: selected.pluNumber,
      quantity: selected.unit === 'kg' ? (weightKg ?? 1) : qtyParsed,
      unitPrice: selected.price,
      subtotal: totalParsed,
      weightKg,
      manualEntry: true,
    }
    onAdd(item)
    // Limpiar para el próximo producto
    setQuery('')
    setSelected(null)
    setTotalInput('')
    setQtyInput('1')
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end">
      <div className="w-full bg-gray-900 rounded-t-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-base">Agregar producto manualmente</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="relative">
          <label className="block text-xs text-gray-400 mb-1">PLU o nombre del producto</label>
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(null) }}
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="Ej: Vacío  o  003"
            autoFocus
          />
          {suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden z-10">
              {suggestions.map(p => (
                <button
                  key={p.productId}
                  onClick={() => handleSelect(p)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-700 border-b border-gray-700 last:border-0"
                >
                  <span className="text-orange-400 font-mono text-xs mr-2">PLU {p.pluNumber}</span>
                  <span className="text-white text-sm">{p.name}</span>
                  <span className="text-gray-400 text-xs ml-2">{formatARS(p.price)}/{p.unit === 'kg' ? 'kg' : 'ud'}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <>
            {selected.unit === 'unit' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Cantidad</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={qtyInput}
                  onChange={e => handleQtyChange(e.target.value)}
                  className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-3 text-xl text-center focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-400 mb-1">Precio total del producto ($)</label>
              <input
                type="text"
                inputMode="decimal"
                value={totalInput}
                onChange={e => setTotalInput(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-3 text-xl text-center focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="0"
              />
            </div>

            {selected.unit === 'kg' && weightKg !== null && (
              <div className="bg-gray-800 rounded-lg px-4 py-2 flex justify-between text-sm">
                <span className="text-gray-400">Peso calculado</span>
                <span className="text-white font-semibold">{weightKg.toFixed(3)} kg</span>
              </div>
            )}

            <button
              onClick={handleAdd}
              disabled={!selected || totalParsed <= 0}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white font-bold rounded-xl px-4 py-4 text-lg transition-colors"
            >
              Agregar al pedido
            </button>
          </>
        )}
      </div>
    </div>
  )
}
