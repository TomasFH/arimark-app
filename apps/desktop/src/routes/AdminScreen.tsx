/**
 * Panel de administración de productos (Fase 4).
 *
 * Funciones disponibles:
 *  - Ver todos los productos con precio vigente y disponibilidad por local
 *  - Crear producto nuevo
 *  - Editar nombre, categoría, unidad, PLU y estado activo
 *  - Cambiar precio por local (transacción atómica: cierra el vigente, abre el nuevo)
 *  - Toggle de disponibilidad por local
 *
 * Lo que queda pendiente para cuando se integre KRETZ:
 *  - Botón "Cargar en balanza" (ipc:kretz-send-plu)
 */
import { useEffect, useState, useCallback } from 'react'
import NumericInput from '../components/NumericInput'
import { parseNumericInput, formatNumericInputValue } from '../lib/numericInput'
import type {
  AdminProductRow,
  StoreRow,
  CreateProductPayload,
  UpdateProductPayload,
  SessionInfo,
} from '../types/hw-api'

const CATEGORIES: { value: AdminProductRow['category']; label: string }[] = [
  { value: 'beef_cut', label: 'Vacuno' },
  { value: 'poultry',  label: 'Aves' },
  { value: 'pork',     label: 'Cerdo' },
  { value: 'other',    label: 'Otros' },
]

const CATEGORY_LABELS: Record<AdminProductRow['category'], string> = {
  beef_cut: 'Vacuno',
  poultry:  'Aves',
  pork:     'Cerdo',
  other:    'Otros',
}

interface Props {
  session: SessionInfo
  onLogout: () => void
  onReturnToHub: () => void
}

// ---------------------------------------------------------------------------
// Pantalla principal
// ---------------------------------------------------------------------------

export default function AdminScreen({ onLogout, onReturnToHub }: Props) {
  const [stores, setStores] = useState<StoreRow[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState<string>('')
  const [products, setProducts] = useState<AdminProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Modales
  const [editProduct, setEditProduct] = useState<AdminProductRow | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [priceProduct, setPriceProduct] = useState<AdminProductRow | null>(null)

  // Filtro
  const [filterText, setFilterText] = useState('')

  // Carga inicial de locales
  useEffect(() => {
    window.hw.getStores().then(r => {
      if (r.ok && r.data.length > 0) {
        setStores(r.data)
        setSelectedStoreId(r.data[0]!.id)
      }
    })
  }, [])

  const loadProducts = useCallback(async (storeId: string) => {
    if (!storeId) return
    setLoading(true)
    setError(null)
    const r = await window.hw.getAllProducts(storeId)
    if (r.ok) {
      setProducts(r.data)
    } else {
      setError(r.error)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (selectedStoreId) void loadProducts(selectedStoreId)
  }, [selectedStoreId, loadProducts])

  const filtered = products.filter(p => {
    const q = filterText.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      String(p.pluNumber ?? '').includes(q)
    )
  })

  async function handleToggleAvailability(p: AdminProductRow) {
    const r = await window.hw.setProductAvailability({
      productId: p.id,
      storeId: selectedStoreId,
      available: !p.available,
    })
    if (r.ok) void loadProducts(selectedStoreId)
    else setError(r.error)
  }

  async function handleToggleActive(p: AdminProductRow) {
    const r = await window.hw.updateProduct({ id: p.id, active: !p.active })
    if (r.ok) void loadProducts(selectedStoreId)
    else setError(r.error)
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <button
            onClick={onReturnToHub}
            className="text-gray-400 hover:text-white transition-colors text-sm"
            title="Volver al menú principal"
          >
            ← Volver
          </button>
          <div>
            <h1 className="text-lg font-semibold">Administración — Productos</h1>
            {stores.length > 1 && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-400">Local:</span>
                <select
                  value={selectedStoreId}
                  onChange={e => setSelectedStoreId(e.target.value)}
                  className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200"
                >
                  {stores.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            {stores.length === 1 && (
              <p className="text-xs text-gray-400 mt-0.5">{stores[0]?.name}</p>
            )}
          </div>
        </div>
        <button
          onClick={onLogout}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Cerrar sesión
        </button>
      </header>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-800">
        <input
          type="text"
          placeholder="Buscar por nombre o PLU…"
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
        <button
          onClick={() => setShowCreate(true)}
          className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Nuevo producto
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-3 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Tabla */}
      <div className="flex-1 overflow-auto px-6 py-3">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-500 mt-16 text-sm">
            {filterText ? 'Sin resultados para esa búsqueda.' : 'No hay productos cargados.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-left border-b border-gray-800">
                <th className="pb-2 pr-3 font-medium w-12">PLU</th>
                <th className="pb-2 pr-3 font-medium">Nombre</th>
                <th className="pb-2 pr-3 font-medium">Categoría</th>
                <th className="pb-2 pr-3 font-medium">Unidad</th>
                <th className="pb-2 pr-3 font-medium text-right">Precio</th>
                <th className="pb-2 pr-3 font-medium text-center">Disponible</th>
                <th className="pb-2 font-medium text-center">Activo</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr
                  key={p.id}
                  className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${!p.active ? 'opacity-40' : ''}`}
                >
                  <td className="py-2 pr-3 tabular-nums text-gray-400">
                    {p.pluNumber ?? <span className="text-gray-600">—</span>}
                  </td>
                  <td className="py-2 pr-3 font-medium">{p.name}</td>
                  <td className="py-2 pr-3 text-gray-400">{CATEGORY_LABELS[p.category]}</td>
                  <td className="py-2 pr-3 text-gray-400">{p.unit === 'kg' ? 'kg' : 'unidad'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {p.price !== null ? (
                      <button
                        onClick={() => setPriceProduct(p)}
                        className="text-white hover:text-red-400 transition-colors"
                        title="Cambiar precio"
                      >
                        ${p.price.toLocaleString('es-AR')}
                      </button>
                    ) : (
                      <button
                        onClick={() => setPriceProduct(p)}
                        className="text-gray-500 hover:text-red-400 transition-colors text-xs"
                      >
                        Sin precio
                      </button>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-center">
                    <Toggle
                      checked={p.available}
                      onChange={() => void handleToggleAvailability(p)}
                    />
                  </td>
                  <td className="py-2 pr-3 text-center">
                    <Toggle
                      checked={p.active}
                      onChange={() => void handleToggleActive(p)}
                    />
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => setEditProduct(p)}
                      className="text-gray-400 hover:text-white text-xs px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modales */}
      {showCreate && (
        <ProductFormModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); void loadProducts(selectedStoreId) }}
        />
      )}

      {editProduct && (
        <ProductFormModal
          product={editProduct}
          onClose={() => setEditProduct(null)}
          onSaved={() => { setEditProduct(null); void loadProducts(selectedStoreId) }}
        />
      )}

      {priceProduct && (
        <PriceModal
          product={priceProduct}
          storeId={selectedStoreId}
          onClose={() => setPriceProduct(null)}
          onSaved={() => { setPriceProduct(null); void loadProducts(selectedStoreId) }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${checked ? 'bg-green-600' : 'bg-gray-600'}`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Modal crear/editar producto
// ---------------------------------------------------------------------------

interface ProductFormModalProps {
  product?: AdminProductRow
  onClose: () => void
  onSaved: () => void
}

function ProductFormModal({ product, onClose, onSaved }: ProductFormModalProps) {
  const isEdit = Boolean(product)

  const [name, setName] = useState(product?.name ?? '')
  const [category, setCategory] = useState<AdminProductRow['category']>(product?.category ?? 'beef_cut')
  const [unit, setUnit] = useState<'kg' | 'unit'>(product?.unit ?? 'kg')
  const [pluRaw, setPluRaw] = useState(
    product?.pluNumber != null ? String(product.pluNumber) : ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setError(null)
    if (!name.trim()) { setError('El nombre es obligatorio.'); return }

    const pluNumber = pluRaw !== '' ? parseInt(pluRaw, 10) : null
    if (pluRaw !== '' && (isNaN(pluNumber!) || pluNumber! < 1 || pluNumber! > 999)) {
      setError('El PLU debe ser un número entre 1 y 999.')
      return
    }

    setSaving(true)
    if (isEdit && product) {
      const payload: UpdateProductPayload = { id: product.id }
      if (name !== product.name) payload.name = name
      if (category !== product.category) payload.category = category
      if (unit !== product.unit) payload.unit = unit
      if (pluNumber !== product.pluNumber) payload.pluNumber = pluNumber

      const r = await window.hw.updateProduct(payload)
      if (!r.ok) { setError(r.error); setSaving(false); return }
    } else {
      const payload: CreateProductPayload = { name: name.trim(), category, unit, pluNumber }
      const r = await window.hw.createProduct(payload)
      if (!r.ok) { setError(r.error); setSaving(false); return }
    }

    setSaving(false)
    onSaved()
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="bg-gray-900 rounded-xl w-full max-w-md p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-5">
          {isEdit ? 'Editar producto' : 'Nuevo producto'}
        </h2>

        <div className="space-y-4">
          <Field label="Nombre">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="Nombre del producto"
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoría">
              <select
                value={category}
                onChange={e => setCategory(e.target.value as AdminProductRow['category'])}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
              >
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Unidad">
              <select
                value={unit}
                onChange={e => setUnit(e.target.value as 'kg' | 'unit')}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
              >
                <option value="kg">kg (pesable)</option>
                <option value="unit">Unidad</option>
              </select>
            </Field>
          </div>

          <Field label="Número de PLU (1–999, opcional)">
            <input
              type="text"
              inputMode="numeric"
              value={pluRaw}
              onChange={e => setPluRaw(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="Sin asignar"
            />
          </Field>
        </div>

        {error && (
          <div className="mt-3 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium py-2 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ---------------------------------------------------------------------------
// Modal cambio de precio
// ---------------------------------------------------------------------------

interface PriceModalProps {
  product: AdminProductRow
  storeId: string
  onClose: () => void
  onSaved: () => void
}

function PriceModal({ product, storeId, onClose, onSaved }: PriceModalProps) {
  const [priceRaw, setPriceRaw] = useState(
    product.price != null ? formatNumericInputValue(String(product.price)) : ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setError(null)
    const parsed = priceRaw === '' ? 0 : parseNumericInput(priceRaw)
    const price = parsed ?? 0
    if (price < 0) { setError('El precio no puede ser negativo.'); return }

    setSaving(true)
    const r = await window.hw.setProductPrice({ productId: product.id, storeId, price })
    if (!r.ok) { setError(r.error); setSaving(false); return }
    setSaving(false)
    onSaved()
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="bg-gray-900 rounded-xl w-full max-w-sm p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-1">Cambiar precio</h2>
        <p className="text-sm text-gray-400 mb-5">{product.name}</p>

        <Field label={`Precio ($/  ${product.unit === 'kg' ? 'kg' : 'unidad'})`}>
          <NumericInput
            value={priceRaw}
            onChange={setPriceRaw}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
            placeholder="0"
            autoFocus
          />
        </Field>

        {product.price != null && (
          <p className="text-xs text-gray-500 mt-1">
            Precio actual: ${product.price.toLocaleString('es-AR')}
          </p>
        )}

        <p className="text-xs text-gray-600 mt-2">
          Dejar en blanco o poner 0 para quitar el precio.
        </p>

        {error && (
          <div className="mt-3 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium py-2 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
          >
            {saving ? 'Guardando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ---------------------------------------------------------------------------
// Helpers de UI
// ---------------------------------------------------------------------------

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}
