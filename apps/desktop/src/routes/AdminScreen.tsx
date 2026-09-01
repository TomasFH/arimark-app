/**
 * Panel de catálogo de productos.
 *
 * Admin: todos los locales, KRETZ, versiones, retiro global.
 * Cajera: solo su local (precio y visibilidad); puede crear/editar ficha.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import BackButton from '../components/BackButton'
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
  CatalogRevisionRow,
  CatalogAuditRow,
  CatalogAuditAction,
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

  useEffect(() => {
    if (selectedStoreId) void loadProducts(selectedStoreId)
  }, [selectedStoreId, loadProducts])

  useEffect(() => {
    if (!selectedStoreId) return
    const unsub = window.hw.onCatalogSyncUpdated?.((payload?: { storeId?: string }) => {
      if (payload?.storeId && payload.storeId !== selectedStoreId) return
      void loadProducts(selectedStoreId, { silent: true })
    })
    return () => { unsub?.() }
  }, [selectedStoreId, loadProducts])

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

  async function handleToggleAvailability(p: AdminProductRow) {
    const next = !p.available
    setProducts(prev => prev.map(x => x.id === p.id ? { ...x, available: next } : x))
    const r = await window.hw.setProductAvailability({ productId: p.id, storeId: selectedStoreId, available: next })
    if (!r.ok) {
      setProducts(prev => prev.map(x => x.id === p.id ? { ...x, available: p.available } : x))
      setError(r.error)
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
    let failed = 0
    for (const { productId, price } of changes) {
      const r = await window.hw.setProductPrice({ productId, storeId: selectedStoreId, price })
      if (!r.ok) failed++
    }
    setBulkSaving(false)
    setBulkMode(false)
    setBulkDraft(new Map())
    if (failed > 0) setError(`${failed} precio(s) no se pudieron guardar.`)
    void loadProducts(selectedStoreId, { silent: true })
  }

  const pendingChanges = [...bulkDraft.entries()].filter(([productId, raw]) => {
    const parsed = parseNumericInput(raw)
    if (parsed === null) return false
    const original = products.find(p => p.id === productId)?.price ?? null
    return parsed !== original
  }).length

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white">
      {/* Header — chrome de página, no una barra extra del mismo gris que la tabla */}
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 px-6 py-3">
        <BackButton onClick={onReturnToHub} />
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold text-zinc-100 truncate">
            {isAdmin ? 'Administración — Productos' : 'Catálogo'}
          </h1>
          {isAdmin && stores.length > 1 && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-zinc-500 shrink-0">Local:</span>
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
                className="text-[10px] bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-zinc-300"
              >
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {stores.length === 1 && (
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate" title={stores[0]?.name}>
              {stores[0]?.name}
            </p>
          )}
        </div>
        <button onClick={onLogout} className="shrink-0 text-xs text-zinc-500 hover:text-zinc-200 transition-colors">
          Cerrar sesión
        </button>
      </header>

      <div className="flex shrink-0 items-center gap-2 px-6 pt-4 pb-3">
        <input
          type="text"
          placeholder="Buscar por nombre o PLU…"
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-700/50"
        />

        {bulkMode ? (
          <>
            <button
              type="button"
              onClick={() => { setBulkMode(false); setBulkDraft(new Map()) }}
              disabled={bulkSaving}
              className="shrink-0 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleBulkSave()}
              disabled={bulkSaving || pendingChanges === 0}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:bg-zinc-700"
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
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowRevisions(true)}
                className="shrink-0 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
                title="Restaurar una versión anterior del catálogo publicado"
              >
                Versiones
              </button>
            )}
            <button
              type="button"
              onClick={() => { setBulkMode(true); setBulkDraft(new Map()) }}
              className="shrink-0 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
              title="Editar varios precios de una vez"
            >
              Editar precios
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowSync(true)}
                className="shrink-0 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
                title="Enviar el catálogo del local a la balanza conectada por USB"
              >
                Cargar en balanza
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              + Nuevo producto
            </button>
          </>
        )}
      </div>

      {bulkMode && (
        <div className="mx-6 mb-3 rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-2 text-xs text-amber-400/90">
          Modo edición masiva activo — modificá los precios en la tabla y guardá todos los cambios de una vez.
        </div>
      )}

      {error && (
        <div className="mx-6 mb-3 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-2 text-sm text-red-400/90">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 px-6 pb-4">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-800">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="mt-16 text-center text-sm text-zinc-500">
              {filterText ? 'Sin resultados para esa búsqueda.' : 'No hay productos cargados.'}
            </p>
          ) : (
            <>
              <div className="shrink-0 [scrollbar-gutter:stable]">
                <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
                  <CatalogColgroup />
                  <thead>
                    <tr className="text-left text-zinc-300">
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
                          className={`bg-zinc-700 px-3 py-2.5 font-medium first:pl-4 ${col.cls ?? ''}`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className="inline-flex items-center gap-1 hover:text-white"
                          >
                            {col.label}
                            {sortKey === col.key && (
                              <span className="text-[10px] text-zinc-400">{sortDir === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </button>
                        </th>
                      ))}
                      <th className="bg-zinc-700 px-3 py-2.5 pr-4" />
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
                    ? 'bg-emerald-950/40 group-hover:bg-emerald-900/40'
                    : i % 2 === 0
                      ? 'bg-zinc-800 group-hover:bg-zinc-700'
                      : 'bg-zinc-800/60 group-hover:bg-zinc-700'

                  return (
                    <tr key={p.id} className="group">
                      <td className={`border-t border-zinc-700/60 px-3 py-2.5 pl-4 tabular-nums text-zinc-400 ${rowBg}`}>
                        {p.pluNumber ?? <span className="text-zinc-600">—</span>}
                      </td>
                      <td className={`min-w-0 border-t border-zinc-700/60 px-3 py-2.5 font-medium ${rowBg}`}>
                        <span className="block truncate" title={p.name}>{p.name}</span>
                      </td>
                      <td className={`border-t border-zinc-700/60 px-3 py-2.5 text-zinc-400 ${rowBg}`}>
                        {CATEGORY_LABELS[p.category]}
                      </td>
                      <td className={`border-t border-zinc-700/60 px-3 py-2.5 text-zinc-400 ${rowBg}`}>
                        {p.unit === 'kg' ? 'kg' : 'unidad'}
                      </td>
                      <td className={`border-t border-zinc-700/60 px-3 py-1.5 text-right ${rowBg}`}>
                        {bulkMode ? (
                          <NumericInput
                            value={draftRaw ?? (p.price != null ? formatNumericInputValue(String(p.price)) : '')}
                            onChange={v => handleBulkDraftChange(p.id, v)}
                            className={`w-28 rounded border bg-zinc-700 px-2 py-1 text-right text-sm text-white focus:outline-none focus:ring-1 ${isChanged ? 'border-emerald-500 focus:ring-emerald-500' : 'border-zinc-500 focus:ring-emerald-700/50'}`}
                            placeholder="—"
                          />
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setPriceProduct(p)}
                              className="tabular-nums text-zinc-100 hover:text-emerald-400 transition-colors"
                              title="Cambiar precio"
                            >
                              {p.price != null ? fmtARS(p.price) : <span className="text-xs text-zinc-500">Sin precio</span>}
                            </button>
                            <button
                              type="button"
                              onClick={() => setHistoryProduct(p)}
                              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                              title="Ver historial de precios"
                            >
                              ↓
                            </button>
                          </div>
                        )}
                      </td>
                      <td className={`border-t border-zinc-700/60 px-3 py-2.5 text-center ${rowBg}`}>
                        <Toggle checked={p.available} onChange={() => void handleToggleAvailability(p)} />
                      </td>
                      <td className={`border-t border-zinc-700/60 px-3 py-2.5 pr-4 text-right ${rowBg}`}>
                        {!bulkMode && (
                          <button
                            type="button"
                            onClick={() => setEditProduct(p)}
                            className="rounded-lg px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-600 hover:text-white transition-colors"
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
      {isAdmin && showSync && (
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
// Toggle switch
// ---------------------------------------------------------------------------

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${checked ? 'bg-green-600' : 'bg-zinc-600'}`}
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
    return <p className="text-xs text-zinc-600">Cargando actividad…</p>
  }
  if (rows.length === 0) {
    return <p className="text-xs text-zinc-600">Sin cambios de ficha registrados.</p>
  }

  return (
    <div className="space-y-1.5 max-h-40 overflow-auto">
      {rows.map(row => (
        <div key={row.id} className="rounded-lg border border-zinc-800 bg-zinc-800/30 px-3 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              {AUDIT_ACTION_LABELS[row.action]}
            </span>
            <p className="min-w-0 flex-1 truncate text-xs text-zinc-300" title={row.summary}>
              {row.summary}
            </p>
          </div>
          <p className="text-[10px] text-zinc-600 mt-0.5 truncate" title={`${fmtDate(row.createdAt)} · ${row.actorName}`}>
            {fmtDate(row.createdAt)} · {row.actorName}
          </p>
        </div>
      ))}
    </div>
  )
}

function ProductFormModal({ storeId, stores, product, onClose, onSaved, onRequestGlobalDelete, allowGlobalDelete }: ProductFormModalProps) {
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

    // Aplicar precios por local (alta y edición)
    if (productId) {
      const targets = resolvePriceTargets()
      for (const t of targets) {
        const pr = await window.hw.setProductPrice({ productId, storeId: t.storeId, price: t.price })
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
    <ModalOverlay onClose={onClose}>
      <div className="bg-zinc-800 rounded-xl w-full max-w-md p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-5">{isEdit ? 'Editar producto' : 'Nuevo producto'}</h2>
        <div className="space-y-4">
          <Field label="Nombre">
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              maxLength={100}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="Nombre del producto" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoría">
              <select value={category} onChange={e => setCategory(e.target.value as AdminProductRow['category'])}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500">
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Unidad">
              <select value={unit} onChange={e => setUnit(e.target.value as 'kg' | 'unit')}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500">
                <option value="kg">kg (pesable)</option>
                <option value="unit">Unidad</option>
              </select>
            </Field>
          </div>
          <Field label="Número de PLU (1–999, opcional)">
            <input type="text" inputMode="numeric" value={pluRaw}
              onChange={e => setPluRaw(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="Sin asignar" />
          </Field>
          <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <p className="text-xs font-medium text-zinc-400 shrink-0">
                  Precio ($/{unitLabel}{isEdit ? '' : ', opcional'})
                </p>
                {stores.length > 1 && (
                  <label className="flex items-center gap-1.5 cursor-pointer select-none min-w-0">
                    <input
                      type="checkbox"
                      checked={samePriceAll}
                      onChange={e => handleToggleSamePrice(e.target.checked)}
                      className="shrink-0 accent-red-500"
                    />
                    <span className="text-xs text-zinc-300 truncate" title="Usar el mismo precio en todos los locales">
                      Mismo precio en todos
                    </span>
                  </label>
                )}
              </div>

              {(samePriceAll || stores.length <= 1) ? (
                <NumericInput value={sharedPriceRaw} onChange={setSharedPriceRaw}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
                  placeholder="Dejar en blanco si no tiene precio aún" />
              ) : (
                <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 divide-y divide-zinc-700/80">
                  {stores.map(s => (
                    <div key={s.id} className="flex items-center gap-2 min-w-0 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-200" title={s.name}>{s.name}</span>
                      <NumericInput
                        value={perStorePriceRaw[s.id] ?? ''}
                        onChange={v => setPerStorePriceRaw(prev => ({ ...prev, [s.id]: v }))}
                        className="w-28 shrink-0 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white text-right focus:outline-none focus:ring-1 focus:ring-red-500"
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
                <p className="text-xs text-zinc-600">Dejá en blanco los locales sin precio por ahora.</p>
              )}
            </div>
        </div>
        {error && <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400/90">{error}</div>}
        {isEdit && product && (
          <div className="mt-5 pt-4 border-t border-zinc-800">
            <p className="text-xs font-medium text-zinc-400 mb-2">Actividad reciente</p>
            <CatalogAuditBlock productId={product.id} storeId={storeId} />
          </div>
        )}
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2 rounded-lg transition-colors">Cancelar</button>
          <button onClick={() => void handleSave()} disabled={saving}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>

        {isEdit && allowGlobalDelete && onRequestGlobalDelete && (
          <div className="mt-5 pt-4 border-t border-zinc-800">
            <p className="text-xs text-zinc-600 mb-2">Zona de peligro</p>
            <button
              type="button"
              onClick={onRequestGlobalDelete}
              className="text-xs text-red-500 hover:text-red-400 hover:bg-red-950/30 px-3 py-1.5 rounded-lg transition-colors border border-red-900/30 w-full"
            >
              Quitar del catálogo (libera el PLU en todos los locales)
            </button>
          </div>
        )}

        {isEdit && !allowGlobalDelete && product && (
          <div className="mt-5 pt-4 border-t border-zinc-800">
            <p className="text-xs text-zinc-600 mb-2">Este local</p>
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
              className="text-xs text-zinc-300 hover:text-white hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors border border-zinc-700 w-full"
            >
              {product.available ? 'Quitar de este local' : 'Mostrar en este local'}
            </button>
          </div>
        )}
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
      <div className="bg-zinc-800 rounded-xl w-full max-w-sm p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-1">Cambiar precio</h2>
        <p className="text-sm text-zinc-400 mb-5 truncate" title={product.name}>{product.name}</p>
        <Field label={`Precio ($/${product.unit === 'kg' ? 'kg' : 'unidad'})`}>
          <NumericInput value={priceRaw} onChange={setPriceRaw}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
            placeholder="0" autoFocus />
        </Field>
        {product.price != null && <p className="text-xs text-zinc-500 mt-1">Precio actual: {fmtARS(product.price)}</p>}
        {priceOverLimit && (
          <p className="text-xs text-amber-400 mt-2">
            El precio supera ${KRETZ_MAX_PRICE.toLocaleString('es-AR')} — este producto no podrá cargarse en la balanza.
          </p>
        )}
        <p className="text-xs text-zinc-600 mt-2">Dejar en blanco o poner 0 para quitar el precio.</p>
        {error && <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400/90">{error}</div>}
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2 rounded-lg transition-colors">Cancelar</button>
          <button onClick={() => void handleSave()} disabled={saving}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
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
      <div className="bg-zinc-800 rounded-xl w-full max-w-md p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-1">Historial de precios</h2>
        <p className="text-sm text-zinc-400 mb-4 truncate" title={product.name}>{product.name}</p>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-6">Sin historial de precios para este local.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-auto">
            {history.map(h => (
              <div key={h.id} className={`rounded-lg border px-3 py-2 text-sm ${h.validTo == null ? 'border-emerald-900/50 bg-emerald-950/30' : 'border-zinc-800 bg-zinc-800/30'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold tabular-nums">{fmtARS(h.price)}</span>
                  {h.validTo == null
                    ? <span className="text-xs text-emerald-400/80 font-medium">Vigente</span>
                    : <span className="text-xs text-zinc-500">Hasta {fmtDate(h.validTo)}</span>}
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Desde {fmtDate(h.validFrom)} · Por {h.createdBy}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-zinc-800">
          <p className="text-xs font-medium text-zinc-400 mb-2">Cambios de ficha y visibilidad</p>
          <CatalogAuditBlock productId={product.id} storeId={storeId} />
        </div>

        <button onClick={onClose} className="w-full mt-5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2 rounded-lg transition-colors">
          Cerrar
        </button>
      </div>
    </ModalOverlay>
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
    <ModalOverlay onClose={onClose}>
      <div className="bg-zinc-800 rounded-xl w-full max-w-md p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-1">Versiones del catálogo</h2>
        <p className="text-sm text-zinc-400 mb-4 truncate" title={storeName}>
          {storeName || 'Local seleccionado'} — se guardan las últimas 10 publicaciones.
        </p>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-6">
            Todavía no hay versiones. A partir de ahora, cada vez que se publique el catálogo se guarda una copia anterior.
          </p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-auto">
            {rows.map(row => (
              <div key={row.id} className="rounded-lg border border-zinc-800 bg-zinc-800/30 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-200 truncate" title={fmtDate(row.archivedAt)}>
                      {fmtDate(row.archivedAt)}
                    </p>
                    <p className="text-xs text-zinc-500">{row.productCount} productos</p>
                  </div>
                  {confirmId === row.id ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={restoringId !== null}
                        onClick={() => setConfirmId(null)}
                        className="text-xs text-zinc-400 px-2 py-1 rounded hover:bg-zinc-800"
                      >
                        No
                      </button>
                      <button
                        type="button"
                        disabled={restoringId !== null}
                        onClick={() => void handleRestore(row.id)}
                        className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded font-medium disabled:opacity-50"
                      >
                        {restoringId === row.id ? '…' : 'Sí, restaurar'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={restoringId !== null}
                      onClick={() => setConfirmId(row.id)}
                      className="shrink-0 text-xs border border-zinc-600 hover:border-zinc-400 text-zinc-300 px-2 py-1 rounded"
                    >
                      Restaurar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

        <button onClick={onClose} className="w-full mt-5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2 rounded-lg transition-colors">
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
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="animate-modal-enter w-full flex justify-center">
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-zinc-400 mb-1">{label}</label>
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
    <ModalOverlay onClose={onCancel}>
      <div className="bg-zinc-800 rounded-xl w-full max-w-sm p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-2">Quitar del catálogo</h2>
        <p className="text-sm text-zinc-400 mb-1">
          ¿Quitar{' '}
          <span className="text-zinc-200 font-medium truncate inline-block max-w-full align-bottom" title={product.name}>
            {product.name}
          </span>
          {' '}del catálogo?
        </p>
        <p className="text-xs text-amber-400/80 mb-3">
          Desaparece de todos los locales y libera el PLU {product.pluNumber ?? '—'}.
          Usalo para productos de prueba o fichas que no deberían existir.
        </p>
        <p className="text-xs text-zinc-500 mb-5">
          Si el producto se vende en otro local, no lo quites: desactivá el toggle Disponible en este local.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 text-sm font-medium py-2 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-zinc-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
          >
            {deleting ? 'Quitando…' : 'Quitar y liberar PLU'}
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
      <div className="bg-zinc-800 rounded-xl w-full max-w-sm p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-2">Cambios sin guardar</h2>
        <p className="text-sm text-zinc-400 mb-5">
          Tenés {pendingChanges} cambio{pendingChanges !== 1 ? 's' : ''} de precio sin guardar en este local.
          ¿Qué querés hacer antes de cambiar de local?
        </p>
        <div className="space-y-2">
          <button onClick={onSave}
            className="w-full bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
            Guardar cambios y continuar
          </button>
          <button onClick={onDiscard}
            className="w-full bg-zinc-800 hover:bg-red-900/40 text-zinc-300 hover:text-red-300 text-sm font-medium py-2 rounded-lg transition-colors">
            Descartar cambios y continuar
          </button>
          <button onClick={onCancel}
            className="w-full text-zinc-500 hover:text-zinc-300 text-sm py-2 rounded-lg transition-colors">
            Cancelar (quedarme en este local)
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
