/**
 * Panel de catálogo de productos.
 *
 * Admin: todos los locales, KRETZ, versiones, retiro global.
 * Cajera: solo su local (precio, visibilidad, KRETZ); puede crear/editar ficha.
 * Versiones y retiro global: solo admin.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import NumericInput from '../components/NumericInput'
import KretzSyncModal from '../components/KretzSyncModal'
import CatalogToggle from '../components/CatalogToggle'
import { ActionMenu, Button, Modal, ScreenHeader } from '../components/ui'
import { parseNumericInput, formatNumericInputValue } from '../lib/numericInput'
import { useAvailabilityToggle } from '../lib/useAvailabilityToggle'
import type {
  AdminProductRow,
  StoreRow,
  CreateProductPayload,
  UpdateProductPayload,
  PriceHistoryRow,
  SessionInfo,
  CatalogRevisionRow,
  CatalogAuditRow,
  CatalogAuditAction,
} from '../types/hw-api'

const CATEGORIES: { value: AdminProductRow['category']; label: string }[] = [
  { value: 'beef_cut', label: 'Vacuno' },
  { value: 'poultry',  label: 'Aves' },
  { value: 'pork',     label: 'Cerdo' },
  { value: 'other',    label: 'Otros' },
  { value: 'bags',     label: 'Bolsas' },
]

const CATEGORY_LABELS: Record<AdminProductRow['category'], string> = {
  beef_cut: 'Vacuno',
  poultry:  'Aves',
  pork:     'Cerdo',
  other:    'Otros',
  bags:     'Bolsas',
}

function fmtARS(n: number) {
  return `$${n.toLocaleString('es-AR')}`
}

function CatalogColgroup() {
  return (
    <colgroup>
      <col className="w-16" />
      <col />
      <col className="w-28" />
      <col className="w-20" />
      <col className="w-28" />
      <col className="w-24" />
      <col className="w-20" />
    </colgroup>
  )
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

export default function AdminScreen({ session, onLogout, onReturnToHub }: Props) {
  const isAdmin = session.role === 'admin'
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
  
  const [showRevisions, setShowRevisions] = useState(false)
  const [globalDeleteProduct, setGlobalDeleteProduct] = useState<AdminProductRow | null>(null)
  const [globalDeleting, setGlobalDeleting] = useState(false)

  // Edición masiva
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkDraft, setBulkDraft] = useState<Map<string, string>>(new Map())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [pendingStoreId, setPendingStoreId] = useState<string | null>(null)

  // Filtro
  const [filterText, setFilterText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const [sortKey, setSortKey] = useState<'plu' | 'name' | 'category' | 'unit' | 'price' | 'available'>('plu')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    window.hw.getStores().then(r => {
      const all = r.ok ? r.data : []
      if (!isAdmin && session.storeId) {
        const own = all.filter(s => s.id === session.storeId)
        setStores(own.length > 0 ? own : [{ id: session.storeId, name: 'Este local' }])
        setSelectedStoreId(session.storeId)
        return
      }
      if (all.length > 0) {
        setStores(all)
        setSelectedStoreId(all[0]!.id)
      }
    })
  }, [isAdmin, session.storeId])

  const loadProducts = useCallback(async (storeId: string, opts?: { silent?: boolean }) => {
    if (!storeId) return
    const scrollTop = opts?.silent ? (listRef.current?.scrollTop ?? 0) : null
    if (!opts?.silent) setLoading(true)
    setError(null)
    const r = await window.hw.getAllProducts(storeId)
    if (!r) return
    if (r.ok) setProducts(r.data)
    else setError(r.error)
    if (!opts?.silent) setLoading(false)
    if (scrollTop !== null) {
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = scrollTop
      })
    }
  }, [])

  const { toggleAvailability, isAvailabilityPending, hasAvailabilityPending } = useAvailabilityToggle(
    selectedStoreId,
    setProducts,
    setError,
  )

  useEffect(() => {
    if (selectedStoreId) void loadProducts(selectedStoreId)
  }, [selectedStoreId, loadProducts])

  useEffect(() => {
    if (!selectedStoreId) return
    const unsub = window.hw.onCatalogSyncUpdated?.((payload?: { storeId?: string }) => {
      if (payload?.storeId && payload.storeId !== selectedStoreId) return
      if (hasAvailabilityPending()) return
      void loadProducts(selectedStoreId, { silent: true })
    })
    return () => { unsub?.() }
  }, [selectedStoreId, loadProducts, hasAvailabilityPending])

  // Al cambiar de local se reemplaza el useEffect que cancelaba automáticamente el modo
  // masivo. Ahora se intercepta el cambio si hay modificaciones pendientes sin guardar.

  const filtered = products.filter(p => {
    const q = normalize(filterText)
    return normalize(p.name).includes(q) || String(p.pluNumber ?? '').includes(q)
  }).slice().sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    const cmp = (av: string | number | boolean | null, bv: string | number | boolean | null): number => {
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      if (typeof av === 'boolean' && typeof bv === 'boolean') return (Number(av) - Number(bv)) * dir
      return String(av).localeCompare(String(bv), 'es') * dir
    }
    switch (sortKey) {
      case 'plu': return cmp(a.pluNumber, b.pluNumber)
      case 'name': return cmp(a.name, b.name)
      case 'category': return cmp(CATEGORY_LABELS[a.category], CATEGORY_LABELS[b.category])
      case 'unit': return cmp(a.unit, b.unit)
      case 'price': return cmp(a.price, b.price)
      case 'available': return cmp(a.available, b.available)
    }
  })

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  /** Baja global: el producto deja de existir en el catálogo y libera el PLU. */
  async function confirmGlobalDelete() {
    if (!globalDeleteProduct) return
    setGlobalDeleting(true)
    const r = await window.hw.updateProduct({ id: globalDeleteProduct.id, active: false, pluNumber: null })
    setGlobalDeleting(false)
    if (r.ok) {
      setGlobalDeleteProduct(null)
      setEditProduct(null)
      void loadProducts(selectedStoreId, { silent: true })
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
    const r = await window.hw.setProductPrices({ storeId: selectedStoreId, items: changes })
    setBulkSaving(false)
    setBulkMode(false)
    setBulkDraft(new Map())
    if (!r.ok) setError(r.error)
    void loadProducts(selectedStoreId, { silent: true })
  }

  const pendingChanges = [...bulkDraft.entries()].filter(([productId, raw]) => {
    const parsed = parseNumericInput(raw)
    if (parsed === null) return false
    const original = products.find(p => p.id === productId)?.price ?? null
    return parsed !== original
  }).length

  const catalogOverflow = [
    ...(isAdmin
      ? [{ id: 'revisions', label: 'Versiones', onSelect: () => setShowRevisions(true) }]
      : []),
    { id: 'bulk', label: 'Editar precios', onSelect: () => { setBulkMode(true); setBulkDraft(new Map()) } },
    { id: 'sync', label: 'Cargar en balanza', onSelect: () => setShowSync(true) },
  ]

  return (
    <div className="flex flex-col h-screen bg-app text-ink">
      <ScreenHeader
        title={isAdmin ? 'Administración — Productos' : 'Catálogo'}
        subtitle={stores.length === 1 ? stores[0]?.name : undefined}
        onBack={onReturnToHub}
        actions={
          <Button variant="ghost" size="sm" onClick={onLogout}>Cerrar sesión</Button>
        }
      />

      <div className="flex shrink-0 items-center gap-2 px-6 pt-4 pb-3">
        {isAdmin && stores.length > 1 && (
          <label className="flex min-w-0 shrink-0 items-center gap-2">
            <span className="text-xs text-muted">Local</span>
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
              className="rounded-lg border border-line bg-input px-2 py-2 text-xs text-ink"
            >
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <input
          type="text"
          placeholder="Buscar por nombre o PLU…"
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-line bg-input px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-line-accent"
        />

        {bulkMode ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setBulkMode(false); setBulkDraft(new Map()) }}
              disabled={bulkSaving}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => void handleBulkSave()}
              loading={bulkSaving}
              disabled={pendingChanges === 0}
            >
              {pendingChanges > 0
                ? `Guardar ${pendingChanges} cambio${pendingChanges !== 1 ? 's' : ''}`
                : 'Sin cambios'}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              + Nuevo producto
            </Button>
            <ActionMenu items={catalogOverflow} />
          </>
        )}
      </div>

      {bulkMode && (
        <div className="mx-6 mb-3 rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-2 text-xs text-amber-400/90">
          Modo edición masiva activo — modificá los precios en la tabla y guardá todos los cambios de una vez.
        </div>
      )}

      {error && (
        <div className="mx-6 mb-3 rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 px-6 pb-4">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="mt-16 text-center text-sm text-muted">
              {filterText ? 'Sin resultados para esa búsqueda.' : 'No hay productos cargados.'}
            </p>
          ) : (
            <>
              <div className="shrink-0 [scrollbar-gutter:stable]">
                <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
                  <CatalogColgroup />
                  <thead>
                    <tr className="text-left text-ink">
                      {([
                        { key: 'plu' as const, label: 'PLU' },
                        { key: 'name' as const, label: 'Nombre' },
                        { key: 'category' as const, label: 'Categoría' },
                        { key: 'unit' as const, label: 'Unidad' },
                        { key: 'price' as const, label: 'Precio', cls: 'text-right' },
                        { key: 'available' as const, label: 'Disponible', cls: 'text-center' },
                      ]).map(col => (
                        <th
                          key={col.key}
                          className={`bg-raised px-3 py-2.5 font-medium first:pl-4 ${col.cls ?? ''}`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className="inline-flex items-center gap-1 hover:text-ink"
                          >
                            {col.label}
                            {sortKey === col.key && (
                              <span className="text-[10px] text-muted">{sortDir === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </button>
                        </th>
                      ))}
                      <th className="bg-raised px-3 py-2.5 pr-4" />
                    </tr>
                  </thead>
                </table>
              </div>
              <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
                  <CatalogColgroup />
                  <tbody>
                {filtered.map((p, i) => {
                  const draftRaw = bulkDraft.get(p.id)
                  const draftParsed = draftRaw !== undefined ? parseNumericInput(draftRaw) : null
                  const isChanged = draftParsed !== null && draftParsed !== (p.price ?? null)
                  const rowBg = isChanged
                    ? 'bg-accent-soft group-hover:bg-accent-soft'
                    : i % 2 === 0
                      ? 'bg-panel group-hover:bg-hover'
                      : 'bg-app group-hover:bg-hover'

                  return (
                    <tr key={p.id} className="group">
                      <td className={`border-t border-line px-3 py-2.5 pl-4 tabular-nums text-muted ${rowBg}`}>
                        {p.pluNumber ?? <span className="text-subtle">—</span>}
                      </td>
                      <td className={`min-w-0 border-t border-line px-3 py-2.5 font-medium ${rowBg}`}>
                        <span className="block truncate" title={p.name}>{p.name}</span>
                      </td>
                      <td className={`border-t border-line px-3 py-2.5 text-muted ${rowBg}`}>
                        {CATEGORY_LABELS[p.category]}
                      </td>
                      <td className={`border-t border-line px-3 py-2.5 text-muted ${rowBg}`}>
                        {p.unit === 'kg' ? 'kg' : 'unidad'}
                      </td>
                      <td className={`border-t border-line px-3 py-1.5 text-right ${rowBg}`}>
                        {bulkMode ? (
                          <NumericInput
                            value={draftRaw ?? (p.price != null ? formatNumericInputValue(String(p.price)) : '')}
                            onChange={v => handleBulkDraftChange(p.id, v)}
                            className={`w-28 rounded border bg-raised px-2 py-1 text-right text-sm text-ink focus:outline-none focus:ring-1 ${isChanged ? 'border-line-accent focus:ring-accent/40' : 'border-line-strong focus:ring-accent/30'}`}
                            placeholder="—"
                          />
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setPriceProduct(p)}
                              className="tabular-nums text-ink hover:text-success transition-colors"
                              title="Cambiar precio"
                            >
                              {p.price != null ? fmtARS(p.price) : <span className="text-xs text-muted">Sin precio</span>}
                            </button>
                            <button
                              type="button"
                              onClick={() => setHistoryProduct(p)}
                              className="text-xs text-muted hover:text-ink transition-colors"
                              title="Ver historial de precios"
                            >
                              ↓
                            </button>
                          </div>
                        )}
                      </td>
                      <td className={`border-t border-line px-3 py-2.5 text-center ${rowBg}`}>
                        <CatalogToggle
                          checked={p.available}
                          disabled={isAvailabilityPending(p.id)}
                          onChange={() => void toggleAvailability(p)}
                        />
                      </td>
                      <td className={`border-t border-line px-3 py-2.5 pr-4 text-right ${rowBg}`}>
                        {!bulkMode && (
                          <button
                            type="button"
                            onClick={() => setEditProduct(p)}
                            className="rounded-lg px-2 py-1 text-xs text-ink hover:bg-hover hover:text-ink transition-colors"
                          >
                            Editar
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modales */}
      {showCreate && (
        <ProductFormModal storeId={selectedStoreId} stores={stores} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); void loadProducts(selectedStoreId, { silent: true }) }} />
      )}
      {editProduct && (
        <ProductFormModal
          storeId={selectedStoreId}
          stores={stores}
          product={editProduct}
          allowGlobalDelete={isAdmin}
          onClose={() => setEditProduct(null)}
          onSaved={() => { setEditProduct(null); void loadProducts(selectedStoreId, { silent: true }) }}
          onRequestGlobalDelete={isAdmin ? () => setGlobalDeleteProduct(editProduct) : undefined}
        />
      )}
      {priceProduct && (
        <PriceModal product={priceProduct} storeId={selectedStoreId} onClose={() => setPriceProduct(null)} onSaved={() => { setPriceProduct(null); void loadProducts(selectedStoreId, { silent: true }) }} />
      )}
      {showSync && (
        <KretzSyncModal storeId={selectedStoreId} store={stores.find(s => s.id === selectedStoreId)} onClose={() => setShowSync(false)} />
      )}
      {historyProduct && (
        <PriceHistoryModal product={historyProduct} storeId={selectedStoreId} onClose={() => setHistoryProduct(null)} />
      )}
      {isAdmin && globalDeleteProduct && (
        <GlobalDeleteProductModal
          product={globalDeleteProduct}
          deleting={globalDeleting}
          onConfirm={() => void confirmGlobalDelete()}
          onCancel={() => { if (!globalDeleting) setGlobalDeleteProduct(null) }}
        />
      )}
      {isAdmin && showRevisions && selectedStoreId && (
        <CatalogRevisionsModal
          storeId={selectedStoreId}
          storeName={stores.find(s => s.id === selectedStoreId)?.name ?? ''}
          onClose={() => setShowRevisions(false)}
          onRestored={() => { setShowRevisions(false); void loadProducts(selectedStoreId, { silent: true }) }}
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
// Modal crear/editar producto
// ---------------------------------------------------------------------------

interface ProductFormModalProps {
  storeId: string
  stores: StoreRow[]
  product?: AdminProductRow
  onClose: () => void
  onSaved: () => void
  /** Solo admin en edición: abre la confirmación de baja global (libera el PLU). */
  onRequestGlobalDelete?: () => void
  allowGlobalDelete?: boolean
}

const AUDIT_ACTION_LABELS: Record<CatalogAuditAction, string> = {
  create: 'Alta',
  update_identity: 'Ficha',
  hide_store: 'Oculto',
  show_store: 'Visible',
  retire_global: 'Retiro',
  restore_revision: 'Versión',
}

function CatalogAuditBlock({ productId, storeId }: { productId: string; storeId: string }) {
  const [rows, setRows] = useState<CatalogAuditRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.hw.listCatalogAudit({ productId, storeId }).then(r => {
      if (cancelled) return
      if (r.ok) setRows(r.data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [productId, storeId])

  if (loading) {
    return <p className="text-xs text-subtle">Cargando actividad…</p>
  }
  if (rows.length === 0) {
    return <p className="text-xs text-subtle">Sin cambios de ficha registrados.</p>
  }

  return (
    <div className="space-y-1.5 max-h-40 overflow-auto">
      {rows.map(row => (
        <div key={row.id} className="rounded-lg border border-line bg-raised px-3 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted">
              {AUDIT_ACTION_LABELS[row.action] ?? row.action}
            </span>
            <p className="min-w-0 flex-1 truncate text-xs text-ink" title={row.summary}>
              {row.summary}
            </p>
          </div>
          <p className="text-[10px] text-subtle mt-0.5 truncate" title={`${fmtDate(row.createdAt)} · ${row.actorName}`}>
            {fmtDate(row.createdAt)} · {row.actorName}
          </p>
        </div>
      ))}
    </div>
  )
}

function PriceHistoryBlock({ productId, storeId }: { productId: string; storeId: string }) {
  const [history, setHistory] = useState<PriceHistoryRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.hw.getProductPriceHistory({ productId, storeId }).then(r => {
      if (cancelled) return
      if (r.ok) setHistory(r.data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [productId, storeId])

  if (loading) {
    return <p className="text-xs text-subtle">Cargando precios…</p>
  }
  if (history.length === 0) {
    return <p className="text-xs text-subtle">Sin historial de precios para este local.</p>
  }

  return (
    <div className="space-y-2 max-h-40 overflow-auto">
      {history.map(h => (
        <div key={h.id} className={`rounded-lg border px-3 py-2 text-sm ${h.validTo == null ? 'border-line-accent bg-accent-soft' : 'border-line bg-raised'}`}>
          <div className="flex items-center justify-between">
            <span className="font-semibold tabular-nums">{fmtARS(h.price)}</span>
            {h.validTo == null
              ? <span className="text-xs text-success font-medium">Vigente</span>
              : <span className="text-xs text-muted">Hasta {fmtDate(h.validTo)}</span>}
          </div>
          <p className="text-xs text-muted mt-0.5 truncate" title={`Desde ${fmtDate(h.validFrom)} · Por ${h.createdBy}`}>
            Desde {fmtDate(h.validFrom)} · Por {h.createdBy}
          </p>
        </div>
      ))}
    </div>
  )
}

/** Ficha, visibilidad y precios: solo se piden a SQLite al expandir. */
function ProductHistoryDisclosure({ productId, storeId }: { productId: string; storeId: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-4 pt-3 border-t border-line">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="text-xs text-muted hover:text-ink transition-colors"
      >
        {open ? 'Ocultar historial' : 'Historial'}
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          <div>
            <p className="text-xs font-medium text-muted mb-2">Ficha y visibilidad</p>
            <CatalogAuditBlock productId={productId} storeId={storeId} />
          </div>
          <div>
            <p className="text-xs font-medium text-muted mb-2">Precios de este local</p>
            <PriceHistoryBlock productId={productId} storeId={storeId} />
          </div>
        </div>
      )}
    </div>
  )
}

export function ProductFormModal({ storeId, stores, product, onClose, onSaved, onRequestGlobalDelete, allowGlobalDelete }: ProductFormModalProps) {
  const isEdit = Boolean(product)
  const initialCategory = product?.category ?? 'beef_cut'
  const [name, setName] = useState(product?.name ?? '')
  const [category, setCategory] = useState<AdminProductRow['category']>(initialCategory)
  const [unit, setUnit] = useState<'kg' | 'unit'>(initialCategory === 'bags' ? 'unit' : (product?.unit ?? 'kg'))
  const [pluRaw, setPluRaw] = useState(product?.pluNumber != null ? String(product.pluNumber) : '')
  const [packLabel, setPackLabel] = useState(product?.purchasePackLabel ?? '')
  const [packContentsRaw, setPackContentsRaw] = useState(
    product?.purchasePackContents != null ? String(product.purchasePackContents) : '',
  )
  // Precio solo en creación: un campo compartido o uno por local
  const [samePriceAll, setSamePriceAll] = useState(true)
  const [sharedPriceRaw, setSharedPriceRaw] = useState('')
  const [perStorePriceRaw, setPerStorePriceRaw] = useState<Record<string, string>>(() =>
    Object.fromEntries(stores.map(s => [s.id, ''])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isEdit || !product) return
    let cancelled = false
    void (async () => {
      const results = await Promise.all(stores.map(s => window.hw.getAllProducts(s.id)))
      if (cancelled) return
      const prices: Record<string, string> = {}
      stores.forEach((s, i) => {
        const res = results[i]
        const row = res?.ok ? res.data.find(p => p.id === product.id) : undefined
        prices[s.id] = row?.price != null ? formatNumericInputValue(String(row.price)) : ''
      })
      setPerStorePriceRaw(prices)
      const vals = Object.values(prices).filter(v => v !== '')
      const allSame = vals.length > 0 && vals.every(v => v === vals[0])
      setSamePriceAll(allSame || stores.length <= 1)
      if (allSame) setSharedPriceRaw(vals[0] ?? '')
      else if (prices[storeId]) setSharedPriceRaw(prices[storeId] ?? '')
    })()
    return () => { cancelled = true }
  }, [isEdit, product, stores, storeId])
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
    const packContents = unit === 'unit' ? parseNumericInput(packContentsRaw) : null
    const packLabelValue = unit === 'unit' && packContents != null && packContents > 0
      ? (packLabel.trim() || 'Cajón')
      : null
    const packContentsValue = unit === 'unit' && packContents != null && packContents > 0 ? packContents : null
    setSaving(true)
    let productId: string | undefined
    if (isEdit && product) {
      const payload: UpdateProductPayload = { id: product.id }
      if (name !== product.name) payload.name = name
      if (category !== product.category) payload.category = category
      if (unit !== product.unit) payload.unit = unit
      if (pluNumber !== product.pluNumber) payload.pluNumber = pluNumber
      if (packLabelValue !== (product.purchasePackLabel ?? null)) payload.purchasePackLabel = packLabelValue
      if (packContentsValue !== (product.purchasePackContents ?? null)) payload.purchasePackContents = packContentsValue
      const r = await window.hw.updateProduct(payload)
      if (!r.ok) { setError(r.error); setSaving(false); return }
      productId = product.id
    } else {
      const payload: CreateProductPayload = {
        name: name.trim(),
        category,
        unit,
        pluNumber,
        purchasePackLabel: packLabelValue,
        purchasePackContents: packContentsValue,
      }
      const r = await window.hw.createProduct(payload)
      if (!r.ok) { setError(r.error); setSaving(false); return }
      productId = r.data.id
    }

    // Aplicar precios por local (alta y edición)
    if (productId) {
      const targets = resolvePriceTargets()
      const byStore = new Map<string, { productId: string; price: number }[]>()
      for (const t of targets) {
        const list = byStore.get(t.storeId) ?? []
        list.push({ productId, price: t.price })
        byStore.set(t.storeId, list)
      }
      for (const [targetStoreId, items] of byStore) {
        const pr = await window.hw.setProductPrices({ storeId: targetStoreId, items })
        if (!pr.ok) {
          setError(`No se pudo guardar el precio en un local: ${pr.error}`)
          setSaving(false)
          return
        }
      }
    }

    setSaving(false)
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Editar producto' : 'Nuevo producto'}
      footer={
        <>
          <Button variant="secondary" className="mr-auto" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} onClick={() => void handleSave()}>Guardar</Button>
        </>
      }
    >
        <div className="space-y-4">
          <Field label="Nombre">
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              maxLength={100}
              className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent/40"
              placeholder="Nombre del producto" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoría">
              <select
                value={category}
                onChange={e => {
                  const next = e.target.value as AdminProductRow['category']
                  setCategory(next)
                  if (next === 'bags') setUnit('unit')
                }}
                className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent/40">
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Unidad">
              <select
                value={unit}
                disabled={category === 'bags'}
                title={category === 'bags' ? 'Las bolsas se venden por unidad' : undefined}
                onChange={e => {
                  const next = e.target.value as 'kg' | 'unit'
                  setUnit(next)
                  if (next === 'kg') {
                    setPackLabel('')
                    setPackContentsRaw('')
                  }
                }}
                className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-70">
                {category !== 'bags' && <option value="kg">kg (pesable)</option>}
                <option value="unit">Unidad</option>
              </select>
            </Field>
          </div>
          {unit === 'unit' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pack de compra (opcional)">
                <input
                  type="text"
                  value={packLabel}
                  onChange={e => setPackLabel(e.target.value.slice(0, 40))}
                  maxLength={40}
                  className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent/40"
                  placeholder="Cajón"
                />
              </Field>
              <Field label="Unidades por pack">
                <NumericInput
                  value={packContentsRaw}
                  onChange={setPackContentsRaw}
                  className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent/40"
                  placeholder="12"
                />
              </Field>
            </div>
          )}
          <Field label="Número de PLU (1–999, opcional)">
            <input type="text" inputMode="numeric" value={pluRaw}
              onChange={e => setPluRaw(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent/40"
              placeholder="Sin asignar" />
          </Field>
          <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <p className="text-xs font-medium text-muted shrink-0">
                  Precio ($/{unitLabel}{isEdit ? '' : ', opcional'})
                </p>
                {stores.length > 1 && (
                  <label className="flex items-center gap-1.5 cursor-pointer select-none min-w-0">
                    <input
                      type="checkbox"
                      checked={samePriceAll}
                      onChange={e => handleToggleSamePrice(e.target.checked)}
                      className="shrink-0 accent-accent"
                    />
                    <span className="text-xs text-ink truncate" title="Usar el mismo precio en todos los locales">
                      Mismo precio en todos
                    </span>
                  </label>
                )}
              </div>

              {(samePriceAll || stores.length <= 1) ? (
                <NumericInput value={sharedPriceRaw} onChange={setSharedPriceRaw}
                  className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent/40"
                  placeholder="Dejar en blanco si no tiene precio aún" />
              ) : (
                <div className="rounded-lg border border-line bg-raised divide-y divide-line">
                  {stores.map(s => (
                    <div key={s.id} className="flex items-center gap-2 min-w-0 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-ink" title={s.name}>{s.name}</span>
                      <NumericInput
                        value={perStorePriceRaw[s.id] ?? ''}
                        onChange={v => setPerStorePriceRaw(prev => ({ ...prev, [s.id]: v }))}
                        className="w-28 shrink-0 bg-panel border border-line rounded-lg px-2 py-1.5 text-sm text-ink text-right focus:outline-none focus:ring-1 focus:ring-accent/40"
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
                <p className="text-xs text-subtle">Dejá en blanco los locales sin precio por ahora.</p>
              )}
            </div>
        </div>
        {error && <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
        {isEdit && product && (
          <ProductHistoryDisclosure productId={product.id} storeId={storeId} />
        )}

        {isEdit && allowGlobalDelete && onRequestGlobalDelete && (
          <div className="mt-5 pt-4 border-t border-line">
            <p className="text-xs text-subtle mb-2">Todos los locales</p>
            <button
              type="button"
              onClick={onRequestGlobalDelete}
              className="w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10"
            >
              Quitar del catálogo (libera el PLU en todos los locales)
            </button>
          </div>
        )}

        {isEdit && !allowGlobalDelete && product && (
          <div className="mt-5 pt-4 border-t border-line">
            <p className="text-xs text-subtle mb-2">Este local</p>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                void (async () => {
                  setSaving(true)
                  setError(null)
                  const next = !product.available
                  const r = await window.hw.setProductAvailability({
                    productId: product.id,
                    storeId,
                    available: next,
                  })
                  setSaving(false)
                  if (!r.ok) { setError(r.error); return }
                  onSaved()
                })()
              }}
              className="text-xs text-ink hover:text-ink hover:bg-hover px-3 py-1.5 rounded-lg transition-colors border border-line w-full"
            >
              {product.available ? 'Quitar de este local' : 'Mostrar en este local'}
            </button>
          </div>
        )}
    </Modal>
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

export function PriceModal({ product, storeId, onClose, onSaved }: PriceModalProps) {
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
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Cambiar precio"
      footer={
        <>
          <Button variant="secondary" className="mr-auto" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} onClick={() => void handleSave()}>Confirmar</Button>
        </>
      }
    >
        <p className="mb-4 truncate text-sm text-muted" title={product.name}>{product.name}</p>
        <Field label={`Precio ($/${product.unit === 'kg' ? 'kg' : 'unidad'})`}>
          <NumericInput value={priceRaw} onChange={setPriceRaw}
            className="w-full rounded-lg border border-line bg-input px-3 py-2 text-sm text-ink focus:outline-none focus:border-line-accent"
            placeholder="0" autoFocus />
        </Field>
        {product.price != null && <p className="mt-1 text-xs text-muted">Precio actual: {fmtARS(product.price)}</p>}
        {priceOverLimit && (
          <p className="mt-2 text-xs text-amber-400">
            El precio supera ${KRETZ_MAX_PRICE.toLocaleString('es-AR')} — este producto no podrá cargarse en la balanza.
          </p>
        )}
        <p className="mt-2 text-xs text-subtle">Dejar en blanco o poner 0 para quitar el precio.</p>
        {error && <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
    </Modal>
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

export function PriceHistoryModal({ product, storeId, onClose }: PriceHistoryModalProps) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Historial"
      footer={<Button variant="secondary" className="mr-auto" onClick={onClose}>Cerrar</Button>}
    >
        <p className="mb-4 truncate text-sm text-muted" title={product.name}>{product.name}</p>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted">Precios de este local</p>
            <PriceHistoryBlock productId={product.id} storeId={storeId} />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted">Ficha y visibilidad</p>
            <CatalogAuditBlock productId={product.id} storeId={storeId} />
          </div>
        </div>
    </Modal>
  )
}

interface CatalogRevisionsModalProps {
  storeId: string
  storeName: string
  onClose: () => void
  onRestored: () => void
}

function CatalogRevisionsModal({ storeId, storeName, onClose, onRestored }: CatalogRevisionsModalProps) {
  const [rows, setRows] = useState<CatalogRevisionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    window.hw.listCatalogRevisions({ storeId }).then(r => {
      if (r.ok) setRows(r.data)
      else setError(r.error)
      setLoading(false)
    })
  }, [storeId])

  async function handleRestore(revisionId: string) {
    setRestoringId(revisionId)
    setError(null)
    const r = await window.hw.restoreCatalogRevision({ storeId, revisionId })
    setRestoringId(null)
    if (r.ok) onRestored()
    else setError(r.error)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Versiones del catálogo"
      footer={<Button variant="secondary" className="mr-auto" onClick={onClose}>Cerrar</Button>}
    >
        <p className="mb-4 truncate text-sm text-muted" title={storeName}>
          {storeName || 'Local seleccionado'} — se guarda una copia antes de cada confirmación de precios. Máximo 10.
        </p>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-transparent" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            Todavía no hay versiones. Cada vez que confirmes un cambio de precios se guarda la copia anterior.
          </p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-auto">
            {rows.map(row => (
              <div key={row.id} className="rounded-lg border border-line bg-raised px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink" title={fmtDate(row.archivedAt)}>
                      {fmtDate(row.archivedAt)}
                    </p>
                    <p className="text-xs text-muted">{row.productCount} productos</p>
                  </div>
                  {confirmId === row.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="sm" disabled={restoringId !== null} onClick={() => setConfirmId(null)}>
                        No
                      </Button>
                      <Button size="sm" disabled={restoringId !== null} onClick={() => void handleRestore(row.id)}>
                        {restoringId === row.id ? '…' : 'Sí, restaurar'}
                      </Button>
                    </div>
                  ) : (
                    <Button variant="secondary" size="sm" disabled={restoringId !== null} onClick={() => setConfirmId(row.id)}>
                      Restaurar
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Helpers de UI
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted">{label}</label>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal baja global del catálogo (libera el PLU)
// ---------------------------------------------------------------------------

interface GlobalDeleteProductModalProps {
  product: AdminProductRow
  deleting: boolean
  onConfirm: () => void
  onCancel: () => void
}

function GlobalDeleteProductModal({ product, deleting, onConfirm, onCancel }: GlobalDeleteProductModalProps) {
  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      title="Quitar del catálogo"
      footer={
        <>
          <Button variant="secondary" className="mr-auto" onClick={onCancel} disabled={deleting}>Cancelar</Button>
          <Button variant="danger" loading={deleting} onClick={onConfirm}>Quitar y liberar PLU</Button>
        </>
      }
    >
        <p className="mb-1 text-sm text-muted">
          ¿Quitar{' '}
          <span className="inline-block max-w-full truncate align-bottom font-medium text-ink" title={product.name}>
            {product.name}
          </span>
          {' '}del catálogo?
        </p>
        <p className="mb-3 text-xs text-amber-400/80">
          Desaparece de todos los locales y libera el PLU {product.pluNumber ?? '—'}.
          Usalo para productos de prueba o fichas que no deberían existir.
        </p>
        <p className="text-xs text-muted">
          Si el producto se vende en otro local, no lo quites: sacalo solo de la venta de este local.
        </p>
    </Modal>
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
    <Modal open onClose={onCancel} size="sm" title="Cambios sin guardar">
        <p className="mb-4 text-sm text-muted">
          Tenés {pendingChanges} cambio{pendingChanges !== 1 ? 's' : ''} de precio sin guardar en este local.
          ¿Qué querés hacer antes de cambiar de local?
        </p>
        <div className="space-y-2">
          <Button fullWidth onClick={onSave}>
            Guardar cambios y continuar
          </Button>
          <Button fullWidth variant="danger" onClick={onDiscard}>
            Descartar cambios y continuar
          </Button>
          <Button fullWidth variant="ghost" onClick={onCancel}>
            Cancelar (quedarme en este local)
          </Button>
        </div>
    </Modal>
  )
}
