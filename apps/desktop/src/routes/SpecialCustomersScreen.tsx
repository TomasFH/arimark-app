/**
 * Pantalla de Clientes Especiales.
 *
 * Entidad completamente separada de los clientes de fiados (`customers`).
 * Los admins registran y gestionan estos clientes con precios por producto
 * a modo informativo. Las cajeras solo pueden consultar.
 *
 * Los precios aquí registrados no afectan automáticamente el carrito —
 * son una referencia para que la cajera aplique el precio correcto
 * de forma manual. Idea de automatización documentada para el futuro.
 */
import { useState, useEffect, useRef } from 'react'
import type {
  SpecialCustomerRow,
  SpecialCustomerPriceRow,
  ProductRow,
} from '../types/hw-api'
import NumericInput from '../components/NumericInput'
import { parseNumericInput, formatNumericInputValue } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'

interface Props {
  onBack?: () => void
  isAdmin?: boolean
}

// ---------------------------------------------------------------------------
// Sub-componente: fila de precio por producto
// ---------------------------------------------------------------------------

interface PriceRowProps {
  entry: SpecialCustomerPriceRow
  isAdmin: boolean
  products: ProductRow[]
  onSave: (productId: string, price: number, notes: string) => Promise<void>
  onDelete: () => void
}

function SpecialPriceRow({ entry, isAdmin, onSave, onDelete }: PriceRowProps) {
  const [editing, setEditing] = useState(false)
  const [priceRaw, setPriceRaw] = useState(String(entry.specialPrice))
  const [notes, setNotes] = useState(entry.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    const p = parseNumericInput(priceRaw)
    if (!p || p <= 0) { setError('Ingresá un precio válido.'); return }
    setSaving(true); setError(null)
    try {
      await onSave(entry.productId, p, notes)
      setEditing(false)
    } catch {
      setError('Error al guardar.')
    } finally { setSaving(false) }
  }

  const updatedDate = entry.updatedAt
    ? new Date(entry.updatedAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : '—'

  return (
    <div className="py-2.5 border-b border-gray-800 last:border-0">
      {editing ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-white">{entry.productName}</p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
              <NumericInput
                value={priceRaw}
                onChange={setPriceRaw}
                placeholder="Precio especial"
                className="w-full rounded-lg border border-amber-700 bg-gray-800 pl-6 pr-3 py-1.5 text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Nota (opcional)"
              maxLength={150}
              className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {saving ? '…' : 'Guardar'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-400 hover:text-white"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">{entry.productName}</p>
            {entry.notes && <p className="text-xs text-gray-400 mt-0.5">{entry.notes}</p>}
            <p className="text-xs text-gray-600 mt-0.5">
              Modificado: <span className="text-gray-500">{updatedDate}</span>
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <span className="text-base font-semibold text-amber-400">{formatARS(entry.specialPrice)}</span>
            {isAdmin && (
              <>
                <button
                  onClick={() => { setPriceRaw(formatNumericInputValue(String(entry.specialPrice))); setEditing(true) }}
                  className="text-gray-500 hover:text-amber-400 transition-colors text-xs px-1.5 py-0.5 rounded border border-gray-700 hover:border-amber-600"
                >
                  ✏️
                </button>
                <button
                  onClick={onDelete}
                  className="text-gray-600 hover:text-red-400 transition-colors text-xs px-1.5 py-0.5 rounded border border-gray-700 hover:border-red-700"
                >
                  🗑
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-componente: tarjeta de cliente especial
// ---------------------------------------------------------------------------

interface CustomerCardProps {
  customer: SpecialCustomerRow
  prices: SpecialCustomerPriceRow[]
  products: ProductRow[]
  isAdmin: boolean
  onUpdateCustomer: (id: string, name: string, notes: string) => Promise<void>
  onDeleteCustomer: (id: string) => void
  onSavePrice: (customerId: string, productId: string, price: number, notes: string) => Promise<void>
  onDeletePrice: (customerId: string, productId: string) => void
  onAddPrice: (customerId: string) => void
}

function SpecialCustomerCard({
  customer, prices, products, isAdmin,
  onUpdateCustomer, onDeleteCustomer, onSavePrice, onDeletePrice, onAddPrice,
}: CustomerCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [editingMeta, setEditingMeta] = useState(false)
  const [editName, setEditName] = useState(customer.name)
  const [editNotes, setEditNotes] = useState(customer.notes ?? '')
  const [savingMeta, setSavingMeta] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)

  async function handleSaveMeta() {
    if (!editName.trim()) { setMetaError('El nombre no puede estar vacío.'); return }
    setSavingMeta(true); setMetaError(null)
    try {
      await onUpdateCustomer(customer.id, editName.trim(), editNotes.trim())
      setEditingMeta(false)
    } catch {
      setMetaError('Error al guardar.')
    } finally { setSavingMeta(false) }
  }

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 overflow-hidden">
      {/* Encabezado */}
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-0.5 text-gray-500 hover:text-white transition-colors text-sm"
        >
          {expanded ? '▼' : '▶'}
        </button>
        <div className="flex-1 min-w-0">
          {editingMeta ? (
            <div className="space-y-2">
              <input
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="w-full rounded-lg border border-amber-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-amber-500 focus:outline-none"
              />
              <textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={2}
                placeholder="Notas generales (opcional)"
                maxLength={300}
                className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
              />
              {metaError && <p className="text-xs text-red-400">{metaError}</p>}
              <div className="flex gap-2">
                <button onClick={handleSaveMeta} disabled={savingMeta}
                  className="rounded-md bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-50">
                  {savingMeta ? '…' : 'Guardar'}
                </button>
                <button onClick={() => setEditingMeta(false)}
                  className="rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-400 hover:text-white">
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold text-white">{customer.name}</p>
              {customer.notes && <p className="text-xs text-gray-400 mt-0.5">{customer.notes}</p>}
            </>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          <span className="text-xs text-gray-600">{prices.length} precio{prices.length !== 1 ? 's' : ''}</span>
          {isAdmin && !editingMeta && (
            <>
              <button onClick={() => setEditingMeta(true)}
                className="text-gray-500 hover:text-amber-400 transition-colors text-xs px-1.5 py-0.5 rounded border border-gray-700">
                ✏️
              </button>
              <button onClick={() => onDeleteCustomer(customer.id)}
                className="text-gray-600 hover:text-red-400 transition-colors text-xs px-1.5 py-0.5 rounded border border-gray-700">
                🗑
              </button>
            </>
          )}
        </div>
      </div>

      {/* Precios expandidos */}
      {expanded && (
        <div className="border-t border-gray-800 px-4 py-2">
          {prices.length === 0 && (
            <p className="text-xs text-gray-600 italic py-2">Sin precios especiales registrados.</p>
          )}
          {prices.map(p => (
            <SpecialPriceRow
              key={p.productId}
              entry={p}
              isAdmin={isAdmin}
              products={products}
              onSave={(productId, price, notes) => onSavePrice(customer.id, productId, price, notes)}
              onDelete={() => onDeletePrice(customer.id, p.productId)}
            />
          ))}
          {isAdmin && (
            <button
              onClick={() => onAddPrice(customer.id)}
              className="mt-2 text-xs text-amber-500 hover:text-amber-400 transition-colors"
            >
              + Agregar producto
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-componente: formulario para agregar precio
// ---------------------------------------------------------------------------

interface AddPriceFormProps {
  customerId: string
  products: ProductRow[]
  existingProductIds: string[]
  onSave: (productId: string, price: number, notes: string) => Promise<void>
  onCancel: () => void
}

function AddPriceForm({ products, existingProductIds, onSave, onCancel }: AddPriceFormProps) {
  const available = products.filter(p => !existingProductIds.includes(p.id))
  const [productId, setProductId] = useState(available[0]?.id ?? '')
  const [priceRaw, setPriceRaw] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!productId) { setError('Elegí un producto.'); return }
    const p = parseNumericInput(priceRaw)
    if (!p || p <= 0) { setError('Ingresá un precio válido.'); return }
    setSaving(true); setError(null)
    try {
      await onSave(productId, p, notes)
    } catch {
      setError('Error al guardar.')
    } finally { setSaving(false) }
  }

  if (available.length === 0) {
    return (
      <div className="mt-2 text-xs text-gray-500 italic">
        Todos los productos activos ya tienen precio especial.
        <button onClick={onCancel} className="ml-2 text-gray-400 hover:text-white">Cancelar</button>
      </div>
    )
  }

  return (
    <div className="mt-2 p-3 rounded-lg border border-dashed border-amber-700/50 bg-amber-900/10 space-y-2">
      <select
        value={productId}
        onChange={e => setProductId(e.target.value)}
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-amber-500 focus:outline-none"
      >
        {available.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
          <NumericInput
            value={priceRaw}
            onChange={setPriceRaw}
            placeholder="Precio especial"
            className="w-full rounded-lg border border-amber-700 bg-gray-800 pl-6 pr-3 py-1.5 text-sm text-white focus:border-amber-500 focus:outline-none"
          />
        </div>
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Nota (opcional)"
          maxLength={150}
          className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="rounded-md bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-50">
          {saving ? '…' : 'Agregar'}
        </button>
        <button onClick={onCancel}
          className="rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-400 hover:text-white">
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pantalla principal
// ---------------------------------------------------------------------------

export default function SpecialCustomersScreen({ onBack, isAdmin = false }: Props) {
  const [customers, setCustomers] = useState<SpecialCustomerRow[]>([])
  const [allPrices, setAllPrices] = useState<Record<string, SpecialCustomerPriceRow[]>>({})
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Para el formulario de creación de nuevo cliente especial
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Para el formulario de agregar precio (key = customerId)
  const [addingPriceFor, setAddingPriceFor] = useState<string | null>(null)

  // Para confirmación de borrado
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    loadAll()
    window.hw.getProducts().then(res => {
      if (res.ok) setProducts(res.data)
    })
  }, [])

  async function loadAll() {
    setLoading(true); setError(null)
    const res = await window.hw.listSpecialCustomers()
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error al cargar.'); return }
    setCustomers(res.data)
    // Cargar precios de todos los clientes en paralelo
    const entries = await Promise.all(
      res.data.map(c =>
        window.hw.getSpecialCustomerPrices({ specialCustomerId: c.id })
          .then(r => [c.id, r.ok ? r.data : []] as const)
      )
    )
    setAllPrices(Object.fromEntries(entries))
  }

  const filtered = search.trim()
    ? customers.filter(c =>
        c.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
          .includes(search.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())
      )
    : customers

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => setSearch(e.target.value), 150)
  }

  async function handleCreate() {
    if (!newName.trim()) { setCreateError('El nombre no puede estar vacío.'); return }
    setCreating(true); setCreateError(null)
    const res = await window.hw.createSpecialCustomer({ name: newName.trim(), notes: newNotes.trim() || undefined })
    setCreating(false)
    if (!res.ok) { setCreateError(res.error ?? 'Error al crear.'); return }
    setCustomers(prev => [...prev, res.data])
    setAllPrices(prev => ({ ...prev, [res.data.id]: [] }))
    setNewName(''); setNewNotes(''); setShowCreate(false)
  }

  async function handleUpdateCustomer(id: string, name: string, notes: string) {
    const res = await window.hw.updateSpecialCustomer({ id, name, notes: notes || undefined })
    if (!res.ok) throw new Error(res.error ?? 'Error al actualizar.')
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, name, notes: notes || null, updatedAt: new Date().toISOString() } : c))
  }

  async function handleDeleteCustomer(id: string) {
    if (confirmDelete !== id) { setConfirmDelete(id); return }
    const res = await window.hw.deleteSpecialCustomer({ id })
    if (!res.ok) return
    setCustomers(prev => prev.filter(c => c.id !== id))
    setAllPrices(prev => { const n = { ...prev }; delete n[id]; return n })
    setConfirmDelete(null)
  }

  async function handleSavePrice(customerId: string, productId: string, price: number, notes: string) {
    const res = await window.hw.setSpecialCustomerPrice({ specialCustomerId: customerId, productId, price, notes: notes || undefined })
    if (!res.ok) throw new Error(res.error ?? 'Error.')
    // Recargar precios de ese cliente
    const r = await window.hw.getSpecialCustomerPrices({ specialCustomerId: customerId })
    if (r.ok) setAllPrices(prev => ({ ...prev, [customerId]: r.data }))
    setAddingPriceFor(null)
  }

  async function handleDeletePrice(customerId: string, productId: string) {
    const res = await window.hw.deleteSpecialCustomerPrice({ specialCustomerId: customerId, productId })
    if (!res.ok) return
    setAllPrices(prev => ({
      ...prev,
      [customerId]: (prev[customerId] ?? []).filter(p => p.productId !== productId),
    }))
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-gray-800 bg-gray-900 px-6 py-4">
        {onBack && (
          <button onClick={onBack} className="rounded-lg p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors">
            ←
          </button>
        )}
        <div className="flex-1">
          <h1 className="text-lg font-bold text-white">Clientes especiales</h1>
          <p className="text-xs text-gray-500">
            Precios de referencia · {isAdmin ? 'modo admin' : 'solo lectura'}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setShowCreate(v => !v); setCreateError(null) }}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 transition-colors"
          >
            + Nuevo cliente
          </button>
        )}
      </header>

      {/* Info banner */}
      <div className="mx-6 mt-4 rounded-lg border border-blue-800/40 bg-blue-900/10 px-4 py-2.5">
        <p className="text-xs text-blue-300/80">
          Esta sección es informativa. Los precios especiales <strong>no modifican</strong> el carrito automáticamente.
          La cajera los aplica manualmente según el acuerdo con el cliente.
        </p>
      </div>

      {/* Formulario de creación inline */}
      {showCreate && isAdmin && (
        <div className="mx-6 mt-4 rounded-xl border border-amber-700/50 bg-amber-900/10 p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-300">Nuevo cliente especial</p>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nombre *"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
          />
          <textarea
            value={newNotes}
            onChange={e => setNewNotes(e.target.value)}
            rows={2}
            placeholder="Notas generales (opcional)"
            maxLength={300}
            className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
          />
          {createError && <p className="text-xs text-red-400">{createError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {creating ? 'Guardando…' : 'Crear'}
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewName(''); setNewNotes(''); setCreateError(null) }}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Buscador */}
      <div className="px-6 mt-4">
        <input
          type="text"
          onChange={handleSearchChange}
          placeholder="Filtrar por nombre..."
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
        />
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {loading && <p className="text-center text-gray-500 py-8">Cargando…</p>}
        {error && <p className="text-center text-red-400 py-8">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="text-center text-gray-600 py-8 italic">
            {customers.length === 0
              ? 'No hay clientes especiales registrados.'
              : 'No coincide ningún cliente con la búsqueda.'}
          </p>
        )}
        {filtered.map(customer => (
          <div key={customer.id}>
            {confirmDelete === customer.id && (
              <div className="mb-2 rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 flex items-center justify-between gap-2">
                <p className="text-xs text-red-300">¿Eliminar "{customer.name}" y todos sus precios especiales?</p>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => handleDeleteCustomer(customer.id)}
                    className="rounded-md bg-red-700 px-3 py-1 text-xs text-white hover:bg-red-600">
                    Confirmar
                  </button>
                  <button onClick={() => setConfirmDelete(null)}
                    className="rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-400 hover:text-white">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            <SpecialCustomerCard
              customer={customer}
              prices={allPrices[customer.id] ?? []}
              products={products}
              isAdmin={isAdmin}
              onUpdateCustomer={handleUpdateCustomer}
              onDeleteCustomer={handleDeleteCustomer}
              onSavePrice={handleSavePrice}
              onDeletePrice={handleDeletePrice}
              onAddPrice={id => setAddingPriceFor(id)}
            />
            {addingPriceFor === customer.id && (
              <div className="mt-1 px-2">
                <AddPriceForm
                  customerId={customer.id}
                  products={products}
                  existingProductIds={(allPrices[customer.id] ?? []).map(p => p.productId)}
                  onSave={(productId, price, notes) => handleSavePrice(customer.id, productId, price, notes)}
                  onCancel={() => setAddingPriceFor(null)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
