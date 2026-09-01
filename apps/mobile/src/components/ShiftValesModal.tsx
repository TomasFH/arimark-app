/**
 * Vales / adelantos del POS móvil. Efectivo baja caja; productos no.
 */
import { isVisibleForVales, valeVisitorCandidates } from '@carniceria/shared'
import { useEffect, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useBackLayer } from '../lib/backStack'
import { useKeyboardInset } from '../lib/keyboardInset'
import NumericInput from './NumericInput'
import DecimalInput from './DecimalInput'
import { parseDecimalInput, parseNumericInput } from '../lib/numericInput'
import { formatMoney } from '../lib/adminFirestore'
import { db } from '../lib/db'
import { searchCatalog } from '../lib/catalog'
import { listCachedEmployees, refreshEmployeesCache, refreshWeekPayrollCache } from '../lib/posCaches'
import { buildCashValeRecords, buildProductValeRecord } from '../lib/posPayrollWrite'
import { addDaysYmd, formatYmd, valeInLocalWeek, weekStartMondayLocalYmd } from '../lib/week'
import type { CachedEmployee, CatalogProduct, LocalShift, LocalVale, ValeItem } from '../types/pos'

type Mode = 'advance' | 'products'

interface Props {
  shift: LocalShift
  catalog: CatalogProduct[]
  viewerRole: 'admin' | 'cashier'
  viewerName: string
  onSaved: () => void
  onClose: () => void
}

function draftToItem(
  product: CatalogProduct,
  quantityText: string,
  priceText: string,
): ValeItem | null {
  const quantity = product.unit === 'kg'
    ? parseDecimalInput(quantityText)
    : parseNumericInput(quantityText)
  const price = parseNumericInput(priceText)
  if (quantity === null || quantity <= 0 || price === null || price <= 0) return null
  return {
    productId: product.productId,
    productName: product.name,
    unit: product.unit,
    quantity,
    unitPrice: price,
    subtotal: Math.round(quantity * price),
  }
}

export function ShiftValesModal({ shift, catalog, viewerRole, viewerName, onSaved, onClose }: Props) {
  useBackLayer(true, onClose)
  const keyboardInset = useKeyboardInset()
  const weekStart = weekStartMondayLocalYmd()
  const weekEnd = addDaysYmd(weekStart, 6)

  const [employees, setEmployees] = useState<CachedEmployee[]>([])
  const [allEmployees, setAllEmployees] = useState<CachedEmployee[]>([])
  const [visitorIds, setVisitorIds] = useState<Set<string>>(new Set())
  const [showVisitors, setShowVisitors] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [vales, setVales] = useState<LocalVale[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('advance')
  const [advanceAmount, setAdvanceAmount] = useState('')
  const [advanceNote, setAdvanceNote] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [quantityText, setQuantityText] = useState('')
  const [priceText, setPriceText] = useState('')
  const [draftItems, setDraftItems] = useState<ValeItem[]>([])

  const selected = employees.find(e => e.id === selectedId) ?? null
  const valeViewerNames = [viewerName, shift.displayName].map(n => n.trim()).filter(Boolean)
  const valeViewerPrimary = valeViewerNames[0] ?? viewerName
  const weekVales = useMemo(
    () => vales.filter(v => valeInLocalWeek(v.paidAt, weekStart, weekEnd)),
    [vales, weekStart, weekEnd],
  )
  const totalVales = weekVales.reduce((s, v) => s + v.amount, 0)
  const remaining = Math.max(0, (selected?.weeklyWage ?? 0) - totalVales)

  async function reload() {
    setLoading(true)
    try {
      await refreshEmployeesCache()
      await refreshWeekPayrollCache(weekStart, weekEnd)
    } catch (err) {
      console.error('[vales] caché', err)
    }
    const list = await listCachedEmployees({ includeArchived: true })
    setAllEmployees(list)
    const visible = list.filter(e =>
      isVisibleForVales({
        personId: e.id,
        personName: e.name,
        personKind: e.kind,
        homeStoreId: e.homeStoreId ?? null,
        currentStoreId: shift.storeId,
        visitorIds,
        viewerRole,
        viewerName: valeViewerPrimary,
        viewerNames: valeViewerNames,
        personActive: !e.archivedAt,
      }),
    )
    setEmployees(visible)
    if (visible.length > 0 && !selectedId) setSelectedId(visible[0].id)
    setLoading(false)
  }

  useEffect(() => { void reload() }, [])

  useEffect(() => {
    if (!selectedId) { setVales([]); return }
    void db.vales.where('employeeId').equals(selectedId).toArray()
      .then(rows => setVales(rows.sort((a, b) => b.paidAt.localeCompare(a.paidAt))))
  }, [selectedId, success])

  const filteredCatalog = searchCatalog(catalog, productQuery)

  function addDraftItem() {
    const product = catalog.find(p => p.productId === selectedProductId)
    if (!product) { setError('Elegí un producto.'); return }
    const item = draftToItem(product, quantityText, priceText)
    if (!item) { setError('Verificá cantidad y precio.'); return }
    setDraftItems(prev => [...prev, item])
    setProductQuery('')
    setSelectedProductId('')
    setQuantityText('')
    setPriceText('')
    setError(null)
  }

  async function handleRegister() {
    if (!selected) return
    setError(null)
    setSuccess(null)
    setSaving(true)
    try {
      const now = new Date().toISOString()
      if (mode === 'advance') {
        const amount = parseNumericInput(advanceAmount)
        if (amount === null || amount <= 0) {
          setError('Ingresá un monto mayor a 0.')
          setSaving(false)
          return
        }
        const { vale, expense } = buildCashValeRecords({
          valeId: uuidv4(),
          expenseId: uuidv4(),
          employee: selected,
          shiftId: shift.id,
          storeId: shift.storeId,
          amount,
          description: advanceNote.trim() ? advanceNote.trim().slice(0, 200) : null,
          recordedBy: shift.userId,
          now,
        })
        await db.transaction('rw', db.vales, db.expenses, async () => {
          await db.vales.put(vale)
          await db.expenses.put(expense)
        })
        setAdvanceAmount('')
        setAdvanceNote('')
        setSuccess(`Adelanto de ${formatMoney(amount)} para ${selected.name}.`)
      } else {
        if (draftItems.length === 0) {
          setError('Agregá al menos un producto o usá adelanto en efectivo.')
          setSaving(false)
          return
        }
        const vale = buildProductValeRecord({
          valeId: uuidv4(),
          employee: selected,
          shiftId: shift.id,
          storeId: shift.storeId,
          items: draftItems,
          recordedBy: shift.userId,
          now,
        })
        await db.vales.put(vale)
        setDraftItems([])
        setSuccess(`Vale de ${formatMoney(vale.amount)} para ${selected.name}.`)
      }
      onSaved()
    } catch (err) {
      console.error('[vales] guardar', err)
      setError('No se pudo guardar el vale.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/80"
      style={{ paddingBottom: keyboardInset }}
    >
      <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-gray-900">
        <div className="flex items-center justify-between gap-2 border-b border-gray-800 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-white" title="Vales / adelantos">Vales / adelantos</h2>
            <p className="truncate text-[11px] text-gray-500" title={`${formatYmd(weekStart)} – ${formatYmd(weekEnd)}`}>
              Semana {formatYmd(weekStart)} – {formatYmd(weekEnd)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-2xl leading-none text-gray-400">×</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          {loading && <p className="text-center text-sm text-gray-400">Cargando empleados…</p>}
          {!loading && allEmployees.length === 0 && (
            <p className="text-center text-sm text-orange-400">
              No hay empleados en caché. Conectate una vez para bajar la lista.
            </p>
          )}
          {!loading && allEmployees.length > 0 && employees.length === 0 && (
            <p className="text-center text-sm text-gray-400">
              Nadie para vales en este local.
            </p>
          )}

          {employees.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-gray-400">Empleado</label>
              <select
                value={selectedId ?? ''}
                onChange={e => { setSelectedId(e.target.value || null); setSuccess(null); setError(null) }}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white"
              >
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
              {valeVisitorCandidates({
                people: allEmployees.map(e => ({
                  id: e.id,
                  name: e.name,
                  homeStoreId: e.homeStoreId ?? null,
                  kind: e.kind,
                  active: !e.archivedAt,
                })),
                currentStoreId: shift.storeId,
                visitorIds,
                viewerRole,
                viewerName: valeViewerPrimary,
                viewerNames: valeViewerNames,
              }).length > 0 && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowVisitors(v => !v)}
                    className="text-xs text-emerald-400"
                  >
                    {showVisitors ? 'Ocultar' : 'Agregar visitante'}
                  </button>
                  {showVisitors && valeVisitorCandidates({
                    people: allEmployees.map(e => ({
                      id: e.id,
                      name: e.name,
                      homeStoreId: e.homeStoreId ?? null,
                      kind: e.kind,
                      active: !e.archivedAt,
                    })),
                    currentStoreId: shift.storeId,
                    visitorIds,
                    viewerRole,
                    viewerName: valeViewerPrimary,
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
                        setSelectedId(c.id)
                        setEmployees(prev => {
                          const extra = allEmployees.find(e => e.id === c.id)
                          if (!extra || prev.some(e => e.id === c.id)) return prev
                          return [...prev, extra]
                        })
                      }}
                      className="mt-1 block w-full truncate rounded-lg bg-gray-800 px-3 py-2 text-left text-sm text-white"
                      title={c.name}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {selected && (
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-gray-800 px-3 py-2 text-center text-xs">
              <div>
                <p className="text-gray-500">Sueldo</p>
                <p className="font-semibold text-white">{formatMoney(selected.weeklyWage)}</p>
              </div>
              <div>
                <p className="text-gray-500">Vales</p>
                <p className="font-semibold text-amber-300">{formatMoney(totalVales)}</p>
              </div>
              <div>
                <p className="text-gray-500">Resta</p>
                <p className="font-semibold text-emerald-300">{formatMoney(remaining)}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('advance')}
              className={`rounded-xl py-2 text-sm font-semibold ${mode === 'advance' ? 'bg-red-700 text-white' : 'bg-gray-800 text-gray-300'}`}
            >
              Efectivo
            </button>
            <button
              type="button"
              onClick={() => setMode('products')}
              className={`rounded-xl py-2 text-sm font-semibold ${mode === 'products' ? 'bg-red-700 text-white' : 'bg-gray-800 text-gray-300'}`}
            >
              Productos
            </button>
          </div>

          {mode === 'advance' ? (
            <>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Monto</label>
                <NumericInput
                  value={advanceAmount}
                  onChange={setAdvanceAmount}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Nota (opcional)</label>
                <input
                  type="text"
                  value={advanceNote}
                  onChange={e => setAdvanceNote(e.target.value.slice(0, 200))}
                  maxLength={200}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-sm text-white"
                />
              </div>
            </>
          ) : (
            <>
              <div className="relative">
                <label className="mb-1 block text-xs text-gray-400">Producto</label>
                <input
                  type="text"
                  value={productQuery}
                  onChange={e => { setProductQuery(e.target.value); setSelectedProductId('') }}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white"
                  placeholder="Buscar en el catálogo…"
                />
                {productQuery.trim() && !selectedProductId && (
                  <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-700 bg-gray-800">
                    {filteredCatalog.map(p => (
                      <li key={p.productId}>
                        <button
                          type="button"
                          onMouseDown={() => {
                            setSelectedProductId(p.productId)
                            setProductQuery(p.name)
                            setPriceText(String(p.price))
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-white hover:bg-gray-700"
                        >
                          <span className="min-w-0 flex-1 truncate" title={p.name}>{p.name}</span>
                          <span className="shrink-0 text-gray-400">{formatMoney(p.price)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">
                    {catalog.find(p => p.productId === selectedProductId)?.unit === 'kg' ? 'Kg' : 'Cantidad'}
                  </label>
                  <DecimalInput
                    value={quantityText}
                    onChange={setQuantityText}
                    weightMode
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Precio</label>
                  <NumericInput
                    value={priceText}
                    onChange={setPriceText}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={addDraftItem}
                className="w-full rounded-xl bg-gray-800 py-2 text-sm font-semibold text-white"
              >
                Agregar al vale
              </button>
              {draftItems.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {draftItems.map((item, i) => (
                    <li key={`${item.productId}-${i}`} className="flex items-center justify-between gap-2 text-gray-300">
                      <span className="min-w-0 flex-1 truncate" title={item.productName}>
                        {item.productName} × {item.unit === 'kg' ? item.quantity.toFixed(3) : item.quantity}
                      </span>
                      <span className="shrink-0">{formatMoney(item.subtotal)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {weekVales.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-gray-500">Vales de esta semana</p>
              <ul className="space-y-1 text-sm text-gray-300">
                {weekVales.map(v => (
                  <li key={v.id} className="flex justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate" title={v.description ?? (v.items?.length ? 'Productos' : 'Efectivo')}>
                      {v.description ?? (v.items && v.items.length > 0 ? 'Productos' : 'Efectivo')}
                    </span>
                    <span className="shrink-0">{formatMoney(v.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="text-center text-sm font-medium text-orange-400">{error}</p>}
          {success && <p className="text-center text-sm font-medium text-emerald-400">{success}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-gray-800 p-4">
          <button type="button" onClick={onClose} className="rounded-xl bg-gray-800 py-4 font-semibold text-white">
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => { void handleRegister() }}
            disabled={saving || !selected}
            className="rounded-xl bg-red-600 py-4 font-bold text-white disabled:opacity-40"
          >
            {saving ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
