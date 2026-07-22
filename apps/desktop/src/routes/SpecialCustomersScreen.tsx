/**
 * Pantalla de Clientes Especiales.
 *
 * Entidad completamente separada de los clientes de fiados.
 * Los admins registran y gestionan estos clientes con precios por producto
 * a modo informativo. Las cajeras solo pueden consultar.
 *
 * Los precios son puramente informativos — no afectan el carrito.
 * Idea de automatización por cliente documentada para el futuro.
 *
 * --- Idea futura: actualización masiva de precios ---
 * Cuando la lista de clientes especiales sea grande, una opción eficiente
 * sería una vista "tabla cruzada": filas = productos, columnas = clientes.
 * El admin edita un precio en la celda correspondiente y guarda todo de
 * una sola vez. Alternativamente, si un cliente tiene un descuento fijo
 * (ej. siempre 10% menos), un campo "descuento %" podría calcular todos
 * sus precios automáticamente a partir del catálogo. Ambas ideas requieren
 * validar con los dueños antes de implementar.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type {
  SpecialCustomerRow,
  SpecialCustomerPriceRow,
  ProductRow,
  StoreRow,
} from '../types/hw-api'
import NumericInput from '../components/NumericInput'
import { parseNumericInput, formatNumericInputValue } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import StoreFilter from '../components/StoreFilter'

interface Props {
  onBack?: () => void
  isAdmin?: boolean
}

// ---------------------------------------------------------------------------
// Typeahead de productos — busca por nombre o PLU, muestra precio original
// ---------------------------------------------------------------------------

interface ProductTypeaheadProps {
  products: ProductRow[]
  excludeIds: string[]
  onSelect: (product: ProductRow) => void
}

function ProductTypeahead({ products, excludeIds, onSelect }: ProductTypeaheadProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const available = products.filter(p => !excludeIds.includes(p.id))
    if (!q) return available
    return available.filter(p =>
      p.name.toLowerCase().includes(q) ||
      String(p.pluNumber).includes(q)
    )
  }, [products, excludeIds, query])

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Buscar por nombre o PLU..."
        autoFocus
        className="w-full rounded-lg border border-amber-700/60 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
      />
      {matches.length === 0 ? (
        <p className="text-xs text-gray-600 px-1 py-2 italic">
          {query ? 'Sin coincidencias.' : 'Sin productos disponibles.'}
        </p>
      ) : (
        <ul className="max-h-44 overflow-y-auto rounded-lg border border-gray-700 divide-y divide-gray-800">
          {matches.map(p => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => { onSelect(p); setQuery('') }}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-800 transition-colors"
              >
                <span className="text-sm text-white">{p.name}</span>
                <span className="text-xs text-gray-500 shrink-0 ml-2">
                  PLU {p.pluNumber}
                  {p.price != null && (
                    <span className="ml-2 text-gray-400">{formatARS(p.price)}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor de precios inline (usado en creación y edición)
// ---------------------------------------------------------------------------

interface PriceEntry {
  productId: string
  productName: string
  pluNumber: number
  originalPrice: number | null
  specialPriceRaw: string
  notes: string
  existingId?: string  // si ya estaba guardado
}

interface PriceEditorProps {
  products: ProductRow[]
  initial: PriceEntry[]
  isAdmin: boolean
  onChange: (entries: PriceEntry[]) => void
}

function PriceEditor({ products, initial, isAdmin, onChange }: PriceEditorProps) {
  const [entries, setEntries] = useState<PriceEntry[]>(initial)
  const [showSearch, setShowSearch] = useState(false)

  function update(newEntries: PriceEntry[]) {
    setEntries(newEntries)
    onChange(newEntries)
  }

  function handleAddProduct(product: ProductRow) {
    const entry: PriceEntry = {
      productId: product.id,
      productName: product.name,
      pluNumber: product.pluNumber,
      originalPrice: product.price,
      specialPriceRaw: product.price != null ? formatNumericInputValue(String(product.price)) : '',
      notes: '',
    }
    update([...entries, entry])
    setShowSearch(false)
  }

  function handleRemove(productId: string) {
    update(entries.filter(e => e.productId !== productId))
  }

  function handlePriceChange(productId: string, raw: string) {
    update(entries.map(e => e.productId === productId ? { ...e, specialPriceRaw: raw } : e))
  }

  function handleNotesChange(productId: string, notes: string) {
    update(entries.map(e => e.productId === productId ? { ...e, notes } : e))
  }

  const excludedIds = entries.map(e => e.productId)

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
        Precios especiales
      </p>

      {entries.length === 0 && (
        <p className="text-xs text-gray-600 italic">Sin precios especiales agregados.</p>
      )}

      {entries.map(entry => (
        <div key={entry.productId} className="rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-sm font-medium text-white">{entry.productName}</span>
              <span className="ml-2 text-xs text-gray-500">PLU {entry.pluNumber}</span>
              {entry.originalPrice != null && (
                <span className="ml-2 text-xs text-gray-500">
                  Precio lista: <span className="text-gray-400">{formatARS(entry.originalPrice)}</span>
                </span>
              )}
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => handleRemove(entry.productId)}
                className="shrink-0 text-gray-600 hover:text-red-400 text-xs transition-colors"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <div className="relative w-36 shrink-0">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
              {isAdmin ? (
                <NumericInput
                  value={entry.specialPriceRaw}
                  onChange={raw => handlePriceChange(entry.productId, raw)}
                  placeholder="Precio especial"
                  className="w-full rounded-lg border border-amber-700/60 bg-gray-800 pl-6 pr-2 py-1.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                />
              ) : (
                <span className="pl-6 py-1.5 text-sm text-amber-400 font-semibold">
                  {formatARS(parseNumericInput(entry.specialPriceRaw) ?? 0)}
                </span>
              )}
            </div>
            {isAdmin ? (
              <input
                type="text"
                value={entry.notes}
                onChange={e => handleNotesChange(entry.productId, e.target.value)}
                placeholder="Nota (opcional)"
                maxLength={120}
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
              />
            ) : (
              entry.notes && (
                <span className="flex-1 text-xs text-gray-400 py-1.5">{entry.notes}</span>
              )
            )}
          </div>
        </div>
      ))}

      {isAdmin && (
        showSearch ? (
          <div className="rounded-lg border border-dashed border-amber-700/40 p-3 space-y-2">
            <ProductTypeahead
              products={products}
              excludeIds={excludedIds}
              onSelect={handleAddProduct}
            />
            <button
              type="button"
              onClick={() => setShowSearch(false)}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowSearch(true)}
            className="text-xs text-amber-500 hover:text-amber-400 transition-colors"
          >
            + Agregar producto
          </button>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tarjeta de cliente especial
// ---------------------------------------------------------------------------

interface CustomerCardProps {
  customer: SpecialCustomerRow
  prices: SpecialCustomerPriceRow[]
  products: ProductRow[]
  isAdmin: boolean
  onSave: (id: string, name: string, notes: string, priceEntries: PriceEntry[]) => Promise<void>
  onDelete: (id: string) => void
}

function SpecialCustomerCard({ customer, prices, products, isAdmin, onSave, onDelete }: CustomerCardProps) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [editName, setEditName] = useState(customer.name)
  const [editNotes, setEditNotes] = useState(customer.notes ?? '')
  const [editEntries, setEditEntries] = useState<PriceEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Cuando se abre el modo edición, inicializar con los precios actuales
  function startEdit() {
    setEditName(customer.name)
    setEditNotes(customer.notes ?? '')
    setEditEntries(prices.map(p => {
      const prod = products.find(pr => pr.id === p.productId)
      return {
        productId: p.productId,
        productName: p.productName,
        pluNumber: prod?.pluNumber ?? 0,
        originalPrice: prod?.price ?? null,
        specialPriceRaw: formatNumericInputValue(String(p.specialPrice)),
        notes: p.notes ?? '',
        existingId: p.id,
      }
    }))
    setEditing(true)
    setError(null)
  }

  async function handleSave() {
    if (!editName.trim()) { setError('El nombre no puede estar vacío.'); return }
    setSaving(true); setError(null)
    try {
      await onSave(customer.id, editName.trim(), editNotes.trim(), editEntries)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar.')
    } finally { setSaving(false) }
  }

  const updatedDate = customer.updatedAt
    ? new Date(customer.updatedAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : null

  if (editing) {
    return (
      <div className="rounded-xl border border-amber-700/50 bg-gray-900 p-4 space-y-4">
        <div className="space-y-2">
          <input
            type="text"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            placeholder="Nombre *"
            autoFocus
            className="w-full rounded-lg border border-amber-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
          />
          <textarea
            value={editNotes}
            onChange={e => setEditNotes(e.target.value)}
            rows={2}
            placeholder="Notas generales (opcional)"
            maxLength={300}
            className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
          />
        </div>
        <PriceEditor
          products={products}
          initial={editEntries}
          isAdmin={true}
          onChange={setEditEntries}
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button onClick={() => setEditing(false)}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white">
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  // Modo vista
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 overflow-hidden">
      {/* Cabecera siempre visible — click para expandir/colapsar */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{customer.name}</p>
          {customer.notes && <p className="text-xs text-gray-400 mt-0.5 truncate" title={customer.notes}>{customer.notes}</p>}
          {updatedDate && (
            <p className="text-xs text-gray-600 mt-0.5">Modificado: {updatedDate}</p>
          )}
          {!expanded && prices.length > 0 && (
            <p className="text-xs text-gray-600 mt-0.5">
              {prices.length} precio{prices.length > 1 ? 's' : ''} especial{prices.length > 1 ? 'es' : ''} · tocá para ver
            </p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1.5 pt-0.5">
          {isAdmin && (
            <>
              <span
                role="button"
                onClick={e => { e.stopPropagation(); startEdit() }}
                className="text-gray-500 hover:text-amber-400 text-xs px-1.5 py-0.5 rounded border border-gray-700 hover:border-amber-600 transition-colors"
              >
                ✏️
              </span>
              {confirmDelete ? (
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <button onClick={() => onDelete(customer.id)}
                    className="rounded-md bg-red-700 px-2 py-0.5 text-xs text-white hover:bg-red-600">
                    Confirmar
                  </button>
                  <button onClick={() => setConfirmDelete(false)}
                    className="text-xs text-gray-500 hover:text-gray-300 px-1">
                    ✕
                  </button>
                </div>
              ) : (
                <span
                  role="button"
                  onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
                  className="text-gray-600 hover:text-red-400 text-xs px-1.5 py-0.5 rounded border border-gray-700 hover:border-red-700 transition-colors"
                >
                  🗑
                </span>
              )}
            </>
          )}
          <span className="text-gray-600 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Detalle de precios — se muestra solo cuando expanded */}
      {expanded && (
        <div className="border-t border-gray-800 px-4 py-2">
          {prices.length === 0 ? (
            <p className="text-xs text-gray-600 italic py-1">Sin precios especiales registrados.</p>
          ) : (
            <div className="space-y-1.5 py-1">
              {prices.map(p => {
                const prod = products.find(pr => pr.id === p.productId)
                const modDate = new Date(p.updatedAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                return (
                  <div key={p.productId} className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <span className="text-white">{p.productName}</span>
                      <span className="ml-1.5 text-gray-600">PLU {prod?.pluNumber ?? '?'}</span>
                      {prod?.price != null && (
                        <span className="ml-1.5 text-gray-500">lista: {formatARS(prod.price)}</span>
                      )}
                      {p.notes && <span className="ml-1.5 text-gray-500">— {p.notes}</span>}
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-semibold text-amber-400">{formatARS(p.specialPrice)}</span>
                      <span className="ml-2 text-gray-600">{modDate}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
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
  const [storeIdFilter, setStoreIdFilter] = useState<string>('all')
  const [availableStores, setAvailableStores] = useState<StoreRow[]>([])

  // Creación inline
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [newEntries, setNewEntries] = useState<PriceEntry[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isAdmin) {
      window.hw.getStores().then(r => {
        if (r.ok) setAvailableStores(r.data)
      })
    }
    window.hw.getProducts().then(res => {
      if (res.ok) setProducts(res.data)
    })
  }, [isAdmin])

  useEffect(() => {
    void loadAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeIdFilter])

  async function loadAll() {
    setLoading(true); setError(null)
    const res = await window.hw.listSpecialCustomers(isAdmin ? { storeIdFilter } : undefined)
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error al cargar.'); return }
    setCustomers(res.data)
    const entries = await Promise.all(
      res.data.map(c =>
        window.hw.getSpecialCustomerPrices({ specialCustomerId: c.id })
          .then(r => [c.id, r.ok ? r.data : []] as const)
      )
    )
    setAllPrices(Object.fromEntries(entries))
  }

  async function syncPrices(customerId: string, entries: PriceEntry[], currentPrices: SpecialCustomerPriceRow[]) {
    // Borrar precios que ya no están en la lista
    const removedIds = currentPrices
      .filter(cp => !entries.find(e => e.productId === cp.productId))
      .map(cp => cp.productId)

    for (const productId of removedIds) {
      await window.hw.deleteSpecialCustomerPrice({ specialCustomerId: customerId, productId })
    }

    // Crear o actualizar los que están en la lista
    for (const entry of entries) {
      const price = parseNumericInput(entry.specialPriceRaw)
      if (!price || price <= 0) continue
      await window.hw.setSpecialCustomerPrice({
        specialCustomerId: customerId,
        productId: entry.productId,
        price,
        notes: entry.notes || undefined,
      })
    }
  }

  async function handleCreate() {
    if (!newName.trim()) { setCreateError('El nombre no puede estar vacío.'); return }
    setCreating(true); setCreateError(null)
    const res = await window.hw.createSpecialCustomer({ name: newName.trim(), notes: newNotes.trim() || undefined })
    if (!res.ok) { setCreateError(res.error ?? 'Error al crear.'); setCreating(false); return }

    await syncPrices(res.data.id, newEntries, [])

    // Recargar precios del nuevo cliente
    const pricesRes = await window.hw.getSpecialCustomerPrices({ specialCustomerId: res.data.id })
    setCreating(false)
    setCustomers(prev => [...prev, res.data])
    setAllPrices(prev => ({ ...prev, [res.data.id]: pricesRes.ok ? pricesRes.data : [] }))
    setNewName(''); setNewNotes(''); setNewEntries([]); setShowCreate(false)
  }

  const handleSaveCustomer = useCallback(async (id: string, name: string, notes: string, entries: PriceEntry[]) => {
    const res = await window.hw.updateSpecialCustomer({ id, name, notes: notes || undefined })
    if (!res.ok) throw new Error(res.error ?? 'Error al actualizar.')

    await syncPrices(id, entries, allPrices[id] ?? [])

    const pricesRes = await window.hw.getSpecialCustomerPrices({ specialCustomerId: id })
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, name, notes: notes || null, updatedAt: new Date().toISOString() } : c))
    setAllPrices(prev => ({ ...prev, [id]: pricesRes.ok ? pricesRes.data : [] }))
  }, [allPrices])

  const handleDeleteCustomer = useCallback(async (id: string) => {
    const res = await window.hw.deleteSpecialCustomer({ id })
    if (!res.ok) return
    setCustomers(prev => prev.filter(c => c.id !== id))
    setAllPrices(prev => { const n = { ...prev }; delete n[id]; return n })
  }, [])

  const filtered = useMemo(() =>
    search.trim()
      ? customers.filter(c =>
          c.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            .includes(search.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())
        )
      : customers,
    [customers, search]
  )

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => setSearch(value), 150)
  }, [])

  return (
    <div className="flex flex-col flex-1 h-full bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-gray-800 bg-gray-900 px-6 py-4">
        {onBack && (
          <button onClick={onBack} className="rounded-lg p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors">
            ←
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-white">Clientes especiales</h1>
          <p className="text-xs text-gray-500">
            Precios de referencia · {isAdmin ? 'modo admin' : 'solo lectura'}
          </p>
        </div>
        {isAdmin && availableStores.length > 0 && (
          <StoreFilter
            stores={availableStores}
            value={storeIdFilter}
            onChange={v => setStoreIdFilter(v)}
          />
        )}
        {isAdmin && (
          <button
            onClick={() => { setShowCreate(v => !v); setCreateError(null); setNewEntries([]) }}
            className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 transition-colors"
          >
            {showCreate ? 'Cancelar' : '+ Nuevo cliente'}
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

      {/* Formulario de creación */}
      {showCreate && isAdmin && (
        <div className="mx-6 mt-4 rounded-xl border border-amber-700/50 bg-amber-900/10 p-4 space-y-4">
          <p className="text-sm font-semibold text-amber-300">Nuevo cliente especial</p>
          <div className="space-y-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Nombre *"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
            />
            <textarea
              value={newNotes}
              onChange={e => setNewNotes(e.target.value)}
              rows={2}
              placeholder="Notas generales (opcional)"
              maxLength={300}
              className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
            />
          </div>
          <PriceEditor
            products={products}
            initial={[]}
            isAdmin={true}
            onChange={setNewEntries}
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
              onClick={() => { setShowCreate(false); setNewName(''); setNewNotes(''); setNewEntries([]); setCreateError(null) }}
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
              : 'Ningún cliente coincide con la búsqueda.'}
          </p>
        )}
        {filtered.map(customer => (
          <SpecialCustomerCard
            key={customer.id}
            customer={customer}
            prices={allPrices[customer.id] ?? []}
            products={products}
            isAdmin={isAdmin}
            onSave={handleSaveCustomer}
            onDelete={handleDeleteCustomer}
          />
        ))}
      </div>
    </div>
  )
}
