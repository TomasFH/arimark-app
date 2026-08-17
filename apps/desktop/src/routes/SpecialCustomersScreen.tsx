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
import BackButton from '../components/BackButton'
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
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
      {matches.length === 0 ? (
        <p className="text-xs text-zinc-600 px-1 py-2 italic">
          {query ? 'Sin coincidencias.' : 'Sin productos disponibles.'}
        </p>
      ) : (
        <ul className="max-h-44 overflow-y-auto rounded-lg border border-zinc-700 divide-y divide-zinc-800">
          {matches.map(p => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => { onSelect(p); setQuery('') }}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-zinc-800 transition-colors"
              >
                <span className="text-sm text-white">{p.name}</span>
                <span className="text-xs text-zinc-500 shrink-0 ml-2">
                  PLU {p.pluNumber}
                  {p.price != null && (
                    <span className="ml-2 text-zinc-400">{formatARS(p.price)}</span>
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
      <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
        Precios especiales
      </p>

      {entries.length === 0 && (
        <p className="text-xs text-zinc-600 italic">Sin precios especiales agregados.</p>
      )}

      {entries.map(entry => (
        <div key={entry.productId} className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-sm font-medium text-white">{entry.productName}</span>
              <span className="ml-2 text-xs text-zinc-500">PLU {entry.pluNumber}</span>
              {entry.originalPrice != null && (
                <span className="ml-2 text-xs text-zinc-500">
                  Precio lista: <span className="text-zinc-400">{formatARS(entry.originalPrice)}</span>
                </span>
              )}
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => handleRemove(entry.productId)}
                className="shrink-0 text-zinc-600 hover:text-red-400 text-xs transition-colors"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <div className="relative w-36 shrink-0">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">$</span>
              {isAdmin ? (
                <NumericInput
                  value={entry.specialPriceRaw}
                  onChange={raw => handlePriceChange(entry.productId, raw)}
                  placeholder="Precio especial"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 pl-6 pr-2 py-1.5 text-sm text-white focus:border-zinc-500 focus:outline-none"
                />
              ) : (
                <span className="pl-6 py-1.5 text-sm text-zinc-300 font-semibold">
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
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            ) : (
              entry.notes && (
                <span className="flex-1 text-xs text-zinc-400 py-1.5">{entry.notes}</span>
              )
            )}
          </div>
        </div>
      ))}

      {isAdmin && (
        showSearch ? (
          <div className="rounded-lg border border-dashed border-zinc-700/40 p-3 space-y-2">
            <ProductTypeahead
              products={products}
              excludeIds={excludedIds}
              onSelect={handleAddProduct}
            />
            <button
              type="button"
              onClick={() => setShowSearch(false)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowSearch(true)}
            className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
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
  onEdit: (customer: SpecialCustomerRow) => void
  onDelete: (id: string) => void
}

function SpecialCustomerCard({ customer, prices, products, isAdmin, onEdit, onDelete }: CustomerCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const updatedDate = customer.updatedAt
    ? new Date(customer.updatedAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : null

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate" title={customer.name}>{customer.name}</p>
          {customer.notes && <p className="text-xs text-zinc-400 mt-0.5 truncate" title={customer.notes}>{customer.notes}</p>}
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {updatedDate && (
              <span className="text-xs text-zinc-600">Modificado: {updatedDate}</span>
            )}
          </div>
          {!expanded && prices.length > 0 && (
            <p className="text-xs text-zinc-600 mt-0.5">
              {prices.length} precio{prices.length > 1 ? 's' : ''} especial{prices.length > 1 ? 'es' : ''} · tocá para ver
            </p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1.5 pt-0.5">
          {isAdmin && (
            <>
              <span
                role="button"
                onClick={e => { e.stopPropagation(); onEdit(customer) }}
                className="text-zinc-500 hover:text-zinc-300 text-xs px-1.5 py-0.5 rounded border border-zinc-700 hover:border-zinc-500 transition-colors"
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
                    className="text-xs text-zinc-500 hover:text-zinc-300 px-1">
                    ✕
                  </button>
                </div>
              ) : (
                <span
                  role="button"
                  onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
                  className="text-zinc-600 hover:text-red-400 text-xs px-1.5 py-0.5 rounded border border-zinc-700 hover:border-red-700 transition-colors"
                >
                  🗑
                </span>
              )}
            </>
          )}
          <span className="text-zinc-600 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Detalle de precios — se muestra solo cuando expanded */}
      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-2">
          {prices.length === 0 ? (
            <p className="text-xs text-zinc-600 italic py-1">Sin precios especiales registrados.</p>
          ) : (
            <div className="space-y-1.5 py-1">
              {prices.map(p => {
                const prod = products.find(pr => pr.id === p.productId)
                const modDate = new Date(p.updatedAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                return (
                  <div key={p.productId} className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <span className="text-white">{p.productName}</span>
                      <span className="ml-1.5 text-zinc-600">PLU {prod?.pluNumber ?? '?'}</span>
                      {prod?.price != null && (
                        <span className="ml-1.5 text-zinc-500">lista: {formatARS(prod.price)}</span>
                      )}
                      {p.notes && <span className="ml-1.5 text-zinc-500">— {p.notes}</span>}
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-semibold text-zinc-300">{formatARS(p.specialPrice)}</span>
                      <span className="ml-2 text-zinc-600">{modDate}</span>
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

  const [formOpen, setFormOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<SpecialCustomerRow | null>(null)
  const [formName, setFormName] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formEntries, setFormEntries] = useState<PriceEntry[]>([])
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.hw.getProducts().then(res => {
      if (res.ok) setProducts(res.data)
    })
  }, [])

  useEffect(() => {
    void loadAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadAll() {
    setLoading(true); setError(null)
    const res = await window.hw.listSpecialCustomers()
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

  function pricesToEntries(prices: SpecialCustomerPriceRow[]): PriceEntry[] {
    return prices.map(p => {
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
    })
  }

  function openCreate() {
    setEditingCustomer(null)
    setFormName('')
    setFormNotes('')
    setFormEntries([])
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(customer: SpecialCustomerRow) {
    setEditingCustomer(customer)
    setFormName(customer.name)
    setFormNotes(customer.notes ?? '')
    setFormEntries(pricesToEntries(allPrices[customer.id] ?? []))
    setFormError(null)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingCustomer(null)
    setFormName('')
    setFormNotes('')
    setFormEntries([])
    setFormError(null)
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

  async function handleSubmitForm() {
    if (!formName.trim()) { setFormError('El nombre no puede estar vacío.'); return }
    setFormSaving(true)
    setFormError(null)

    if (editingCustomer) {
      const res = await window.hw.updateSpecialCustomer({
        id: editingCustomer.id,
        name: formName.trim(),
        notes: formNotes.trim() || undefined,
      })
      if (!res.ok) { setFormError(res.error ?? 'Error al actualizar.'); setFormSaving(false); return }
      await syncPrices(editingCustomer.id, formEntries, allPrices[editingCustomer.id] ?? [])
      const pricesRes = await window.hw.getSpecialCustomerPrices({ specialCustomerId: editingCustomer.id })
      setCustomers(prev => prev.map(c =>
        c.id === editingCustomer.id
          ? { ...c, name: formName.trim(), notes: formNotes.trim() || null, storeId: null, updatedAt: new Date().toISOString() }
          : c
      ))
      setAllPrices(prev => ({ ...prev, [editingCustomer.id]: pricesRes.ok ? pricesRes.data : [] }))
    } else {
      const res = await window.hw.createSpecialCustomer({
        name: formName.trim(),
        notes: formNotes.trim() || undefined,
      })
      if (!res.ok) { setFormError(res.error ?? 'Error al crear.'); setFormSaving(false); return }
      await syncPrices(res.data.id, formEntries, [])
      const pricesRes = await window.hw.getSpecialCustomerPrices({ specialCustomerId: res.data.id })
      setCustomers(prev => [...prev, res.data])
      setAllPrices(prev => ({ ...prev, [res.data.id]: pricesRes.ok ? pricesRes.data : [] }))
    }

    setFormSaving(false)
    closeForm()
  }

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
    <div className="flex flex-col flex-1 h-full bg-zinc-950 text-white">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/50 px-6 py-3 shrink-0">
        {onBack && <BackButton onClick={onBack} />}
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-zinc-100">Clientes especiales</h1>
          <p className="text-[10px] text-zinc-500">
            Precios de referencia · {isAdmin ? 'modo admin' : 'solo lectura'}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={openCreate}
            className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
          >
            + Nuevo cliente
          </button>
        )}
      </header>

      {/* Info banner */}
      <div className="mx-6 mt-4 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2.5">
        <p className="text-xs text-zinc-500">
          Esta sección es informativa. Los precios especiales <strong className="text-zinc-400">no modifican</strong> el carrito automáticamente.
          La cajera los consulta para confirmar si el ticket coincide con el acuerdo de ese cliente.
        </p>
      </div>

      {/* Buscador */}
      <div className="px-6 mt-4">
        <input
          type="text"
          onChange={handleSearchChange}
          placeholder="Filtrar por nombre..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
        />
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {loading && <p className="text-center text-zinc-500 py-8">Cargando…</p>}
        {error && <p className="text-center text-red-400 py-8">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="text-center text-zinc-600 py-8 italic">
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
            onEdit={openEdit}
            onDelete={handleDeleteCustomer}
          />
        ))}
      </div>

      {formOpen && isAdmin && (
        <div
          className="fixed inset-0 z-40 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={e => { if (e.target === e.currentTarget && !formSaving) closeForm() }}
        >
          <div className="w-full sm:max-w-lg bg-zinc-900 rounded-t-2xl sm:rounded-2xl border border-zinc-800 max-h-[92vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {editingCustomer ? 'Editar cliente especial' : 'Nuevo cliente especial'}
              </h2>
              <button
                onClick={closeForm}
                disabled={formSaving}
                className="text-zinc-400 hover:text-white text-xl disabled:opacity-40"
              >
                ×
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Nombre *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Nombre *"
                  autoFocus
                  maxLength={100}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Notas generales <span className="text-zinc-600">(opcional)</span></label>
                <textarea
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  rows={2}
                  placeholder="Notas generales (opcional)"
                  maxLength={300}
                  className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
                />
              </div>
              <PriceEditor
                key={editingCustomer?.id ?? 'new'}
                products={products}
                initial={formEntries}
                isAdmin={true}
                onChange={setFormEntries}
              />
              {formError && <p className="text-xs text-red-400">{formError}</p>}
            </div>

            <div className="px-5 py-4 border-t border-zinc-800 flex gap-2">
              <button
                onClick={handleSubmitForm}
                disabled={formSaving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {formSaving ? 'Guardando…' : editingCustomer ? 'Guardar' : 'Crear'}
              </button>
              <button
                onClick={closeForm}
                disabled={formSaving}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:text-white disabled:opacity-40"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
