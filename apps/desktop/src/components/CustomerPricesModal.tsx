/**
 * Modal para gestionar los precios especiales de un cliente (solo admins).
 * Permite ver los precios vigentes y agregar/eliminar precios por producto.
 */
import { useState, useEffect } from 'react'
import type { CustomerPriceRow, AdminProductRow } from '../types/hw-api'
import NumericInput from './NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'

interface Props {
  customerId: string
  customerName: string
  storeId: string
  onClose: () => void
}

export default function CustomerPricesModal({ customerId, customerName, storeId, onClose }: Props) {
  const [prices, setPrices] = useState<CustomerPriceRow[]>([])
  const [products, setProducts] = useState<AdminProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Formulario de nuevo precio
  const [selectedProductId, setSelectedProductId] = useState('')
  const [newPriceRaw, setNewPriceRaw] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    setError(null)
    const [pricesRes, productsRes] = await Promise.all([
      window.hw.getCustomerPrices({ customerId }),
      window.hw.getAllProducts(storeId),
    ])
    setLoading(false)
    if (!pricesRes.ok) { setError(pricesRes.error ?? 'Error al cargar precios.'); return }
    if (!productsRes.ok) { setError(productsRes.error ?? 'Error al cargar productos.'); return }
    setPrices(pricesRes.data)
    setProducts(productsRes.data.filter(p => p.active && p.price !== null))
  }

  useEffect(() => { loadData() }, [customerId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd() {
    const price = parseNumericInput(newPriceRaw)
    if (!selectedProductId || !price || price <= 0) {
      setSaveError('Seleccioná un producto y un precio válido.')
      return
    }
    setSaving(true)
    setSaveError(null)
    const res = await window.hw.setCustomerPrice({ customerId, productId: selectedProductId, price })
    setSaving(false)
    if (!res.ok) { setSaveError(res.error ?? 'Error al guardar.'); return }
    setSelectedProductId('')
    setNewPriceRaw('')
    loadData()
  }

  async function handleDelete(productId: string) {
    await window.hw.deleteCustomerPrice({ customerId, productId })
    loadData()
  }

  // Productos sin precio especial aún
  const pricedProductIds = new Set(prices.map(p => p.productId))
  const availableProducts = products.filter(p => !pricedProductIds.has(p.id))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-lg rounded-2xl bg-gray-900 border border-gray-700 shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-800 px-6 py-4 shrink-0">
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-300">Precios especiales</h2>
            <p className="text-base font-bold text-white">{customerName}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800">✕</button>
        </div>

        {/* Contenido scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading && <p className="text-sm text-gray-500 text-center">Cargando...</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}

          {/* Lista de precios vigentes */}
          {!loading && prices.length === 0 && (
            <p className="text-sm text-gray-500 text-center">No hay precios especiales configurados.</p>
          )}
          {prices.map(p => (
            <div key={p.productId} className="flex items-center gap-3 rounded-lg bg-gray-800 border border-gray-700 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{p.productName}</p>
                <p className="text-xs text-gray-500">vigente desde {new Date(p.validFrom).toLocaleDateString('es-AR')}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-amber-400">{formatARS(p.price)}</p>
              </div>
              <button
                onClick={() => handleDelete(p.productId)}
                className="shrink-0 text-gray-600 hover:text-red-400 text-sm transition-colors"
                title="Eliminar precio especial"
              >
                ✕
              </button>
            </div>
          ))}

          {/* Formulario para agregar */}
          {!loading && (
            <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-400">Agregar precio especial</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Producto</label>
                  <select
                    value={selectedProductId}
                    onChange={e => setSelectedProductId(e.target.value)}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
                  >
                    <option value="">Seleccionar...</option>
                    {availableProducts.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.price != null ? ` (normal: ${formatARS(p.price)})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Precio especial ($)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                    <NumericInput
                      value={newPriceRaw}
                      onChange={setNewPriceRaw}
                      placeholder="0"
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 pl-7 pr-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
              {saveError && <p className="text-xs text-red-400">{saveError}</p>}
              <button
                onClick={handleAdd}
                disabled={saving || !selectedProductId || !newPriceRaw}
                className="w-full rounded-lg bg-amber-500 py-2 text-sm font-bold text-white hover:bg-amber-400 transition-colors disabled:opacity-40"
              >
                {saving ? 'Guardando...' : 'Guardar precio especial'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
