/**
 * Modal que muestra el catálogo de productos con PLU, nombre, precio, categoría y unidad.
 * Accesible desde el CashierScreen para que la cajera consulte rápidamente
 * qué número PLU corresponde a cada producto y su precio vigente.
 */

import { useEffect, useRef, useState } from 'react'
import type { ProductRow } from '../types/hw-api'
import { formatARS } from '../lib/datetime'

type SortKey = 'pluNumber' | 'name' | 'category' | 'price'

const CATEGORY_LABELS: Record<string, string> = {
  beef_cut: 'Vacuno',
  poultry:  'Pollo/Aves',
  pork:     'Cerdo',
  other:    'Otros',
}

const UNIT_LABELS: Record<string, string> = {
  kg:   'por kg',
  unit: 'por unidad',
}

interface Props {
  onClose: () => void
}

export default function ProductsListModal({ onClose }: Props) {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('pluNumber')
  const [sortAsc, setSortAsc] = useState(true)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.hw.getProducts().then(res => {
      setLoading(false)
      if (res.ok) setProducts(res.data)
      else setError(res.error)
    })
    setTimeout(() => searchRef.current?.focus(), 50)
  }, [])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(prev => !prev)
    else { setSortKey(key); setSortAsc(true) }
  }

  const filtered = products.filter(p => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      String(p.pluNumber).startsWith(q) ||
      CATEGORY_LABELS[p.category]?.toLowerCase().includes(q)
    )
  })

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'pluNumber') cmp = a.pluNumber - b.pluNumber
    else if (sortKey === 'name') cmp = a.name.localeCompare(b.name, 'es-AR')
    else if (sortKey === 'category') cmp = a.category.localeCompare(b.category)
    else if (sortKey === 'price') cmp = (a.price ?? 0) - (b.price ?? 0)
    return sortAsc ? cmp : -cmp
  })

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="text-gray-700 ml-1">↕</span>
    return <span className="text-orange-400 ml-1">{sortAsc ? '↑' : '↓'}</span>
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex flex-col bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh]">
        <div className="flex items-center justify-between border-b border-gray-700 px-5 py-3">
          <div>
            <h2 className="text-sm font-bold text-white">Catálogo de productos</h2>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {sorted.length} producto{sorted.length !== 1 ? 's' : ''} · precios ref. Enero 2026
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
            aria-label="Cerrar"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-2 border-b border-gray-800">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, PLU o categoría…"
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <p className="py-8 text-center text-xs text-gray-500">Cargando catálogo…</p>
          )}
          {!loading && error && (
            <p className="py-8 text-center text-xs text-red-400">{error}</p>
          )}
          {!loading && !error && sorted.length === 0 && (
            <p className="py-8 text-center text-xs text-gray-500">
              {search ? 'Sin resultados para esa búsqueda.' : 'No hay productos con PLU asignado.'}
            </p>
          )}
          {!loading && !error && sorted.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                <tr>
                  <th
                    className="px-5 py-2 text-left font-semibold text-gray-400 cursor-pointer hover:text-white select-none w-14"
                    onClick={() => handleSort('pluNumber')}
                  >
                    PLU <SortIcon col="pluNumber" />
                  </th>
                  <th
                    className="px-3 py-2 text-left font-semibold text-gray-400 cursor-pointer hover:text-white select-none"
                    onClick={() => handleSort('name')}
                  >
                    Producto <SortIcon col="name" />
                  </th>
                  <th
                    className="px-3 py-2 text-right font-semibold text-gray-400 cursor-pointer hover:text-white select-none w-24"
                    onClick={() => handleSort('price')}
                  >
                    Precio <SortIcon col="price" />
                  </th>
                  <th
                    className="px-3 py-2 text-left font-semibold text-gray-400 cursor-pointer hover:text-white select-none"
                    onClick={() => handleSort('category')}
                  >
                    Cat. <SortIcon col="category" />
                  </th>
                  <th className="px-5 py-2 text-right font-semibold text-gray-400 w-20">
                    Unidad
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(p => (
                  <tr key={p.id} className="border-b border-gray-800/60 hover:bg-gray-800/40 transition-colors">
                    <td className="px-5 py-2 font-bold text-orange-400">{p.pluNumber}</td>
                    <td className="px-3 py-2 text-white">{p.name}</td>
                    <td className="px-3 py-2 text-right text-amber-300 font-medium">
                      {p.price != null ? formatARS(p.price) : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{CATEGORY_LABELS[p.category] ?? p.category}</td>
                    <td className="px-5 py-2 text-right text-gray-500">{UNIT_LABELS[p.unit] ?? p.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t border-gray-800 px-5 py-2">
          <p className="text-[10px] text-gray-600">
            Precios de referencia cargados en la app. La balanza KRETZ puede tener valores distintos — sincronizar desde el panel de PLUs.
          </p>
        </div>
      </div>
    </div>
  )
}
