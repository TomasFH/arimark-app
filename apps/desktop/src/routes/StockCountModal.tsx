/**
 * Formulario de conteo de stock (dominical / periódico).
 * kg → se persisten en gramos; unidades enteras con NumericInput.
 * Filas vacías no se guardan.
 * X / Esc / clic fuera: guarda y cierra. Cancelar: borra el borrador (con confirmación si hay datos).
 * Un conteo finalizado se puede seguir editando mientras la caja no esté cerrada (cajera) o siempre (admin).
 */
import { useEffect, useRef, useState } from 'react'
import DecimalInput from '../components/DecimalInput'
import NumericInput from '../components/NumericInput'
import { todayLocalYmd, toLocalDate } from '../lib/datetime'
import {
  applyKgDelta,
  applyUnitsDelta,
  formatKgQuantity,
  formatNumericInputValue,
  parseDecimalInput,
  parseNumericInput,
} from '../lib/numericInput'
import type { CreateStockCountItemPayload, ProductRow, StockCountItemRow, StoreRow } from '../types/hw-api'

interface Props {
  onClose: () => void
  /** Local a asociar. Cajera: el del turno. Admin: obligatorio elegir si se omite. */
  storeId?: string
  /** Fecha del conteo YYYY-MM-DD; default hoy local. */
  countDate?: string
  onSaved?: (countId: string) => void
}

interface DraftRow {
  product: ProductRow
  kgText: string
  unitsText: string
  notes: string
}

type AdjustState = {
  productId: string
  kind: 'kg' | 'units'
  direction: 'add' | 'subtract'
}

function kgToGrams(kg: number): number {
  return Math.round(kg * 1000)
}

function emptyRows(products: ProductRow[]): DraftRow[] {
  return products.map(product => ({
    product,
    kgText: '',
    unitsText: '',
    notes: '',
  }))
}

function overlayItems(products: ProductRow[], items: StockCountItemRow[]): DraftRow[] {
  const byPlu = new Map(items.map(i => [i.productId, i]))
  const byName = new Map(items.map(i => [i.productName.trim().toLowerCase(), i]))
  return products.map(product => {
    const saved = byPlu.get(product.pluNumber)
      ?? byName.get(product.name.trim().toLowerCase())
    return {
      product,
      kgText: saved?.quantityKg != null ? formatKgQuantity(saved.quantityKg / 1000) : '',
      unitsText: saved?.quantityUnits != null ? formatNumericInputValue(String(saved.quantityUnits)) : '',
      notes: saved?.notes ?? '',
    }
  })
}

function rowHasValue(row: DraftRow): boolean {
  return Boolean(row.kgText.trim() || row.unitsText.trim() || row.notes.trim())
}

export default function StockCountModal({ onClose, storeId, countDate, onSaved }: Props) {
  const date = countDate ?? todayLocalYmd()
  const dateLabel = toLocalDate(`${date}T12:00:00.000Z`)

  const [rows, setRows] = useState<DraftRow[]>([])
  const [catalog, setCatalog] = useState<ProductRow[]>([])
  const [stores, setStores] = useState<StoreRow[]>([])
  const [chosenStoreId, setChosenStoreId] = useState(storeId ?? '')
  const [draftId, setDraftId] = useState<string | null>(null)
  const [countStatus, setCountStatus] = useState<'draft' | 'final' | null>(null)
  const [recordedBy, setRecordedBy] = useState<string | null>(null)
  const [recordedByName, setRecordedByName] = useState<string | null>(null)
  const [lastEditedBy, setLastEditedBy] = useState<string | null>(null)
  const [lastEditedByName, setLastEditedByName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successId, setSuccessId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [adjust, setAdjust] = useState<AdjustState | null>(null)
  const [deltaText, setDeltaText] = useState('')
  const [confirmFinalize, setConfirmFinalize] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [storePrompt, setStorePrompt] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)
  const storePickerRef = useRef<HTMLDivElement>(null)
  const loadedStoreRef = useRef<string | null>(null)
  const rowsRef = useRef<DraftRow[]>([])
  const draftIdRef = useRef<string | null>(null)
  const countStatusRef = useRef<'draft' | 'final' | null>(null)
  const dirtyRef = useRef(false)
  const persistInFlightRef = useRef<Promise<string | null> | null>(null)
  const discardRequestedRef = useRef(false)
  const needsStorePicker = !storeId
  const effectiveStoreId = storeId || chosenStoreId
  const storeName = stores.find(s => s.id === effectiveStoreId)?.name
  const hasProgress = rows.some(rowHasValue)
  const editedBySomeoneElse = Boolean(
    lastEditedBy && recordedBy && lastEditedBy !== recordedBy,
  )

  rowsRef.current = rows
  draftIdRef.current = draftId
  countStatusRef.current = countStatus

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      const [prodRes, storesRes] = await Promise.all([
        window.hw.getProducts(),
        window.hw.getStores({ includeArchived: false }),
      ])
      if (cancelled) return
      if (storesRes.ok) {
        setStores(storesRes.data.filter(s => !s.archivedAt))
      }
      if (!prodRes.ok) {
        setLoading(false)
        setError(prodRes.error ?? 'Error al cargar productos.')
        return
      }
      const sorted = [...prodRes.data].sort((a, b) => a.pluNumber - b.pluNumber || a.name.localeCompare(b.name, 'es-AR'))
      setCatalog(sorted)
      if (!storeId || sorted.length === 0) {
        setRows(emptyRows(sorted))
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!effectiveStoreId || catalog.length === 0) return
    if (loadedStoreRef.current === effectiveStoreId && dirtyRef.current) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const res = await window.hw.getDraftStockCount({
        ...(effectiveStoreId ? { storeId: effectiveStoreId } : {}),
        countDate: date,
      })
      if (cancelled) return
      if (res.ok && res.data) {
        setDraftId(res.data.id)
        setCountStatus(res.data.status)
        setRecordedBy(res.data.recordedBy)
        setRecordedByName(res.data.recordedByName)
        setLastEditedBy(res.data.lastEditedBy)
        setLastEditedByName(res.data.lastEditedByName)
        setRows(overlayItems(catalog, res.data.items))
        dirtyRef.current = false
      } else {
        setDraftId(null)
        setCountStatus(null)
        setRecordedBy(null)
        setRecordedByName(null)
        setLastEditedBy(null)
        setLastEditedByName(null)
        if (loadedStoreRef.current) {
          setRows(emptyRows(catalog))
        } else {
          setRows(prev => (prev.some(rowHasValue) ? prev : emptyRows(catalog)))
        }
      }
      loadedStoreRef.current = effectiveStoreId
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [effectiveStoreId, catalog, date])

  const searchNorm = search.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 })
  }, [searchNorm])

  useEffect(() => {
    if (loading || !effectiveStoreId || confirmCancel || confirmFinalize) return
    if (!dirtyRef.current || discardRequestedRef.current) return
    if (countStatusRef.current === 'final') return
    if (!rows.some(rowHasValue)) return
    const timer = window.setTimeout(() => {
      void persist('draft', { silent: true })
    }, 500)
    return () => window.clearTimeout(timer)
    // persist lee refs actuales; no incluirla en deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, effectiveStoreId, loading, confirmCancel, confirmFinalize])

  function updateRow(productId: string, patch: Partial<Pick<DraftRow, 'kgText' | 'unitsText' | 'notes'>>) {
    dirtyRef.current = true
    setRows(prev =>
      prev.map(r => (r.product.id === productId ? { ...r, ...patch } : r)),
    )
    setError(null)
  }

  function requireStore(): boolean {
    if (effectiveStoreId) return true
    const message = 'Elegí un local arriba para poder guardar o finalizar el conteo.'
    setError(message)
    setStorePrompt(true)
    storePickerRef.current?.scrollIntoView({ block: 'nearest' })
    return false
  }

  const filteredRows = searchNorm
    ? rows.filter(r => {
        const name = r.product.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const plu = String(r.product.pluNumber)
        return name.includes(searchNorm) || plu.includes(searchNorm)
      })
    : rows

  function collectItemsFrom(source: DraftRow[]): CreateStockCountItemPayload[] | null {
    const items: CreateStockCountItemPayload[] = []
    for (const row of source) {
      const kg = row.kgText.trim() ? parseDecimalInput(row.kgText) : null
      const units = row.unitsText.trim() ? parseNumericInput(row.unitsText) : null

      if (row.kgText.trim() && (kg === null || kg < 0)) {
        setError(`Cantidad en kg inválida para ${row.product.name}.`)
        return null
      }
      if (row.unitsText.trim() && (units === null || units < 0)) {
        setError(`Unidades inválidas para ${row.product.name}.`)
        return null
      }

      const grams = kg != null && kg > 0 ? kgToGrams(kg) : null
      const unitsVal = units != null && units > 0 ? units : null
      if (grams == null && unitsVal == null) continue

      items.push({
        productId: row.product.pluNumber,
        productName: row.product.name,
        quantityKg: grams,
        quantityUnits: unitsVal,
        notes: row.notes.trim() || null,
      })
    }
    return items
  }

  async function persist(
    status: 'draft' | 'final',
    opts?: { silent?: boolean },
  ): Promise<string | null> {
    if (discardRequestedRef.current) return null
    setError(null)
    if (!requireStore()) return null

    const items = collectItemsFrom(rowsRef.current)
    if (items === null) return null

    if (status === 'final' && items.length === 0) {
      setError('Completá al menos un producto con cantidad.')
      return null
    }
    if (status === 'draft' && items.length === 0 && !draftIdRef.current) {
      return 'skipped'
    }

    const saveAs: 'draft' | 'final' =
      countStatusRef.current === 'final' ? 'final' : status

    if (!opts?.silent) setSaving(true)
    const run = (async (): Promise<string | null> => {
      const res = await window.hw.createStockCount({
        id: draftIdRef.current ?? undefined,
        countDate: date,
        storeId: effectiveStoreId,
        items,
        status: saveAs,
      })
      if (discardRequestedRef.current) return null
      if (!res.ok) {
        if (res.code === 'NO_SHIFT') {
          setError('Se necesita un turno abierto para registrar el conteo (cajera).')
        } else {
          setError(res.error ?? 'No se pudo guardar el conteo.')
        }
        return null
      }

      draftIdRef.current = res.data.id
      countStatusRef.current = res.data.status
      setDraftId(res.data.id)
      setCountStatus(res.data.status)
      setRecordedBy(res.data.recordedBy)
      setRecordedByName(res.data.recordedByName)
      setLastEditedBy(res.data.lastEditedBy)
      setLastEditedByName(res.data.lastEditedByName)
      dirtyRef.current = false
      return res.data.id
    })()
    persistInFlightRef.current = run
    const result = await run
    if (persistInFlightRef.current === run) persistInFlightRef.current = null
    if (!opts?.silent) setSaving(false)
    return result
  }

  function handleCancelClick() {
    if (saving) return
    const loadedFinal = countStatus === 'final'
    if (loadedFinal) {
      if (!dirtyRef.current) {
        onClose()
        return
      }
      setConfirmCancel(true)
      return
    }
    if (!hasProgress && !draftId) {
      onClose()
      return
    }
    setConfirmCancel(true)
  }

  async function handleCancelConfirm() {
    discardRequestedRef.current = true
    if (persistInFlightRef.current) {
      await persistInFlightRef.current
    }
    const idToDiscard = countStatusRef.current === 'final' ? null : draftIdRef.current
    if (idToDiscard) {
      setSaving(true)
      const res = await window.hw.discardStockCountDraft({ stockCountId: idToDiscard })
      setSaving(false)
      if (!res.ok && res.code !== 'NOT_FOUND') {
        discardRequestedRef.current = false
        setError(res.error ?? 'No se pudo cancelar el conteo.')
        setConfirmCancel(false)
        return
      }
    }
    setConfirmCancel(false)
    onClose()
  }

  function handleFinalizeClick() {
    if (!requireStore()) return
    const items = collectItemsFrom(rowsRef.current)
    if (items === null) return
    if (items.length === 0) {
      setError('Completá al menos un producto con cantidad.')
      return
    }
    setConfirmFinalize(true)
  }

  async function handleFinalizeConfirm() {
    const id = await persist('final')
    if (!id || id === 'skipped') return
    setConfirmFinalize(false)
    setSuccessId(id)
    onSaved?.(id)
  }

  async function handleSaveAndClose() {
    if (saving) return
    const currentHasProgress = rowsRef.current.some(rowHasValue)
    if (currentHasProgress && !effectiveStoreId) {
      requireStore()
      return
    }
    if (currentHasProgress || countStatusRef.current === 'final') {
      const id = await persist(countStatusRef.current === 'final' ? 'final' : 'draft')
      if (id === null) return
      if (id !== 'skipped') onSaved?.(id)
    }
    onClose()
  }

  async function selectStore(nextId: string) {
    if (nextId === chosenStoreId || saving) return
    if (hasProgress && chosenStoreId) {
      const id = await persist('draft')
      if (id === null) return
    }
    setChosenStoreId(nextId)
    setError(null)
    setStorePrompt(false)
    setAdjust(null)
    setDeltaText('')
  }

  function toggleAdjust(productId: string, kind: 'kg' | 'units', direction: 'add' | 'subtract') {
    if (adjust?.productId === productId && adjust.kind === kind && adjust.direction === direction) {
      setAdjust(null)
      setDeltaText('')
      return
    }
    setAdjust({ productId, kind, direction })
    setDeltaText('')
    setError(null)
  }

  function applyAdjust(row: DraftRow) {
    if (!adjust || adjust.productId !== row.product.id) return
    const sign = adjust.direction === 'add' ? 1 : -1
    if (adjust.kind === 'kg') {
      const next = applyKgDelta(row.kgText, deltaText, sign)
      if (next === null) {
        setError('Indicá cuántos kg sumar o restar.')
        return
      }
      updateRow(row.product.id, { kgText: next })
    } else {
      const next = applyUnitsDelta(row.unitsText, deltaText, sign)
      if (next === null) {
        setError('Indicá cuántas unidades sumar o restar.')
        return
      }
      updateRow(row.product.id, { unitsText: next })
    }
    setAdjust(null)
    setDeltaText('')
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || saving) return
      if (adjust) {
        setAdjust(null)
        setDeltaText('')
        return
      }
      if (confirmCancel) {
        setConfirmCancel(false)
        return
      }
      if (confirmFinalize) {
        setConfirmFinalize(false)
        return
      }
      if (successId) {
        onClose()
        return
      }
      e.preventDefault()
      void handleSaveAndClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => {
        if (e.target === e.currentTarget && !saving) void handleSaveAndClose()
      }}
    >
      <div className="flex flex-col bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh]">
        <div className="flex items-center justify-between gap-2 min-w-0 border-b border-zinc-700 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-white truncate">Conteo de stock</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate" title={storeName ? `${dateLabel} · ${storeName}` : dateLabel}>
              {dateLabel}
              {storeName ? ` · ${storeName}` : ''}
              {countStatus === 'draft' ? ' · Borrador' : countStatus === 'final' ? ' · Registrado' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleSaveAndClose()}
            disabled={saving}
            className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50"
            aria-label="Cerrar"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {successId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <p className="text-emerald-300 font-medium">
              {countStatus === 'final' && lastEditedBy && recordedBy && lastEditedBy !== recordedBy
                ? 'Conteo actualizado'
                : 'Conteo finalizado'}
            </p>
            <p className="text-xs text-zinc-500">
              Quedó registrado para {dateLabel}
              {storeName ? ` · ${storeName}` : ''}.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-lg px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <>
            <div className="shrink-0 px-4 pt-3 pb-2 bg-zinc-800 border-b border-zinc-700 space-y-2">
              {needsStorePicker && (
                <div
                  ref={storePickerRef}
                  className={`rounded-lg p-2 -mx-1 ${
                    storePrompt
                      ? 'ring-2 ring-amber-500/80 bg-amber-950/30'
                      : ''
                  }`}
                >
                  <p className={`text-[10px] mb-1.5 ${storePrompt ? 'text-amber-300 font-medium' : 'text-zinc-500'}`}>
                    {storePrompt
                      ? 'Elegí un local para guardar este conteo'
                      : 'Local de este conteo'}
                  </p>
                  {stores.length === 0 && !loading ? (
                    <p className="text-xs text-zinc-500">No hay locales activos.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {stores.map(s => {
                        const selected = chosenStoreId === s.id
                        return (
                          <button
                            key={s.id}
                            type="button"
                            disabled={saving}
                            onClick={() => void selectStore(s.id)}
                            title={s.name}
                            className={`min-w-0 max-w-full truncate rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                              selected
                                ? 'border-emerald-600 bg-emerald-950/50 text-emerald-200'
                                : storePrompt
                                  ? 'border-amber-600/70 bg-zinc-700 text-zinc-200 hover:border-amber-400'
                                  : 'border-zinc-600 bg-zinc-700 text-zinc-300 hover:border-emerald-700/60'
                            }`}
                          >
                            {s.name}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {storePrompt && error && (
                    <p className="text-xs text-amber-200 mt-2">{error}</p>
                  )}
                </div>
              )}
              {countStatus === 'draft' && draftId && (
                <p className="text-[10px] text-amber-400/90">
                  Borrador guardado. Cerrá con la X para seguir cobrando y reanudar después. Finalizalo antes del cierre de caja.
                </p>
              )}
              {editedBySomeoneElse && (
                <p className="text-[10px] text-amber-300/90" title={lastEditedByName ?? undefined}>
                  Anotó {recordedByName ?? 'la cajera'}. Editado después por {lastEditedByName ?? 'otra persona'}.
                </p>
              )}
              <p className="text-[10px] text-zinc-500">
                Si lo dejás vacío, no entra en el conteo (packs, ofertas, o lo que no hay). + y − suman o restan un peso a lo ya anotado.
              </p>
              {!loading && rows.length > 0 && (
                <>
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    maxLength={100}
                    placeholder="Buscar producto o PLU…"
                    disabled={saving}
                    className="w-full rounded-lg bg-zinc-700 border border-zinc-600 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                  />
                  {searchNorm && (
                    <p className="text-[10px] text-zinc-500">
                      {filteredRows.length} de {rows.length} productos
                    </p>
                  )}
                </>
              )}
            </div>
            <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">

              {loading && (
                <p className="text-sm text-zinc-500 text-center py-8">Cargando productos…</p>
              )}

              {!loading && rows.length === 0 && !error && (
                <p className="text-sm text-zinc-500 text-center py-8">No hay productos en el catálogo.</p>
              )}

              {!loading && filteredRows.length === 0 && rows.length > 0 && (
                <p className="text-sm text-zinc-500 text-center py-6">Ningún producto coincide con la búsqueda.</p>
              )}

              {!loading &&
                filteredRows.map(row => {
                  const isAdjusting = adjust?.productId === row.product.id
                  return (
                    <div
                      key={row.product.id}
                      className="rounded-xl border border-zinc-600 bg-zinc-700 px-3 py-2.5 space-y-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0 text-[10px] text-zinc-500 tabular-nums w-8">
                          {row.product.pluNumber}
                        </span>
                        <p className="min-w-0 flex-1 text-sm text-white truncate" title={row.product.name}>
                          {row.product.name}
                        </p>
                        <span className="shrink-0 text-[10px] text-zinc-600 uppercase">
                          {row.product.unit === 'kg' ? 'kg' : 'unid.'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {(row.product.unit === 'kg' || row.product.unit === 'unit') && (
                          <>
                            {row.product.unit === 'kg' ? (
                              <div className="col-span-1">
                                <label className="block text-[10px] text-zinc-500 mb-0.5">Kg anotados</label>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => toggleAdjust(row.product.id, 'kg', 'subtract')}
                                    className={`shrink-0 h-8 w-8 rounded-lg border text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 ${
                                      isAdjusting && adjust.direction === 'subtract'
                                        ? 'border-emerald-600 bg-zinc-800 text-emerald-300'
                                        : 'border-zinc-600'
                                    }`}
                                    title="Restar un peso de lo anotado"
                                  >
                                    −
                                  </button>
                                  <DecimalInput
                                    value={row.kgText}
                                    onChange={v => updateRow(row.product.id, { kgText: v })}
                                    maxDecimals={3}
                                    weightMode
                                    disabled={saving}
                                    placeholder="0,000"
                                    className="min-w-0 flex-1 rounded-lg bg-zinc-800 border border-zinc-600 px-2.5 py-1.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                                  />
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => toggleAdjust(row.product.id, 'kg', 'add')}
                                    className={`shrink-0 h-8 w-8 rounded-lg border text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 ${
                                      isAdjusting && adjust.direction === 'add'
                                        ? 'border-emerald-600 bg-zinc-800 text-emerald-300'
                                        : 'border-zinc-600'
                                    }`}
                                    title="Sumar un peso a lo anotado"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="col-span-1">
                                <label className="block text-[10px] text-zinc-500 mb-0.5">Unidades anotadas</label>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => toggleAdjust(row.product.id, 'units', 'subtract')}
                                    className={`shrink-0 h-8 w-8 rounded-lg border text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 ${
                                      isAdjusting && adjust.direction === 'subtract'
                                        ? 'border-emerald-600 bg-zinc-800 text-emerald-300'
                                        : 'border-zinc-600'
                                    }`}
                                    title="Restar unidades de lo anotado"
                                  >
                                    −
                                  </button>
                                  <NumericInput
                                    value={row.unitsText}
                                    onChange={v => updateRow(row.product.id, { unitsText: v })}
                                    disabled={saving}
                                    placeholder="0"
                                    className="min-w-0 flex-1 rounded-lg bg-zinc-800 border border-zinc-600 px-2.5 py-1.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                                  />
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => toggleAdjust(row.product.id, 'units', 'add')}
                                    className={`shrink-0 h-8 w-8 rounded-lg border text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 ${
                                      isAdjusting && adjust.direction === 'add'
                                        ? 'border-emerald-600 bg-zinc-800 text-emerald-300'
                                        : 'border-zinc-600'
                                    }`}
                                    title="Sumar unidades a lo anotado"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            )}
                            <div className="col-span-1 sm:col-span-2">
                              <label className="block text-[10px] text-zinc-500 mb-0.5">Nota (opcional)</label>
                              <input
                                type="text"
                                value={row.notes}
                                maxLength={500}
                                disabled={saving}
                                onChange={e => updateRow(row.product.id, { notes: e.target.value })}
                                className="w-full rounded-lg bg-zinc-800 border border-zinc-600 px-2.5 py-1.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                                placeholder="—"
                              />
                            </div>
                          </>
                        )}
                      </div>
                      {isAdjusting && (
                        <div className="flex items-center gap-2 min-w-0 rounded-lg bg-zinc-800 border border-zinc-600 px-2 py-1.5">
                          <p className="shrink-0 text-[10px] text-zinc-400">
                            {adjust.direction === 'add' ? 'Sumar' : 'Restar'}
                          </p>
                          {adjust.kind === 'kg' ? (
                            <DecimalInput
                              value={deltaText}
                              onChange={setDeltaText}
                              maxDecimals={3}
                              weightMode
                              autoFocus
                              disabled={saving}
                              placeholder="ej. 2,3"
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  applyAdjust(row)
                                }
                                if (e.key === 'Escape') {
                                  setAdjust(null)
                                  setDeltaText('')
                                }
                              }}
                              className="min-w-0 flex-1 rounded-md bg-zinc-900 border border-zinc-600 px-2 py-1 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                            />
                          ) : (
                            <NumericInput
                              value={deltaText}
                              onChange={setDeltaText}
                              autoFocus
                              disabled={saving}
                              placeholder="ej. 4"
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  applyAdjust(row)
                                }
                                if (e.key === 'Escape') {
                                  setAdjust(null)
                                  setDeltaText('')
                                }
                              }}
                              className="min-w-0 flex-1 rounded-md bg-zinc-900 border border-zinc-600 px-2 py-1 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                            />
                          )}
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => applyAdjust(row)}
                            className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                          >
                            Aplicar
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}

              {error && !storePrompt && (
                <div className="rounded-lg bg-red-950/40 border border-red-800/60 px-3 py-2">
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-700 px-5 py-3">
              {error && !storePrompt && (
                <p className="min-w-0 flex-1 text-xs text-red-300 truncate" title={error}>{error}</p>
              )}
              <button
                type="button"
                onClick={() => handleCancelClick()}
                disabled={saving}
                className="shrink-0 rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleFinalizeClick}
                disabled={saving || loading || rows.length === 0}
                className="shrink-0 rounded-lg px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
              >
                {saving ? 'Guardando…' : countStatus === 'final' ? 'Guardar cambios' : 'Finalizar conteo'}
              </button>
            </div>
          </>
        )}
      </div>

      {confirmFinalize && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
          onClick={e => {
            if (e.target === e.currentTarget && !saving) setConfirmFinalize(false)
          }}
        >
          <div className="bg-zinc-800 rounded-2xl border border-zinc-700 w-full max-w-sm p-6 space-y-4 shadow-xl">
            <h2 className="text-base font-semibold text-white">
              {countStatus === 'final' ? '¿Guardar los cambios?' : '¿Finalizar el conteo?'}
            </h2>
            <p className="text-sm text-zinc-400">
              {countStatus === 'final'
                ? `Se actualiza el conteo${storeName ? ` de ${storeName}` : ''}. La anotación original de la cajera se conserva para comparar.`
                : `Queda registrado${storeName ? ` para ${storeName}` : ''}. Mientras la caja no esté cerrada se puede volver a abrir y corregir (cliente de último minuto). El admin también puede editarlo después; esa edición queda marcada aparte.`}
            </p>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setConfirmFinalize(false)}
                disabled={saving}
                className="flex-1 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-40"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => void handleFinalizeConfirm()}
                disabled={saving}
                className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors disabled:opacity-40"
              >
                {saving ? 'Guardando…' : countStatus === 'final' ? 'Sí, guardar' : 'Sí, finalizar'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmCancel && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
          onClick={e => {
            if (e.target === e.currentTarget && !saving) setConfirmCancel(false)
          }}
        >
          <div className="bg-zinc-800 rounded-2xl border border-zinc-700 w-full max-w-sm p-6 space-y-4 shadow-xl">
            <h2 className="text-base font-semibold text-white">
              {countStatus === 'final' ? '¿Descartar los cambios?' : '¿Borrar lo anotado?'}
            </h2>
            <p className="text-sm text-zinc-400">
              {countStatus === 'final'
                ? 'Los kilos que cambiaste ahora no se guardan. El conteo ya registrado se mantiene como estaba.'
                : 'Se borra todo lo cargado en este conteo. Esta acción no se puede deshacer.'}
            </p>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                disabled={saving}
                className="flex-1 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-40"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => void handleCancelConfirm()}
                disabled={saving}
                className="flex-1 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white font-semibold transition-colors disabled:opacity-40"
              >
                {saving ? 'Borrando…' : countStatus === 'final' ? 'Sí, descartar' : 'Sí, borrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
