/**
 * Modal para registrar vales / adelantos de carniceros (requiere turno abierto).
 *
 * Modos:
 *   - Productos: registra ítems de producto (corte, peso, precio) como una venta.
 *     El total se descuenta del salario semanal.
 *   - Adelanto en efectivo: retiro simple de efectivo del sueldo (sin productos).
 */
import { useEffect, useRef, useState } from 'react'
import { isVisibleForVales, namesMatch, valeVisitorCandidates, searchProductsByQuery } from '@carniceria/shared'
import DecimalInput from '../components/DecimalInput'
import NumericInput from '../components/NumericInput'
import {
  addDaysYmd,
  formatARS,
  toLocalDate,
  toLocalDateTime,
  weekStartMondayLocalYmd,
} from '../lib/datetime'
import { parseDecimalInput, parseNumericInput } from '../lib/numericInput'
import { useCatalogSyncReload } from '../lib/useCatalogSyncReload'
import type { EmployeeRow, EmployeeValeRow, ProductRow, ValeItem, WeeklyValeSummary } from '../types/hw-api'

type Mode = 'products' | 'advance'

interface DraftItem {
  id: string
  product: ProductRow
  quantityText: string
  priceText: string
}

interface Props {
  onClose: () => void
  onSaved?: () => void
  storeId: string
  viewerRole: 'admin' | 'cashier'
  viewerName: string
}

function draftItemToValeItem(d: DraftItem): ValeItem | null {
  const quantity = d.product.unit === 'kg'
    ? parseDecimalInput(d.quantityText)
    : parseNumericInput(d.quantityText)
  const price = parseNumericInput(d.priceText)
  if (quantity === null || quantity <= 0 || price === null || price <= 0) return null
  const subtotal = Math.round(quantity * price)
  return {
    productId: d.product.id,
    productName: d.product.name,
    unit: d.product.unit,
    quantity,
    unitPrice: price,
    subtotal,
  }
}

export default function ValesModal({ onClose, onSaved, storeId, viewerRole, viewerName }: Props) {
  const weekStart = weekStartMondayLocalYmd()
  const weekEnd = addDaysYmd(weekStart, 6)
  const weekLabel = `${toLocalDate(`${weekStart}T12:00:00.000Z`)} – ${toLocalDate(`${weekEnd}T12:00:00.000Z`)}`

  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [allEmployees, setAllEmployees] = useState<EmployeeRow[]>([])
  const [visitorIds, setVisitorIds] = useState<Set<string>>(new Set())
  const [showVisitors, setShowVisitors] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [vales, setVales] = useState<EmployeeValeRow[]>([])
  const [summary, setSummary] = useState<WeeklyValeSummary | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [mode, setMode] = useState<Mode>('products')
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)

  // Modo productos — borrador
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [productQuery, setProductQuery] = useState('')
  const [showProductSuggestions, setShowProductSuggestions] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState('')
  const [quantityText, setQuantityText] = useState('')
  const [priceText, setPriceText] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const nextDraftId = useRef(0)

  // Modo adelanto
  const [advanceAmountText, setAdvanceAmountText] = useState('')
  const [advanceDescription, setAdvanceDescription] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [valeViewerNames, setValeViewerNames] = useState<string[]>(
    viewerName.trim() ? [viewerName.trim()] : [],
  )

  const selected = employees.find(e => e.id === selectedId) ?? null
  const selectedProduct = products.find(p => p.id === selectedProductId) ?? null
  const draftTotal = draftItems.reduce((sum, d) => {
    const item = draftItemToValeItem(d)
    return sum + (item?.subtotal ?? 0)
  }, 0)

  async function resolveValeViewerNames(): Promise<string[]> {
    const names = viewerName.trim() ? [viewerName.trim()] : []
    if (viewerRole === 'cashier') {
      const open = await window.hw.getStoreOpenShift()
      const cached = open.ok ? open.data?.userName?.trim() : ''
      if (cached && !names.some(n => n.toLowerCase() === cached.toLowerCase())) {
        names.push(cached)
      }
    }
    setValeViewerNames(names)
    return names
  }

  async function loadEmployees(visitors: Set<string> = visitorIds) {
    setLoadingList(true)
    setError(null)
    const viewerNames = await resolveValeViewerNames()
    const primary = viewerNames[0] ?? viewerName
    const res = await window.hw.listEmployees({ includeArchived: true })
    setLoadingList(false)
    if (!res.ok) { setError(res.error ?? 'Error al cargar empleados.'); return }
    setAllEmployees(res.data)
    const visible = res.data.filter(e =>
      isVisibleForVales({
        personId: e.id,
        personName: e.name,
        personKind: e.kind,
        homeStoreId: e.homeStoreId,
        currentStoreId: storeId,
        visitorIds: visitors,
        viewerRole,
        viewerName: primary,
        viewerNames,
        personActive: e.active,
      }),
    )
    setEmployees(visible)
    if (visible.length > 0 && !selectedId) setSelectedId(visible[0]!.id)
    if (selectedId && !visible.some(e => e.id === selectedId)) {
      setSelectedId(visible[0]?.id ?? null)
    }
  }

  async function loadDetail(employeeId: string) {
    setLoadingDetail(true)
    setError(null)
    setSuccess(null)
    const [valesRes, summaryRes] = await Promise.all([
      window.hw.listVales({ employeeId, weekStart, weekEnd }),
      window.hw.getWeeklyValeSummary({ employeeId, weekStart }),
    ])
    setLoadingDetail(false)
    if (!valesRes.ok) { setError(valesRes.error ?? 'Error al listar vales.'); setVales([]); setSummary(null); return }
    if (!summaryRes.ok) { setError(summaryRes.error ?? 'Error al calcular resumen.'); setVales(valesRes.data); setSummary(null); return }
    setVales(valesRes.data)
    setSummary(summaryRes.data)
  }

  async function loadProducts(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoadingProducts(true)
    const res = await window.hw.getProducts()
    if (!opts?.silent) setLoadingProducts(false)
    if (!res.ok) return
    setProducts(res.data)
  }

  useEffect(() => {
    void loadEmployees()
    void loadProducts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useCatalogSyncReload(() => { void loadProducts({ silent: true }) })

  useEffect(() => {
    if (!selectedId) { setVales([]); setSummary(null); return }
    void loadDetail(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  function handleProductChange(productId: string) {
    setSelectedProductId(productId)
    setAddError(null)
    const p = products.find(x => x.id === productId)
    if (p) {
      setProductQuery(p.name)
      setPriceText(p.price != null ? String(p.price) : '')
    }
    setQuantityText('')
    setShowProductSuggestions(false)
  }

  const productSuggestions: ProductRow[] = searchProductsByQuery(products, productQuery, {
    nameOf: p => p.name,
    pluOf: p => p.pluNumber,
  })

  function handleAddItem() {
    setAddError(null)
    if (!selectedProduct) { setAddError('Seleccioná un producto.'); return }

    const quantity = selectedProduct.unit === 'kg'
      ? parseDecimalInput(quantityText)
      : parseNumericInput(quantityText)
    if (quantity === null || quantity <= 0) {
      setAddError(selectedProduct.unit === 'kg' ? 'Ingresá un peso válido (ej: 1,5).' : 'Ingresá una cantidad válida.')
      return
    }

    const price = parseNumericInput(priceText)
    if (price === null || price <= 0) { setAddError('Ingresá un precio válido.'); return }

    const id = String(nextDraftId.current++)
    setDraftItems(prev => [...prev, { id, product: selectedProduct, quantityText, priceText }])
    setQuantityText('')
  }

  function handleRemoveItem(id: string) {
    setDraftItems(prev => prev.filter(d => d.id !== id))
  }

  function resetForm() {
    setDraftItems([])
    setQuantityText('')
    setAdvanceAmountText('')
    setAdvanceDescription('')
    setFormError(null)
    setAddError(null)
    setProductQuery('')
    setSelectedProductId('')
    setPriceText('')
    setShowProductSuggestions(false)
  }

  async function handleCancelVale(id: string) {
    setError(null)
    setSuccess(null)
    setCancellingId(id)
    const res = await window.hw.cancelVale({ id })
    setCancellingId(null)
    if (!res.ok) { setError(res.error ?? 'Error al anular el vale.'); return }
    setSuccess('Vale anulado.')
    if (selectedId) void loadDetail(selectedId)
  }

  function handleSelectEmployee(id: string) {
    setSelectedId(id)
    setSuccess(null)
    resetForm()
  }

  async function handleRegister() {
    if (!selectedId || !selected) return
    setFormError(null)
    setSuccess(null)

    if (mode === 'products') {
      if (draftItems.length === 0) { setFormError('Agregá al menos un producto o usá el modo Adelanto en efectivo.'); return }
      const items: ValeItem[] = []
      for (const d of draftItems) {
        const item = draftItemToValeItem(d)
        if (!item) { setFormError('Verificá las cantidades y precios antes de registrar.'); return }
        items.push(item)
      }
      const total = items.reduce((s, i) => s + i.subtotal, 0)
      if (total <= 0) { setFormError('El total debe ser mayor a 0.'); return }

      setSaving(true)
      const res = await window.hw.registerVale({ employeeId: selectedId, amount: total, description: null, items })
      setSaving(false)

      if (!res.ok) {
        setFormError(res.code === 'NO_SHIFT' ? 'Se necesita un turno abierto para registrar un vale.' : (res.error ?? 'No se pudo registrar el vale.'))
        return
      }
      resetForm()
      setSuccess(`Vale de ${formatARS(total)} registrado para ${selected.name}.`)
      onSaved?.()
      await loadDetail(selectedId)
    } else {
      const amount = parseNumericInput(advanceAmountText)
      if (amount === null || amount <= 0) { setFormError('Ingresá un monto válido mayor a 0.'); return }

      setSaving(true)
      const res = await window.hw.registerVale({ employeeId: selectedId, amount, description: advanceDescription.trim() || null, items: null })
      setSaving(false)

      if (!res.ok) {
        setFormError(res.code === 'NO_SHIFT' ? 'Se necesita un turno abierto para registrar un vale.' : (res.error ?? 'No se pudo registrar el vale.'))
        return
      }
      resetForm()
      setSuccess(`Adelanto de ${formatARS(amount)} registrado para ${selected.name}.`)
      onSaved?.()
      await loadDetail(selectedId)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget && !saving) onClose() }}
    >
      <div className="flex flex-col bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 min-w-0 border-b border-zinc-700 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-white truncate">Vales / adelantos</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate" title={weekLabel}>
              Semana {weekLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors disabled:opacity-50"
            aria-label="Cerrar"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex min-h-0">
          {/* Lista empleados */}
          <div className="w-40 shrink-0 border-r border-zinc-800 overflow-y-auto">
            {loadingList && <p className="text-xs text-zinc-500 p-3">Cargando…</p>}
            {!loadingList && employees.length === 0 && (
              <p className="text-xs text-zinc-500 p-3">Nadie para vales en este local.</p>
            )}
            {employees.map(emp => {
              const active = emp.id === selectedId
              return (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => handleSelectEmployee(emp.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-zinc-800/80 transition-colors min-w-0 ${
                    active ? 'bg-zinc-800/60 border-l-2 border-l-zinc-500 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <span className="block text-xs font-medium truncate" title={emp.name}>{emp.name}</span>
                  {emp.kind === 'cashier' && (
                    <span className="block text-[10px] text-zinc-600">Cajera</span>
                  )}
                  {!emp.active && !valeViewerNames.some(n => namesMatch(emp.name, n)) && (
                    <span className="block text-[10px] text-zinc-600">Ficha inactiva</span>
                  )}
                  {visitorIds.has(emp.id) && (
                    <span className="block text-[10px] text-zinc-600">Visitante</span>
                  )}
                </button>
              )
            })}
            {valeVisitorCandidates({
              people: allEmployees.map(e => ({ id: e.id, name: e.name, homeStoreId: e.homeStoreId, kind: e.kind, active: e.active })),
              currentStoreId: storeId,
              visitorIds,
              viewerRole,
              viewerName: valeViewerNames[0] ?? viewerName,
              viewerNames: valeViewerNames,
            }).length > 0 && (
              <div className="p-2">
                <button
                  type="button"
                  onClick={() => setShowVisitors(v => !v)}
                  className="w-full text-left text-[11px] text-emerald-400 hover:text-emerald-300"
                >
                  {showVisitors ? 'Ocultar' : 'Agregar visitante'}
                </button>
                {showVisitors && valeVisitorCandidates({
                  people: allEmployees.map(e => ({ id: e.id, name: e.name, homeStoreId: e.homeStoreId, kind: e.kind, active: e.active })),
                  currentStoreId: storeId,
                  visitorIds,
                  viewerRole,
                  viewerName: valeViewerNames[0] ?? viewerName,
                  viewerNames: valeViewerNames,
                }).map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      const next = new Set(visitorIds)
                      next.add(c.id)
                      setVisitorIds(next)
                      setShowVisitors(false)
                      void loadEmployees(next)
                      setSelectedId(c.id)
                    }}
                    className="mt-1 w-full truncate rounded-md px-2 py-1 text-left text-[11px] text-zinc-300 hover:bg-zinc-800"
                    title={c.name}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Detalle */}
          <div className="flex-1 min-w-0 overflow-y-auto px-4 py-3 space-y-4">
            {error && (
              <div className="rounded-lg bg-red-950/40 border border-red-800/60 px-3 py-2">
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}
            {!selected && !loadingList && (
              <p className="text-sm text-zinc-500 text-center py-8">Seleccioná un empleado.</p>
            )}
            {selected && (
              <>
                {/* Resumen semanal */}
                <div>
                  <p className="text-sm font-semibold text-white truncate mb-2" title={selected.name}>{selected.name}</p>
                  {loadingDetail ? (
                    <p className="text-xs text-zinc-500">Cargando semana…</p>
                  ) : summary ? (
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-zinc-950/80 border border-zinc-800 px-2 py-2">
                        <p className="text-[10px] text-zinc-500">Sueldo</p>
                        <p className="text-xs font-medium text-zinc-200 tabular-nums">{formatARS(summary.weeklyWage)}</p>
                      </div>
                      <div className="rounded-lg bg-zinc-950/80 border border-zinc-800 px-2 py-2">
                        <p className="text-[10px] text-zinc-500">Vales</p>
                        <p className="text-xs font-medium text-zinc-200 tabular-nums">{formatARS(summary.totalVales)}</p>
                      </div>
                      <div className="rounded-lg bg-zinc-950/80 border border-zinc-800 px-2 py-2">
                        <p className="text-[10px] text-zinc-500">Neto</p>
                        <p className="text-xs font-medium text-emerald-300 tabular-nums">{formatARS(summary.netToPay)}</p>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Vales registrados */}
                <div>
                  <p className="text-[11px] font-medium text-zinc-400 mb-1.5">Vales de la semana</p>
                  {loadingDetail ? null : vales.length === 0 ? (
                    <p className="text-xs text-zinc-600">Ningún vale esta semana.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {vales.map(v => (
                        <li key={v.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-2.5 py-1.5">
                          <div className="flex items-start gap-2 min-w-0">
                            <div className="min-w-0 flex-1">
                              {v.items && v.items.length > 0 ? (
                                <ul className="space-y-0.5 mb-0.5">
                                  {v.items.map((item, idx) => (
                                    <li key={idx} className="text-[10px] text-zinc-400 truncate">
                                      {item.productName} — {item.unit === 'kg' ? `${item.quantity} kg × ${formatARS(item.unitPrice)}/kg` : `${item.quantity} u × ${formatARS(item.unitPrice)}`} = {formatARS(item.subtotal)}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-zinc-300 truncate" title={v.description ?? undefined}>
                                  {v.description?.trim() || 'Adelanto en efectivo'}
                                </p>
                              )}
                              <p className="text-[10px] text-zinc-600">{toLocalDateTime(v.paidAt)}</p>
                              {v.cancelledAt && (
                                <p className="text-[10px] text-red-400/80">Anulado</p>
                              )}
                            </div>
                            <div className="shrink-0 flex flex-col items-end gap-1">
                              <span className={`text-xs font-medium tabular-nums ${v.cancelledAt ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>{formatARS(v.amount)}</span>
                              {!v.cancelledAt && (
                                <button
                                  type="button"
                                  onClick={() => void handleCancelVale(v.id)}
                                  disabled={cancellingId === v.id || saving}
                                  className="text-[10px] text-zinc-500 hover:text-red-400 disabled:opacity-50"
                                >
                                  {cancellingId === v.id ? 'Anulando…' : 'Anular'}
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Formulario de registro */}
                <div className="rounded-xl border border-zinc-700 bg-zinc-950/40 p-3 space-y-3">
                  {/* Tabs */}
                  <div className="flex rounded-lg bg-zinc-800/60 p-0.5 gap-0.5">
                    {(['products', 'advance'] as Mode[]).map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => { setMode(m); resetForm() }}
                        disabled={saving}
                        className={`flex-1 rounded-md py-1.5 text-[11px] font-medium transition-colors ${
                          mode === m ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {m === 'products' ? 'Con productos' : 'Adelanto en efectivo'}
                      </button>
                    ))}
                  </div>

                  {/* Modo: Con productos */}
                  {mode === 'products' && (
                    <div className="space-y-2.5">
                      {/* Selector de producto */}
                      {loadingProducts ? (
                        <p className="text-xs text-zinc-500">Cargando catálogo…</p>
                      ) : products.length === 0 ? (
                        <p className="text-xs text-zinc-400">Sin productos con precio. Configurá el catálogo desde el panel admin.</p>
                      ) : (
                        <>
                          <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
                            <div className="relative min-w-0">
                              <label className="block text-[10px] text-zinc-500 mb-1">Producto (nombre o PLU)</label>
                              <input
                                type="text"
                                value={productQuery}
                                onChange={e => {
                                  setProductQuery(e.target.value)
                                  setSelectedProductId('')
                                  setShowProductSuggestions(true)
                                }}
                                onFocus={() => productQuery.trim() && setShowProductSuggestions(true)}
                                onBlur={() => setTimeout(() => setShowProductSuggestions(false), 150)}
                                disabled={saving}
                                autoComplete="off"
                                placeholder="ej. asado o 5"
                                className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-2 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                              />
                              {showProductSuggestions && productSuggestions.length > 0 && (
                                <ul className="absolute top-full mt-1 left-0 right-0 z-50 max-h-56 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-xl">
                                  {productSuggestions.map(p => (
                                    <li key={p.id}>
                                      <button
                                        type="button"
                                        onMouseDown={() => handleProductChange(p.id)}
                                        className="w-full px-2 py-1.5 text-left hover:bg-zinc-800 transition-colors min-w-0"
                                      >
                                        <span className="text-[10px] font-bold text-zinc-500 mr-1">{p.pluNumber}</span>
                                        <span className="text-[10px] text-zinc-200 truncate" title={p.name}>{p.name}</span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div className="w-24">
                              <label className="block text-[10px] text-zinc-500 mb-1">
                                {selectedProduct?.unit === 'kg' ? 'Peso (kg)' : 'Cantidad'}
                              </label>
                              {selectedProduct?.unit === 'kg' ? (
                                <DecimalInput
                                  value={quantityText}
                                  onChange={setQuantityText}
                                  weightMode
                                  maxDecimals={3}
                                  disabled={saving}
                                  placeholder="0,000"
                                  className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-2 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                                />
                              ) : (
                                <NumericInput
                                  value={quantityText}
                                  onChange={setQuantityText}
                                  disabled={saving}
                                  placeholder="0"
                                  className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-2 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                                />
                              )}
                            </div>
                            <div className="w-28">
                              <label className="block text-[10px] text-zinc-500 mb-1">
                                Precio {selectedProduct?.unit === 'kg' ? '$/kg' : '$/u'}
                              </label>
                              <NumericInput
                                value={priceText}
                                onChange={setPriceText}
                                disabled={saving}
                                placeholder="0"
                                className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-2 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                              />
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleAddItem}
                            disabled={saving || !selectedProductId || !quantityText || !priceText}
                            className="w-full rounded-lg py-1.5 text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-white transition-colors disabled:opacity-50"
                          >
                            + Agregar ítem
                          </button>
                          {addError && <p className="text-xs text-red-300">{addError}</p>}
                        </>
                      )}

                      {/* Ítems agregados */}
                      {draftItems.length > 0 && (
                        <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                          {draftItems.map(d => {
                            const item = draftItemToValeItem(d)
                            return (
                              <div key={d.id} className="flex items-center gap-2 min-w-0">
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs text-zinc-200 truncate" title={d.product.name}>{d.product.name}</p>
                                  <p className="text-[10px] text-zinc-500">
                                    {d.product.unit === 'kg'
                                      ? `${d.quantityText} kg × $${d.priceText}/kg`
                                      : `${d.quantityText} u × $${d.priceText}`}
                                    {item && <span className="text-zinc-400"> = {formatARS(item.subtotal)}</span>}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(d.id)}
                                  disabled={saving}
                                  className="shrink-0 rounded p-0.5 text-zinc-600 hover:text-red-400 transition-colors"
                                  aria-label="Quitar ítem"
                                >
                                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                  </svg>
                                </button>
                              </div>
                            )
                          })}
                          <div className="border-t border-zinc-800 pt-1.5 flex items-center justify-between">
                            <p className="text-[10px] text-zinc-500">{draftItems.length} ítem{draftItems.length !== 1 ? 's' : ''}</p>
                            <p className="text-sm font-semibold text-zinc-200 tabular-nums">Total: {formatARS(draftTotal)}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Modo: Adelanto en efectivo */}
                  {mode === 'advance' && (
                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[10px] text-zinc-500 mb-1">Monto ($)</label>
                        <NumericInput
                          value={advanceAmountText}
                          onChange={setAdvanceAmountText}
                          disabled={saving}
                          placeholder="0"
                          className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-zinc-500 mb-1">Descripción (opcional)</label>
                        <input
                          type="text"
                          value={advanceDescription}
                          maxLength={200}
                          disabled={saving}
                          onChange={e => setAdvanceDescription(e.target.value)}
                          placeholder="Ej. adelanto familiar…"
                          className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                        />
                      </div>
                    </div>
                  )}

                  {formError && <p className="text-xs text-red-300">{formError}</p>}
                  {success && <p className="text-xs text-emerald-300">{success}</p>}

                  <button
                    type="button"
                    onClick={() => void handleRegister()}
                    disabled={saving || loadingDetail || (mode === 'products' && draftItems.length === 0)}
                    className="w-full rounded-lg py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Registrando…' : 'Registrar vale'}
                  </button>
                  <p className="text-[10px] text-zinc-600">Se descuenta de la caja del turno abierto.</p>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex justify-end border-t border-zinc-700 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="shrink-0 rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
