/**
 * Alta, lista y confirmación de transferencias entre locales.
 * Abrir la pantalla no vuelve a pedir Firestore si este rango ya se leyó
 * en la sesión. Actualizar sí.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  civilYmd,
  formatWeekRangeLabel,
  matchVisitMerchProducts,
  mondayWeekRange,
  normalizeCatalogSearch,
  productsForCatalogIntake,
  storeTransferLabel,
  transferOccurredAt,
  type StoreTransferUnit,
} from '@carniceria/shared'
import { AdminSectionHeader } from '../components/AdminSectionHeader'
import DecimalInput from '../components/DecimalInput'
import NumericInput from '../components/NumericInput'
import { Button, SuggestLayer, SuggestPopover } from '../components/ui'
import { formatARS } from '../lib/datetime'
import { formatIntegerWithDots, parseDecimalInput, parseNumericInput } from '../lib/numericInput'
import type { AdminProductRow, SessionInfo, StoreRow, StoreTransferRow } from '../types/hw-api'

const MIN_WEEK_OFFSET = -104

interface Props {
  session: Pick<SessionInfo, 'userId' | 'role' | 'storeId'>
  onBack: () => void
  onLogout: () => void
}

function quantityText(quantity: number, unit: StoreTransferUnit): string {
  if (unit === 'kg') return `${quantity} kg`
  if (unit === 'u') return quantity === 1 ? '1 unidad' : `${quantity} unidades`
  return quantity === 1 ? '1 cajón' : `${quantity} cajones`
}

function parseQuantity(raw: string, unit: StoreTransferUnit): number | null {
  return unit === 'kg' ? parseDecimalInput(raw) : parseNumericInput(raw)
}

export default function StoreTransfersScreen({ session, onBack, onLogout }: Props) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [reload, setReload] = useState(0)
  const refreshRef = useRef(false)
  const [stores, setStores] = useState<StoreRow[]>([])
  const [rows, setRows] = useState<StoreTransferRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const week = mondayWeekRange(weekOffset)
  const storeName = new Map(stores.map(store => [store.id, store.name]))

  useEffect(() => {
    let cancelled = false
    void window.hw.getStores().then(result => {
      if (cancelled || !result.ok) return
      setStores(result.data.filter(store => !store.archivedAt))
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const refresh = refreshRef.current
    setLoading(true)
    setError(null)
    void window.hw.listStoreTransfers({
      startIso: week.startIso,
      endIso: week.endIso,
      refresh,
    }).then(result => {
      if (cancelled) return
      if (!result.ok) {
        setError(result.error ?? 'No se pudo leer la mercadería entre locales.')
        setLoading(false)
        return
      }
      setRows(result.data)
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setError('No se pudo leer la mercadería entre locales.')
      setLoading(false)
    }).finally(() => {
      // StrictMode corre el efecto dos veces y descarta la primera.
      // La bandera se apaga recién cuando la lectura que queda termina.
      if (!cancelled) refreshRef.current = false
    })
    return () => { cancelled = true }
  }, [week.startIso, week.endIso, reload])

  function reloadList(refresh: boolean): void {
    refreshRef.current = refresh
    setReload(token => token + 1)
  }

  const caption = formatWeekRangeLabel(week.startYmd, week.endInclusiveYmd)

  return (
    <div className="flex h-full min-h-0 flex-col bg-app text-ink">
      <AdminSectionHeader
        title="Entre locales"
        subtitle={caption}
        onBack={onBack}
        onLogout={onLogout}
        actions={(
          <Button variant="secondary" size="sm" onClick={() => reloadList(true)}>
            Actualizar
          </Button>
        )}
      />
      <SuggestLayer className="min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <Button variant="secondary" size="sm" disabled={weekOffset <= MIN_WEEK_OFFSET} onClick={() => setWeekOffset(value => value - 1)}>
              Semana anterior
            </Button>
            <p className="min-w-0 truncate text-sm text-muted" title={caption}>{caption}</p>
            <Button variant="secondary" size="sm" disabled={weekOffset === 0} onClick={() => setWeekOffset(value => value + 1)}>
              Semana siguiente
            </Button>
          </div>

          <TransferForm
            stores={stores}
            defaultFromStoreId={session.storeId ?? ''}
            onCreated={() => reloadList(false)}
          />

          {error && <p className="truncate text-sm text-danger" title={error}>{error}</p>}
          {loading && <p className="text-sm text-muted">Cargando…</p>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-muted">No hay mercadería en esta semana.</p>
          )}
          <ul className="space-y-3">
            {rows.map(row => (
              <li key={row.id} className="rounded-xl border border-line bg-panel p-4">
                <TransferRow
                  row={row}
                  session={session}
                  fromName={storeName.get(row.fromStoreId) ?? row.fromStoreId}
                  toName={storeName.get(row.toStoreId) ?? row.toStoreId}
                  onChanged={() => reloadList(false)}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
      </SuggestLayer>
    </div>
  )
}

const PRODUCT_FIELD =
  'w-full rounded-lg border border-line bg-input px-3 py-2 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-line-accent'

interface TransferCatalogProduct {
  id: string
  name: string
  unit: 'kg' | 'unit'
  pluNumber: number | null
  /** Precio de lista del local de origen. Null si el corte no tiene precio. */
  price: number | null
}

function markedIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return ((index % count) + count) % count
}

function catalogPrice(price: number | null | undefined): number | null {
  return price != null && price > 0 ? price : null
}

function estimatedFromPrice(price: number, quantity: number): string {
  const amount = Math.round(price * quantity)
  return amount > 0 ? formatIntegerWithDots(String(amount)) : ''
}

function catalogForIntake(rows: AdminProductRow[]): TransferCatalogProduct[] {
  return productsForCatalogIntake(rows.filter(product => product.active && product.available)).map(product => ({
    id: product.id,
    name: product.name,
    unit: product.unit,
    pluNumber: product.pluNumber,
    price: catalogPrice(product.price),
  }))
}

function TransferForm({
  stores,
  defaultFromStoreId,
  onCreated,
}: {
  stores: StoreRow[]
  defaultFromStoreId: string
  onCreated: () => void
}) {
  const [productName, setProductName] = useState('')
  const [unit, setUnit] = useState<StoreTransferUnit>('kg')
  const [quantityRaw, setQuantityRaw] = useState('')
  const [fromStoreId, setFromStoreId] = useState(defaultFromStoreId)
  const [toStoreId, setToStoreId] = useState('')
  const [date, setDate] = useState(civilYmd())
  const [notes, setNotes] = useState('')
  const [valueRaw, setValueRaw] = useState('')
  const [unitPrice, setUnitPrice] = useState<number | null>(null)
  const valueEditedRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<TransferCatalogProduct[]>([])
  const [highlight, setHighlight] = useState(0)
  const [listHidden, setListHidden] = useState(false)
  const productRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!fromStoreId || typeof window.hw.getAllProducts !== 'function') {
      setCatalog([])
      return
    }
    let cancelled = false
    setCatalog([])
    void window.hw.getAllProducts(fromStoreId).then(result => {
      if (cancelled) return
      setCatalog(result.ok ? catalogForIntake(result.data) : [])
    })
    return () => { cancelled = true }
  }, [fromStoreId])

  const matches = useMemo(
    () => matchVisitMerchProducts(catalog, productName),
    [catalog, productName],
  )
  const queryKey = normalizeCatalogSearch(productName)
  const exact = queryKey
    ? catalog.find(product => normalizeCatalogSearch(product.name) === queryKey) ?? null
    : null
  const showAdd = Boolean(productName.trim()) && !exact
  const suggestions = useMemo(() => {
    const rows: Array<{ id: string; label: string; title: string; name: string; unit: 'kg' | 'unit' | null; pluNumber: number | null; price: number | null }> = matches.map(product => ({
      id: product.id,
      label: product.name,
      title: product.name,
      name: product.name,
      unit: product.unit,
      pluNumber: product.pluNumber,
      price: product.price,
    }))
    if (showAdd) {
      const name = productName.trim().slice(0, 80)
      rows.push({
        id: 'add',
        label: `Agregar «${name}»`,
        title: name,
        name,
        unit: null,
        pluNumber: null,
        price: null,
      })
    }
    return rows
  }, [matches, productName, showAdd])
  const listOpen = Boolean(productName.trim()) && !listHidden && suggestions.length > 0
  const current = markedIndex(highlight, suggestions.length)

  function chooseProduct(name: string, catalogUnit: 'kg' | 'unit' | null, price: number | null): void {
    const nextUnit: StoreTransferUnit = catalogUnit == null ? unit : catalogUnit === 'kg' ? 'kg' : 'u'
    const unitChanged = catalogUnit != null && unit !== nextUnit
    const qtyRaw = unitChanged ? '' : quantityRaw
    setProductName(name.slice(0, 80))
    if (unitChanged) {
      setUnit(nextUnit)
      setQuantityRaw('')
    }
    const nextPrice = catalogPrice(price)
    setUnitPrice(nextPrice)
    valueEditedRef.current = false
    const qty = parseQuantity(qtyRaw, nextUnit)
    setValueRaw(nextPrice != null && qty != null && qty > 0 ? estimatedFromPrice(nextPrice, qty) : '')
    setListHidden(true)
    setHighlight(0)
  }

  function changeQuantity(next: string): void {
    setQuantityRaw(next)
    if (valueEditedRef.current || unitPrice == null) return
    const qty = parseQuantity(next, unit)
    setValueRaw(qty != null && qty > 0 ? estimatedFromPrice(unitPrice, qty) : '')
  }

  function handleProductKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!listOpen) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setHighlight(index => markedIndex(markedIndex(index, suggestions.length) + step, suggestions.length))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const pick = suggestions[current]
      if (pick) chooseProduct(pick.name, pick.unit, pick.price)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setListHidden(true)
    }
  }

  async function save(): Promise<void> {
    const occurredAt = transferOccurredAt(date)
    const quantity = parseQuantity(quantityRaw, unit)
    if (!occurredAt || quantity == null) {
      setError('Revisá la fecha y la cantidad.')
      return
    }
    const estimatedValue = valueRaw.trim() === '' ? null : parseNumericInput(valueRaw)
    if (valueRaw.trim() !== '' && estimatedValue == null) {
      setError('El valor estimado no es válido.')
      return
    }
    setSaving(true)
    setError(null)
    const result = await window.hw.createStoreTransfer({
      productName,
      quantity,
      unit,
      fromStoreId,
      toStoreId,
      occurredAt,
      notes: notes.trim() === '' ? null : notes.trim(),
      estimatedValue,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error ?? 'No se pudo guardar.')
      return
    }
    setProductName('')
    setQuantityRaw('')
    setNotes('')
    setValueRaw('')
    setUnitPrice(null)
    valueEditedRef.current = false
    onCreated()
  }

  return (
    <form
      className="space-y-3 rounded-xl border border-line bg-panel p-4"
      onSubmit={event => {
        event.preventDefault()
        void save()
      }}
    >
      <h2 className="text-sm font-semibold text-ink">Mercadería que pasa</h2>
      <label className="block space-y-1">
        <span className="text-xs text-muted">Producto</span>
        <input
          ref={productRef}
          value={productName}
          onChange={event => {
            setProductName(event.target.value)
            setHighlight(0)
            setListHidden(false)
            setUnitPrice(null)
            if (!valueEditedRef.current) setValueRaw('')
          }}
          onKeyDownCapture={handleProductKeyDown}
          placeholder="Buscar producto…"
          maxLength={80}
          required
          autoComplete="off"
          className={PRODUCT_FIELD}
        />
        <SuggestPopover anchorRef={productRef} open={listOpen}>
          <ul className="w-full">
            {suggestions.map((suggestion, index) => {
              const marked = index === current
              return (
                <li
                  key={suggestion.id}
                  ref={marked ? node => node?.scrollIntoView?.({ block: 'nearest' }) : undefined}
                  data-merch-marked={marked ? 'true' : undefined}
                  className={`w-full ${marked ? 'bg-accent-soft' : ''}`}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    className={`flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm ${
                      marked ? 'bg-accent-soft text-ink' : 'hover:bg-hover'
                    }`}
                    onMouseDown={event => {
                      event.preventDefault()
                      chooseProduct(suggestion.name, suggestion.unit, suggestion.price)
                    }}
                    onMouseEnter={() => setHighlight(index)}
                  >
                    <span className="min-w-0 flex-1 truncate" title={suggestion.title}>{suggestion.label}</span>
                    {suggestion.pluNumber != null && (
                      <span className="shrink-0 text-xs text-muted">PLU {suggestion.pluNumber}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </SuggestPopover>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs text-muted">Cantidad</span>
          {unit === 'kg' ? (
            <DecimalInput
              value={quantityRaw}
              onChange={changeQuantity}
              weightMode
              className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
            />
          ) : (
            <NumericInput
              value={quantityRaw}
              onChange={changeQuantity}
              className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
            />
          )}
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted">Unidad</span>
          <select
            aria-label="Unidad"
            value={unit}
            onChange={event => {
              setUnit(event.target.value as StoreTransferUnit)
              setQuantityRaw('')
              setUnitPrice(null)
              if (!valueEditedRef.current) setValueRaw('')
            }}
            className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
          >
            <option value="kg">kg</option>
            <option value="u">unidades</option>
            <option value="cajon">cajones</option>
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs text-muted">Sale de</span>
          <select
            aria-label="Sale de"
            value={fromStoreId}
            onChange={event => setFromStoreId(event.target.value)}
            className="h-9 w-full min-w-0 truncate rounded-lg border border-line bg-input px-2 text-sm text-ink"
          >
            <option value="">Elegir local</option>
            {stores.map(store => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted">Llega a</span>
          <select
            aria-label="Llega a"
            value={toStoreId}
            onChange={event => setToStoreId(event.target.value)}
            className="h-9 w-full min-w-0 truncate rounded-lg border border-line bg-input px-2 text-sm text-ink"
          >
            <option value="">Elegir local</option>
            {stores.map(store => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-muted">Fecha</span>
        <input
          type="date"
          aria-label="Fecha"
          value={date}
          onChange={event => setDate(event.target.value)}
          className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted">Nota</span>
        <input
          value={notes}
          onChange={event => setNotes(event.target.value)}
          maxLength={300}
          className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted">Valor estimado</span>
        <NumericInput
          aria-label="Valor estimado"
          value={valueRaw}
          onChange={next => {
            valueEditedRef.current = true
            setValueRaw(next)
          }}
          className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
        />
        <span className="text-xs text-muted">Opcional. No es una compra ni un gasto.</span>
      </label>
      {error && <p className="truncate text-sm text-danger" title={error}>{error}</p>}
      <Button type="submit" disabled={saving}>Guardar</Button>
    </form>
  )
}

function TransferRow({
  row,
  session,
  fromName,
  toName,
  onChanged,
}: {
  row: StoreTransferRow
  session: Pick<SessionInfo, 'userId' | 'role'>
  fromName: string
  toName: string
  onChanged: () => void
}) {
  const [receivedRaw, setReceivedRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const route = `${fromName} → ${toName}`
  const canCancel = row.status === 'pending' && (session.role === 'admin' || session.userId === row.createdBy)
  const label = storeTransferLabel(row)

  async function confirm(): Promise<void> {
    const receivedQuantity = parseQuantity(receivedRaw, row.unit)
    if (receivedQuantity == null) {
      setError('La cantidad recibida no es válida.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await window.hw.confirmStoreTransfer({ id: row.id, receivedQuantity })
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? 'No se pudo confirmar.')
      return
    }
    onChanged()
  }

  async function cancel(): Promise<void> {
    setBusy(true)
    setError(null)
    const result = await window.hw.cancelStoreTransfer({ id: row.id })
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? 'No se pudo cancelar.')
      return
    }
    onChanged()
  }

  return (
    <div className="space-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={row.productName}>{row.productName}</p>
        <span className="shrink-0 text-xs text-muted">{label}</span>
      </div>
      <p className="truncate text-sm text-muted" title={route}>{`${quantityText(row.quantity, row.unit)} · ${route}`}</p>
      {row.estimatedValue != null && (
        <p className="text-sm text-ink">{`Valor estimado ${formatARS(row.estimatedValue)}`}</p>
      )}
      {row.notes && <p className="truncate text-sm text-muted" title={row.notes}>{row.notes}</p>}
      {row.status === 'pending' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1">
            <span className="text-xs text-muted">Cantidad recibida</span>
            {row.unit === 'kg' ? (
              <DecimalInput
                aria-label={`Cantidad recibida de ${row.productName}`}
                value={receivedRaw}
                onChange={setReceivedRaw}
                weightMode
                className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
              />
            ) : (
              <NumericInput
                aria-label={`Cantidad recibida de ${row.productName}`}
                value={receivedRaw}
                onChange={setReceivedRaw}
                className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
              />
            )}
          </label>
          <Button type="button" size="sm" disabled={busy} onClick={() => { void confirm() }}>Confirmar</Button>
          {canCancel && (
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => { void cancel() }}>
              Cancelar
            </Button>
          )}
        </div>
      )}
      {error && <p className="truncate text-sm text-danger" title={error}>{error}</p>}
    </div>
  )
}
