/**
 * Panel de administración de productos (Fase 4).
 *
 * Funciones:
 *  - CRUD de productos con precio y disponibilidad por local
 *  - Edición masiva de precios: activar modo inline, editar múltiples celdas y
 *    guardar todos los cambios en lote con un solo clic
 *  - Historial de precios por producto (auditoría)
 *  - Carga masiva del catálogo a la balanza KRETZ
 */
import { useEffect, useState, useCallback } from 'react'
import NumericInput from '../components/NumericInput'
import KretzSyncModal from '../components/KretzSyncModal'
import { parseNumericInput, formatNumericInputValue } from '../lib/numericInput'
import type {
  AdminProductRow,
  StoreRow,
  CreateProductPayload,
  UpdateProductPayload,
  PriceHistoryRow,
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

function fmtARS(n: number) {
  return `$${n.toLocaleString('es-AR')}`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/** Elimina diacríticos (tildes, ñ, etc.) y convierte a minúsculas para búsquedas. */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Precio máximo soportado por la balanza KRETZ (6 dígitos con 1 decimal implícito). */
const KRETZ_MAX_PRICE = 99_999

interface Props {
  session: SessionInfo
  onLogout: () => void
  onReturnToHub: () => void
}

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
  const [showSync, setShowSync] = useState(false)
  const [historyProduct, setHistoryProduct] = useState<AdminProductRow | null>(null)
  const [deleteProduct, setDeleteProduct] = useState<AdminProductRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Edición masiva
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkDraft, setBulkDraft] = useState<Map<string, string>>(new Map())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [pendingStoreId, setPendingStoreId] = useState<string | null>(null)

  // Filtro
  const [filterText, setFilterText] = useState('')

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
    if (r.ok) setProducts(r.data)
    else setError(r.error)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (selectedStoreId) void loadProducts(selectedStoreId)
  }, [selectedStoreId, loadProducts])

  // Al cambiar de local se reemplaza el useEffect que cancelaba automáticamente el modo
  // masivo. Ahora se intercepta el cambio si hay modificaciones pendientes sin guardar.

  const filtered = products.filter(p => {
    const q = normalize(filterText)
    return normalize(p.name).includes(q) || String(p.pluNumber ?? '').includes(q)
  })

  async function handleToggleAvailability(p: AdminProductRow) {
    const r = await window.hw.setProductAvailability({ productId: p.id, storeId: selectedStoreId, available: !p.available })
    if (r.ok) void loadProducts(selectedStoreId)
    else setError(r.error)
  }

  /** Soft-delete: oculta el producto y libera su PLU (no borra historial/FK). */
  async function confirmSoftDelete() {
    if (!deleteProduct) return
    setDeleting(true)
    const r = await window.hw.updateProduct({ id: deleteProduct.id, active: false, pluNumber: null })
    setDeleting(false)
    if (r.ok) {
      setDeleteProduct(null)
      void loadProducts(selectedStoreId)
    } else {
      setError(r.error)
    }
  }

  // ---- Edición masiva ----

  function handleBulkDraftChange(productId: string, value: string) {
    setBulkDraft(prev => {
      const next = new Map(prev)
      next.set(productId, value)
      return next
    })
  }

  async function handleBulkSave() {
    const changes: { productId: string; price: number }[] = []
    for (const [productId, raw] of bulkDraft.entries()) {
      const parsed = parseNumericInput(raw)
      if (parsed === null) continue
      const original = products.find(p => p.id === productId)?.price ?? null
      if (parsed === original) continue
      changes.push({ productId, price: parsed })
    }
    if (changes.length === 0) { setBulkMode(false); setBulkDraft(new Map()); return }

    setBulkSaving(true)
    let failed = 0
    for (const { productId, price } of changes) {
      const r = await window.hw.setProductPrice({ productId, storeId: selectedStoreId, price })
      if (!r.ok) failed++
    }
    setBulkSaving(false)
    setBulkMode(false)
    setBulkDraft(new Map())
    if (failed > 0) setError(`${failed} precio(s) no se pudieron guardar.`)
    void loadProducts(selectedStoreId)
  }

  const pendingChanges = [...bulkDraft.entries()].filter(([productId, raw]) => {
    const parsed = parseNumericInput(raw)
    if (parsed === null) return false
    const original = products.find(p => p.id === productId)?.price ?? null
    return parsed !== original
  }).length

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <button onClick={onReturnToHub} className="text-gray-400 hover:text-white transition-colors text-sm">
            ← Volver
          </button>
          <div>
            <h1 className="text-lg font-semibold">Administración — Productos</h1>
            {stores.length > 1 && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-400">Local:</span>
                <select
                  value={selectedStoreId}
                  onChange={e => {
                    const next = e.target.value
                    if (bulkMode && pendingChanges > 0) {
                      setPendingStoreId(next)
                    } else {
                      setBulkMode(false)
                      setBulkDraft(new Map())
                      setSelectedStoreId(next)
                    }
                  }}
                  className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200"
                >
                  {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            {stores.length === 1 && <p className="text-xs text-gray-400 mt-0.5">{stores[0]?.name}</p>}
          </div>
        </div>
        <button onClick={onLogout} className="text-sm text-gray-400 hover:text-white transition-colors">
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

        {bulkMode ? (
          <>
            <button
              onClick={() => { setBulkMode(false); setBulkDraft(new Map()) }}
              disabled={bulkSaving}
              className="border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={() => void handleBulkSave()}
              disabled={bulkSaving || pendingChanges === 0}
              className="bg-amber-600 hover:bg-amber-700 disabled:bg-gray-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {bulkSaving
                ? 'Guardando…'
                : pendingChanges > 0
                  ? `Guardar ${pendingChanges} cambio${pendingChanges !== 1 ? 's' : ''}`
                  : 'Sin cambios'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => { setBulkMode(true); setBulkDraft(new Map()) }}
              className="border border-gray-700 hover:border-gray-500 text-gray-300 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              title="Editar varios precios de una vez"
            >
              Editar precios
            </button>
            <button
              onClick={() => setShowSync(true)}
              className="border border-gray-700 hover:border-gray-500 text-gray-300 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              title="Enviar el catálogo del local a la balanza conectada por USB"
            >
              Cargar en balanza
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              + Nuevo producto
            </button>
          </>
        )}
      </div>

      {bulkMode && (
        <div className="mx-6 mt-3 bg-amber-900/30 border border-amber-800/60 text-amber-300 rounded-lg px-4 py-2 text-xs">
          Modo edición masiva activo — modificá los precios en la tabla y guardá todos los cambios de una vez.
        </div>
      )}

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
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const draftRaw = bulkDraft.get(p.id)
                const draftParsed = draftRaw !== undefined ? parseNumericInput(draftRaw) : null
                const isChanged = draftParsed !== null && draftParsed !== (p.price ?? null)

                return (
                  <tr
                    key={p.id}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${isChanged ? 'bg-amber-900/10' : ''}`}
                  >
                    <td className="py-2 pr-3 tabular-nums text-gray-400">
                      {p.pluNumber ?? <span className="text-gray-600">—</span>}
                    </td>
                    <td className="py-2 pr-3 font-medium min-w-0">
                      <span className="truncate block max-w-xs" title={p.name}>{p.name}</span>
                    </td>
                    <td className="py-2 pr-3 text-gray-400">{CATEGORY_LABELS[p.category]}</td>
                    <td className="py-2 pr-3 text-gray-400">{p.unit === 'kg' ? 'kg' : 'unidad'}</td>

                    <td className="py-1 pr-3 text-right">
                      {bulkMode ? (
                        <NumericInput
                          value={draftRaw ?? (p.price != null ? formatNumericInputValue(String(p.price)) : '')}
                          onChange={v => handleBulkDraftChange(p.id, v)}
                          className={`w-28 bg-gray-800 border rounded px-2 py-1 text-sm text-white text-right focus:outline-none focus:ring-1 ${isChanged ? 'border-amber-500 focus:ring-amber-500' : 'border-gray-600 focus:ring-red-500'}`}
                          placeholder="—"
                        />
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setPriceProduct(p)}
                            className="text-white hover:text-red-400 transition-colors tabular-nums"
                            title="Cambiar precio"
                          >
                            {p.price != null ? fmtARS(p.price) : <span className="text-gray-500 text-xs">Sin precio</span>}
                          </button>
                          <button
                            onClick={() => setHistoryProduct(p)}
                            className="text-gray-600 hover:text-gray-400 text-xs transition-colors"
                            title="Ver historial de precios"
                          >
                            ↓
                          </button>
                        </div>
                      )}
                    </td>

                    <td className="py-2 pr-3 text-center">
                      <Toggle checked={p.available} onChange={() => void handleToggleAvailability(p)} />
                    </td>
                    <td className="py-2 text-right">
                      {!bulkMode && (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditProduct(p)}
                            className="text-gray-400 hover:text-white text-xs px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteProduct(p)}
                            className="text-xs px-2 py-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                            title="Quitar del catálogo y liberar el PLU"
                          >
                            Eliminar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modales */}
      {showCreate && (
        <ProductFormModal storeId={selectedStoreId} stores={stores} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); void loadProducts(selectedStoreId) }} />
      )}
      {editProduct && (
        <ProductFormModal storeId={selectedStoreId} stores={stores} product={editProduct} onClose={() => setEditProduct(null)} onSaved={() => { setEditProduct(null); void loadProducts(selectedStoreId) }} />
      )}
      {priceProduct && (
        <PriceModal product={priceProduct} storeId={selectedStoreId} onClose={() => setPriceProduct(null)} onSaved={() => { setPriceProduct(null); void loadProducts(selectedStoreId) }} />
      )}
      {showSync && (
        <KretzSyncModal storeId={selectedStoreId} store={stores.find(s => s.id === selectedStoreId)} onClose={() => setShowSync(false)} />
      )}
      {historyProduct && (
        <PriceHistoryModal product={historyProduct} storeId={selectedStoreId} onClose={() => setHistoryProduct(null)} />
      )}
      {deleteProduct && (
        <DeleteProductModal
          product={deleteProduct}
          deleting={deleting}
          onConfirm={() => void confirmSoftDelete()}
          onCancel={() => { if (!deleting) setDeleteProduct(null) }}
        />
      )}
      {pendingStoreId && (
        <UnsavedChangesModal
          pendingChanges={pendingChanges}
          onSave={() => void handleBulkSave().then(() => {
            setSelectedStoreId(pendingStoreId)
            setPendingStoreId(null)
          })}
          onDiscard={() => {
            setBulkMode(false)
            setBulkDraft(new Map())
            setSelectedStoreId(pendingStoreId)
            setPendingStoreId(null)
          }}
          onCancel={() => setPendingStoreId(null)}
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
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Modal crear/editar producto
// ---------------------------------------------------------------------------

interface ProductFormModalProps {
  storeId: string
  stores: StoreRow[]
  product?: AdminProductRow
  onClose: () => void
  onSaved: () => void
}

function ProductFormModal({ storeId, stores, product, onClose, onSaved }: ProductFormModalProps) {
  const isEdit = Boolean(product)
  const [name, setName] = useState(product?.name ?? '')
  const [category, setCategory] = useState<AdminProductRow['category']>(product?.category ?? 'beef_cut')
  const [unit, setUnit] = useState<'kg' | 'unit'>(product?.unit ?? 'kg')
  const [pluRaw, setPluRaw] = useState(product?.pluNumber != null ? String(product.pluNumber) : '')
  // Precio solo en creación: un campo compartido o uno por local
  const [samePriceAll, setSamePriceAll] = useState(true)
  const [sharedPriceRaw, setSharedPriceRaw] = useState('')
  const [perStorePriceRaw, setPerStorePriceRaw] = useState<Record<string, string>>(() =>
    Object.fromEntries(stores.map(s => [s.id, ''])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unitLabel = unit === 'kg' ? 'kg' : 'unidad'
  const sharedPriceValue = parseNumericInput(sharedPriceRaw)
  const anyPriceOverLimit = samePriceAll
    ? (sharedPriceValue !== null && sharedPriceValue > KRETZ_MAX_PRICE)
    : stores.some(s => {
        const v = parseNumericInput(perStorePriceRaw[s.id] ?? '')
        return v !== null && v > KRETZ_MAX_PRICE
      })

  /** Resuelve la lista (storeId, price) a persistir. Precio vacío / 0 → se omite. */
  function resolvePriceTargets(): Array<{ storeId: string; price: number }> {
    if (samePriceAll || stores.length <= 1) {
      const price = sharedPriceValue
      if (price === null || price <= 0) return []
      const ids = stores.length <= 1 ? [storeId] : stores.map(s => s.id)
      return ids.map(id => ({ storeId: id, price }))
    }
    const targets: Array<{ storeId: string; price: number }> = []
    for (const s of stores) {
      const price = parseNumericInput(perStorePriceRaw[s.id] ?? '')
      if (price !== null && price > 0) targets.push({ storeId: s.id, price })
    }
    return targets
  }

  function handleToggleSamePrice(checked: boolean) {
    setSamePriceAll(checked)
    if (checked) {
      // Al unificar: tomar el precio del local actual (o el primero no vacío)
      const fromCurrent = perStorePriceRaw[storeId] ?? ''
      const fromAny = stores.map(s => perStorePriceRaw[s.id] ?? '').find(v => v !== '') ?? ''
      setSharedPriceRaw(fromCurrent || fromAny)
    } else {
      // Al pasar a por-local: precargar todos con el precio compartido
      setPerStorePriceRaw(Object.fromEntries(stores.map(s => [s.id, sharedPriceRaw])))
    }
  }

  async function handleSave() {
    setError(null)
    if (!name.trim()) { setError('El nombre es obligatorio.'); return }
    const pluNumber = pluRaw !== '' ? parseInt(pluRaw, 10) : null
    if (pluRaw !== '' && (isNaN(pluNumber!) || pluNumber! < 1 || pluNumber! > 999)) {
      setError('El PLU debe ser un número entre 1 y 999.'); return
    }
    setSaving(true)
    let productId: string | undefined
    if (isEdit && product) {
      const payload: UpdateProductPayload = { id: product.id }
      if (name !== product.name) payload.name = name
      if (category !== product.category) payload.category = category
      if (unit !== product.unit) payload.unit = unit
      if (pluNumber !== product.pluNumber) payload.pluNumber = pluNumber
      const r = await window.hw.updateProduct(payload)
      if (!r.ok) { setError(r.error); setSaving(false); return }
      productId = product.id
    } else {
      const payload: CreateProductPayload = { name: name.trim(), category, unit, pluNumber }
      const r = await window.hw.createProduct(payload)
      if (!r.ok) { setError(r.error); setSaving(false); return }
      productId = r.data.id
    }

    // Aplicar precios iniciales por local (solo en creación)
    if (!isEdit && productId) {
      const targets = resolvePriceTargets()
      for (const t of targets) {
        const pr = await window.hw.setProductPrice({ productId, storeId: t.storeId, price: t.price })
        if (!pr.ok) {
          setError(`El producto fue creado pero falló al guardar el precio en un local: ${pr.error}`)
          setSaving(false)
          return
        }
      }
    }

    setSaving(false)
    onSaved()
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="bg-gray-900 rounded-xl w-full max-w-md p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-5">{isEdit ? 'Editar producto' : 'Nuevo producto'}</h2>
        <div className="space-y-4">
          <Field label="Nombre">
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="Nombre del producto" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoría">
              <select value={category} onChange={e => setCategory(e.target.value as AdminProductRow['category'])}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500">
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Unidad">
              <select value={unit} onChange={e => setUnit(e.target.value as 'kg' | 'unit')}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500">
                <option value="kg">kg (pesable)</option>
                <option value="unit">Unidad</option>
              </select>
            </Field>
          </div>
          <Field label="Número de PLU (1–999, opcional)">
            <input type="text" inputMode="numeric" value={pluRaw}
              onChange={e => setPluRaw(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="Sin asignar" />
          </Field>
          {!isEdit && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <p className="text-xs font-medium text-gray-400 shrink-0">
                  Precio inicial ($/{unitLabel}, opcional)
                </p>
                {stores.length > 1 && (
                  <label className="flex items-center gap-1.5 cursor-pointer select-none min-w-0">
                    <input
                      type="checkbox"
                      checked={samePriceAll}
                      onChange={e => handleToggleSamePrice(e.target.checked)}
                      className="shrink-0 accent-red-500"
                    />
                    <span className="text-xs text-gray-300 truncate" title="Usar el mismo precio en todos los locales">
                      Mismo precio en todos
                    </span>
                  </label>
                )}
              </div>

              {(samePriceAll || stores.length <= 1) ? (
                <NumericInput value={sharedPriceRaw} onChange={setSharedPriceRaw}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
                  placeholder="Dejar en blanco si no tiene precio aún" />
              ) : (
                <div className="rounded-lg border border-gray-700 bg-gray-800/40 divide-y divide-gray-700/80">
                  {stores.map(s => (
                    <div key={s.id} className="flex items-center gap-2 min-w-0 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-200" title={s.name}>{s.name}</span>
                      <NumericInput
                        value={perStorePriceRaw[s.id] ?? ''}
                        onChange={v => setPerStorePriceRaw(prev => ({ ...prev, [s.id]: v }))}
                        className="w-28 shrink-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white text-right focus:outline-none focus:ring-1 focus:ring-red-500"
                        placeholder="—"
                      />
                    </div>
                  ))}
                </div>
              )}

              {anyPriceOverLimit && (
                <p className="text-xs text-amber-400">
                  Un precio supera ${KRETZ_MAX_PRICE.toLocaleString('es-AR')} — ese local no podrá cargar el producto en la balanza.
                </p>
              )}
              {!samePriceAll && stores.length > 1 && (
                <p className="text-xs text-gray-600">Dejá en blanco los locales sin precio por ahora.</p>
              )}
            </div>
          )}
        </div>
        {error && <div className="mt-3 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-sm">{error}</div>}
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium py-2 rounded-lg transition-colors">Cancelar</button>
          <button onClick={() => void handleSave()} disabled={saving}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
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
  const [priceRaw, setPriceRaw] = useState(product.price != null ? formatNumericInputValue(String(product.price)) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const priceValue = parseNumericInput(priceRaw)
  const priceOverLimit = priceValue !== null && priceValue > KRETZ_MAX_PRICE

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
        <Field label={`Precio ($/${product.unit === 'kg' ? 'kg' : 'unidad'})`}>
          <NumericInput value={priceRaw} onChange={setPriceRaw}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
            placeholder="0" autoFocus />
        </Field>
        {product.price != null && <p className="text-xs text-gray-500 mt-1">Precio actual: {fmtARS(product.price)}</p>}
        {priceOverLimit && (
          <p className="text-xs text-amber-400 mt-2">
            El precio supera ${KRETZ_MAX_PRICE.toLocaleString('es-AR')} — este producto no podrá cargarse en la balanza.
          </p>
        )}
        <p className="text-xs text-gray-600 mt-2">Dejar en blanco o poner 0 para quitar el precio.</p>
        {error && <div className="mt-3 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-sm">{error}</div>}
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium py-2 rounded-lg transition-colors">Cancelar</button>
          <button onClick={() => void handleSave()} disabled={saving}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
            {saving ? 'Guardando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ---------------------------------------------------------------------------
// Modal historial de precios (auditoría)
// ---------------------------------------------------------------------------

interface PriceHistoryModalProps {
  product: AdminProductRow
  storeId: string
  onClose: () => void
}

function PriceHistoryModal({ product, storeId, onClose }: PriceHistoryModalProps) {
  const [history, setHistory] = useState<PriceHistoryRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.hw.getProductPriceHistory({ productId: product.id, storeId }).then(r => {
      if (r.ok) setHistory(r.data)
      setLoading(false)
    })
  }, [product.id, storeId])

  return (
    <ModalOverlay onClose={onClose}>
      <div className="bg-gray-900 rounded-xl w-full max-w-md p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-1">Historial de precios</h2>
        <p className="text-sm text-gray-400 mb-4">{product.name}</p>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">Sin historial de precios para este local.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-auto">
            {history.map(h => (
              <div key={h.id} className={`rounded-lg border px-3 py-2 text-sm ${h.validTo == null ? 'border-green-700 bg-green-900/20' : 'border-gray-700 bg-gray-800/30'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold tabular-nums">{fmtARS(h.price)}</span>
                  {h.validTo == null
                    ? <span className="text-xs text-green-400 font-medium">Vigente</span>
                    : <span className="text-xs text-gray-500">Hasta {fmtDate(h.validTo)}</span>}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Desde {fmtDate(h.validFrom)} · Por {h.createdBy}
                </p>
              </div>
            ))}
          </div>
        )}

        <button onClick={onClose} className="w-full mt-5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium py-2 rounded-lg transition-colors">
          Cerrar
        </button>
      </div>
    </ModalOverlay>
  )
}

// ---------------------------------------------------------------------------
// Helpers de UI
// ---------------------------------------------------------------------------

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
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

// ---------------------------------------------------------------------------
// Modal confirmar eliminación de producto
// ---------------------------------------------------------------------------

interface DeleteProductModalProps {
  product: AdminProductRow
  deleting: boolean
  onConfirm: () => void
  onCancel: () => void
}

function DeleteProductModal({ product, deleting, onConfirm, onCancel }: DeleteProductModalProps) {
  return (
    <ModalOverlay onClose={onCancel}>
      <div className="bg-gray-900 rounded-xl w-full max-w-sm p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-2">Eliminar producto</h2>
        <p className="text-sm text-gray-400 mb-1">
          ¿Eliminar{' '}
          <span className="text-gray-200 font-medium truncate inline-block max-w-full align-bottom" title={product.name}>
            {product.name}
          </span>
          ?
        </p>
        <p className="text-xs text-gray-500 mb-5">
          Desaparece del catálogo y libera el PLU {product.pluNumber ?? '—'}.
          Podés volver a crearlo con el mismo número.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 text-sm font-medium py-2 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
          >
            {deleting ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ---------------------------------------------------------------------------
// Modal cambios sin guardar (al cambiar de local en modo masivo)
// ---------------------------------------------------------------------------

interface UnsavedChangesModalProps {
  pendingChanges: number
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

function UnsavedChangesModal({ pendingChanges, onSave, onDiscard, onCancel }: UnsavedChangesModalProps) {
  return (
    <ModalOverlay onClose={onCancel}>
      <div className="bg-gray-900 rounded-xl w-full max-w-sm p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-2">Cambios sin guardar</h2>
        <p className="text-sm text-gray-400 mb-5">
          Tenés {pendingChanges} cambio{pendingChanges !== 1 ? 's' : ''} de precio sin guardar en este local.
          ¿Qué querés hacer antes de cambiar de local?
        </p>
        <div className="space-y-2">
          <button onClick={onSave}
            className="w-full bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
            Guardar cambios y continuar
          </button>
          <button onClick={onDiscard}
            className="w-full bg-gray-800 hover:bg-red-900/40 text-gray-300 hover:text-red-300 text-sm font-medium py-2 rounded-lg transition-colors">
            Descartar cambios y continuar
          </button>
          <button onClick={onCancel}
            className="w-full text-gray-500 hover:text-gray-300 text-sm py-2 rounded-lg transition-colors">
            Cancelar (quedarme en este local)
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
