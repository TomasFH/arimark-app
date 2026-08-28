import { useState, useEffect, useCallback, useMemo } from 'react'
import { useOnlineStatus } from '../../lib/connectivity'
import { useBackLayer } from '../../lib/backStack'
import {
  ScreenHeader,
  OfflineBanner,
  ErrorBanner,
  Spinner,
  EmptyState,
  Modal,
  ConfirmModal,
  Btn,
} from './shared'
import {
  fetchSpecialCustomers,
  fetchAllSpecialCustomerPrices,
  createSpecialCustomer,
  updateSpecialCustomer,
  upsertSpecialCustomerPrice,
  softDeleteSpecialCustomerPrice,
  softDeleteSpecialCustomer,
  formatMoney,
  type SpecialCustomer,
  type SpecialCustomerPrice,
} from '../../lib/adminFirestore'
import {
  fetchMergedCatalogFromFirestore,
  catalogTypeaheadMatches,
} from '../../lib/catalog'
import { parseNumericInput, formatNumericInputValue } from '../../lib/numericInput'
import NumericInput from '../NumericInput'
import type { CatalogProduct, LocalProfile } from '../../types/pos'

interface Props {
  onBack: () => void
  profile: LocalProfile
}

function formatModDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

interface PriceEntry {
  productId: string
  productName: string
  pluNumber: number
  originalPrice: number | null
  specialPriceRaw: string
  notes: string
  existingId?: string
}

function pricesToEntries(
  prices: SpecialCustomerPrice[],
  catalog: CatalogProduct[],
): PriceEntry[] {
  return prices.map(p => {
    const prod = catalog.find(pr => pr.productId === p.productId)
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

export function SpecialCustomersScreen({ onBack, profile }: Props) {
  const online = useOnlineStatus()
  useBackLayer(true, onBack)

  const [customers, setCustomers] = useState<SpecialCustomer[]>([])
  const [allPrices, setAllPrices] = useState<Record<string, SpecialCustomerPrice[]>>({})
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SpecialCustomer | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SpecialCustomer | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, prices, products] = await Promise.all([
        fetchSpecialCustomers(),
        fetchAllSpecialCustomerPrices(),
        fetchMergedCatalogFromFirestore(),
      ])
      setCustomers(list)
      setAllPrices(prices)
      setCatalog(products)
    } catch {
      setError('No se pudieron cargar los clientes especiales.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(c =>
      c.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .includes(q.normalize('NFD').replace(/[\u0300-\u036f]/g, '')),
    )
  }, [customers, search])

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(customer: SpecialCustomer) {
    setEditing(customer)
    setFormOpen(true)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <ScreenHeader
        title="Clientes especiales"
        subtitle="Precios de referencia · modo admin"
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={openCreate}
            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
          >
            + Nuevo cliente
          </button>
        }
      />

      {!online && <OfflineBanner />}

      <div className="mx-4 mt-4 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5">
        <p className="text-xs text-zinc-500">
          Esta sección lista los acuerdos. En caja, la cajera consulta acá y controla que el ticket coincida; los precios de lista del POS no se cambian solos.
        </p>
      </div>

      <div className="px-4 mt-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filtrar por nombre..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
        />
      </div>

      <main className="flex-1 px-4 py-4 space-y-3">
        {error && <ErrorBanner message={error} onRetry={load} />}
        {loading && <Spinner />}
        {!loading && !error && displayed.length === 0 && (
          <EmptyState
            message={
              customers.length === 0
                ? 'No hay clientes especiales registrados.'
                : 'Ningún cliente coincide con la búsqueda.'
            }
          />
        )}
        {displayed.map(customer => (
          <SpecialCustomerCard
            key={customer.id}
            customer={customer}
            prices={allPrices[customer.id] ?? []}
            catalog={catalog}
            onEdit={openEdit}
            onDelete={setPendingDelete}
          />
        ))}
      </main>

      {formOpen && (
        <CustomerFormModal
          customer={editing}
          catalog={catalog}
          initialPrices={editing ? pricesToEntries(allPrices[editing.id] ?? [], catalog) : []}
          updatedBy={profile.uid}
          onClose={() => { setFormOpen(false); setEditing(null) }}
          onSaved={async () => {
            setFormOpen(false)
            setEditing(null)
            await load()
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          title="Eliminar cliente"
          message={`¿Eliminar a ${pendingDelete.name}? Se borran también sus precios especiales.`}
          confirmLabel="Eliminar"
          danger
          onClose={() => setPendingDelete(null)}
          onConfirm={async () => {
            await softDeleteSpecialCustomer(pendingDelete.id)
            setCustomers(prev => prev.filter(c => c.id !== pendingDelete.id))
            setAllPrices(prev => {
              const next = { ...prev }
              delete next[pendingDelete.id]
              return next
            })
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tarjeta acordeón (misma idea que PC)
// ---------------------------------------------------------------------------

interface CardProps {
  customer: SpecialCustomer
  prices: SpecialCustomerPrice[]
  catalog: CatalogProduct[]
  onEdit: (customer: SpecialCustomer) => void
  onDelete: (customer: SpecialCustomer) => void
}

function SpecialCustomerCard({ customer, prices, catalog, onEdit, onDelete }: CardProps) {
  const [expanded, setExpanded] = useState(false)
  const updatedDate = formatModDate(customer.updatedAt)

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-800 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-100 truncate" title={customer.name}>
            {customer.name}
          </p>
          {customer.notes && (
            <p className="text-xs text-zinc-400 mt-0.5 truncate" title={customer.notes}>
              {customer.notes}
            </p>
          )}
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
          <span
            role="button"
            onClick={e => { e.stopPropagation(); onEdit(customer) }}
            className="text-zinc-500 hover:text-zinc-300 text-xs px-1.5 py-0.5 rounded border border-zinc-700 hover:border-zinc-500 transition-colors"
          >
            ✏️
          </span>
          <span
            role="button"
            onClick={e => { e.stopPropagation(); onDelete(customer) }}
            className="text-zinc-600 hover:text-red-400 text-xs px-1.5 py-0.5 rounded border border-zinc-700 hover:border-red-700 transition-colors"
          >
            🗑
          </span>
          <span className="text-zinc-600 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-2">
          {prices.length === 0 ? (
            <p className="text-xs text-zinc-600 italic py-1">Sin precios especiales registrados.</p>
          ) : (
            <div className="space-y-1.5 py-1">
              {prices.map(p => {
                const prod = catalog.find(pr => pr.productId === p.productId)
                const modDate = formatModDate(p.updatedAt)
                return (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-xs min-w-0">
                    <div className="min-w-0 flex-1">
                      <span className="text-zinc-100 truncate block" title={p.productName}>
                        {p.productName}
                      </span>
                      <span className="text-zinc-600">PLU {prod?.pluNumber ?? '?'}</span>
                      {prod?.price != null && (
                        <span className="ml-1.5 text-zinc-500">lista: {formatMoney(prod.price)}</span>
                      )}
                      {p.notes && (
                        <span className="ml-1.5 text-zinc-500 truncate" title={p.notes}> — {p.notes}</span>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-semibold text-zinc-300">{formatMoney(p.specialPrice)}</span>
                      {modDate && <span className="ml-2 text-zinc-600">{modDate}</span>}
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
// Typeahead de productos — catálogo completo, PLU asc
// ---------------------------------------------------------------------------

interface ProductTypeaheadProps {
  catalog: CatalogProduct[]
  excludeIds: string[]
  onSelect: (product: CatalogProduct) => void
}

function ProductTypeahead({ catalog, excludeIds, onSelect }: ProductTypeaheadProps) {
  const [query, setQuery] = useState('')

  const matches = useMemo(
    () => catalogTypeaheadMatches(catalog, query, excludeIds),
    [catalog, excludeIds, query],
  )

  return (
    <div className="space-y-1">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Buscar por nombre o PLU..."
        autoFocus
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
      {matches.length === 0 ? (
        <p className="text-xs text-zinc-600 px-1 py-2 italic">
          {query ? 'Sin coincidencias.' : 'Sin productos en el catálogo.'}
        </p>
      ) : (
        <ul className="max-h-44 overflow-y-auto rounded-lg border border-zinc-700 divide-y divide-zinc-800">
          {matches.map(p => (
            <li key={p.productId}>
              <button
                type="button"
                onClick={() => { onSelect(p); setQuery('') }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800 transition-colors"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-100" title={p.name}>
                  {p.name}
                </span>
                <span className="shrink-0 text-xs text-zinc-500">
                  PLU {p.pluNumber}
                  {p.price != null && (
                    <span className="ml-2 text-zinc-400">{formatMoney(p.price)}</span>
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
// Editor de precios inline (creación y edición)
// ---------------------------------------------------------------------------

interface PriceEditorProps {
  catalog: CatalogProduct[]
  entries: PriceEntry[]
  onChange: (entries: PriceEntry[]) => void
}

function PriceEditor({ catalog, entries, onChange }: PriceEditorProps) {
  const [showSearch, setShowSearch] = useState(false)

  function handleAddProduct(product: CatalogProduct) {
    onChange([
      ...entries,
      {
        productId: product.productId,
        productName: product.name,
        pluNumber: product.pluNumber,
        originalPrice: product.price,
        specialPriceRaw: product.price != null
          ? formatNumericInputValue(String(Math.round(product.price)))
          : '',
        notes: '',
      },
    ])
    setShowSearch(false)
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
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-zinc-100 truncate" title={entry.productName}>
                {entry.productName}
              </span>
              <span className="ml-2 text-xs text-zinc-500">PLU {entry.pluNumber}</span>
              {entry.originalPrice != null && (
                <span className="ml-2 text-xs text-zinc-500">
                  Precio lista: <span className="text-zinc-400">{formatMoney(entry.originalPrice)}</span>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => onChange(entries.filter(e => e.productId !== entry.productId))}
              className="shrink-0 text-zinc-600 hover:text-red-400 text-xs transition-colors"
            >
              ✕
            </button>
          </div>
          <div className="flex gap-2 min-w-0">
            <div className="relative w-32 shrink-0">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">$</span>
              <NumericInput
                value={entry.specialPriceRaw}
                onChange={raw => onChange(entries.map(e =>
                  e.productId === entry.productId ? { ...e, specialPriceRaw: raw } : e,
                ))}
                placeholder="Precio especial"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 pl-6 pr-2 py-1.5 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <input
              type="text"
              value={entry.notes}
              onChange={e => onChange(entries.map(en =>
                en.productId === entry.productId ? { ...en, notes: e.target.value } : en,
              ))}
              placeholder="Nota (opcional)"
              maxLength={120}
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </div>
        </div>
      ))}

      {showSearch ? (
        <div className="rounded-lg border border-dashed border-zinc-700/40 p-3 space-y-2">
          <ProductTypeahead
            catalog={catalog}
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
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Crear / editar
// ---------------------------------------------------------------------------

interface FormProps {
  customer: SpecialCustomer | null
  catalog: CatalogProduct[]
  initialPrices: PriceEntry[]
  updatedBy: string
  onClose: () => void
  onSaved: () => Promise<void>
}

function CustomerFormModal({
  customer,
  catalog,
  initialPrices,
  updatedBy,
  onClose,
  onSaved,
}: FormProps) {
  const [name, setName] = useState(customer?.name ?? '')
  const [notes, setNotes] = useState(customer?.notes ?? '')
  const [entries, setEntries] = useState<PriceEntry[]>(initialPrices)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setErr('El nombre no puede estar vacío.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const id = customer
        ? customer.id
        : await createSpecialCustomer({
            name: name.trim(),
            notes: notes.trim() || null,
            createdBy: updatedBy,
          })

      if (customer) {
        await updateSpecialCustomer(id, {
          name: name.trim(),
          notes: notes.trim() || null,
          updatedBy,
        })
      }

      const current = initialPrices
      for (const old of current) {
        if (!entries.find(e => e.productId === old.productId) && old.existingId) {
          await softDeleteSpecialCustomerPrice(old.existingId)
        }
      }

      for (const entry of entries) {
        const price = parseNumericInput(entry.specialPriceRaw)
        if (!price || price <= 0) continue
        await upsertSpecialCustomerPrice({
          id: entry.existingId,
          specialCustomerId: id,
          productId: entry.productId,
          productName: entry.productName,
          specialPrice: price,
          notes: entry.notes.trim() || null,
          updatedBy,
        })
      }

      await onSaved()
    } catch {
      setErr(customer ? 'No se pudo guardar el cliente.' : 'No se pudo crear el cliente.')
      setSaving(false)
    }
  }

  return (
    <Modal
      title={customer ? 'Editar cliente especial' : 'Nuevo cliente especial'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Nombre *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nombre *"
            autoFocus
            maxLength={100}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            Notas generales <span className="text-zinc-600">(opcional)</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="Notas generales (opcional)"
            maxLength={300}
            className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
        </div>
        <PriceEditor
          catalog={catalog}
          entries={entries}
          onChange={setEntries}
        />
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex gap-2">
          <Btn type="submit" className="flex-1" loading={saving}>
            {customer ? 'Guardar' : 'Crear'}
          </Btn>
          <Btn variant="ghost" className="flex-1" onClick={onClose} disabled={saving}>Cancelar</Btn>
        </div>
      </form>
    </Modal>
  )
}
