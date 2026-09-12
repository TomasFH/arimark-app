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
  LabeledInput,
  LabeledTextarea,
  StoreSelector,
  filterDigits,
  parseDigits,
} from './shared'
import NumericInput from '../NumericInput'
import DecimalInput from '../DecimalInput'
import {
  fetchOrders,
  createOrder,
  updateOrder,
  updateOrderStatus,
  softDeleteOrder,
  formatMoney,
  formatDate,
  type Order,
  type OrderStatus,
  type StoreDoc,
} from '../../lib/adminFirestore'
import {
  DEPOSIT_METHOD_LABELS,
  TIME_SLOT_LABELS,
  defaultCreateStoreId,
  depositTotal,
  parseDepositPayments,
  formatPickupSlotLine,
  toMobileOrderRecord,
  toMobileOrderPatch,
  validateMobileOrderDraft,
  resolvedBudgetLines,
  estimatedBudgetTotal,
  kgLineMissingWeight,
  budgetDraftFromLines,
  parseTimeSlot,
  type BudgetCartDraft,
  type DepositMethod,
  type DepositPayment,
  type OrderTimeSlot,
} from '../../lib/orderMapping'
import { catalogTypeaheadMatches, loadCatalogForStorePicker } from '../../lib/catalog'
import type { CatalogProduct } from '../../types/pos'
import {
  pickupHoursLiveErrorOnDate,
  pickupSlotAvailability,
  PICKUP_SPECIFIC_HINT,
  storeHoursSourceFromRecord,
  formatOrderQty,
  formatOrderQtyHint,
} from '@carniceria/shared'
import { todayLocalYmd } from '../../lib/week'

interface Props {
  onBack: () => void
  stores: StoreDoc[]
  createdBy: string
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  ready: 'Listo',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}

const STATUS_BADGE: Record<OrderStatus, string> = {
  pending:
    'bg-amber-950/50 text-amber-400/70 border border-amber-900/40',
  ready: 'bg-zinc-700 text-zinc-300 border border-zinc-600',
  delivered:
    'bg-emerald-950/50 text-emerald-400/70 border border-emerald-900/40',
  cancelled: 'bg-zinc-800/50 text-zinc-500 border border-zinc-700/50',
}

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['delivered', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: ['pending'],
}

type Filter = 'active' | 'all'

export function OrdersScreen({ onBack, stores, createdBy }: Props) {
  const online = useOnlineStatus()
  const activeStores = stores.filter(s => !s.archivedAt)
  useBackLayer(true, onBack)

  const [storeId, setStoreId] = useState<string>('')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('active')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Order | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Order | null>(null)

  const load = useCallback(async (sid: string) => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchOrders(sid || undefined)
      setOrders(list)
    } catch {
      setError('No se pudieron cargar los pedidos.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(storeId)
  }, [storeId, load])

  const handleStoreChange = (id: string) => {
    setStoreId(id)
    setSelected(null)
  }

  const handleStatusChange = async (order: Order, status: OrderStatus) => {
    try {
      await updateOrderStatus(order.id, status)
      setOrders(prev =>
        prev.map(o =>
          o.id === order.id ? { ...o, status, updatedAt: new Date().toISOString() } : o,
        ),
      )
      setSelected(prev => (prev?.id === order.id ? { ...prev, status } : prev))
    } catch {
      setError('No se pudo actualizar el estado.')
    }
  }

  const handleDelete = async (order: Order) => {
    setPendingDelete(order)
  }

  const displayed = orders.filter(o => {
    if (filter === 'active' && (o.status === 'delivered' || o.status === 'cancelled'))
      return false
    if (search && !o.customerName.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <ScreenHeader
        title="Pedidos"
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
            aria-label="Nuevo pedido"
          >
            +
          </button>
        }
      />

      {!online && <OfflineBanner />}

      {/* Store selector */}
      <StoreSelector
        stores={activeStores}
        value={storeId}
        onChange={handleStoreChange}
        allowAll
      />

      {/* Filters */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
        {(['active', 'all'] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {f === 'active' ? 'Activos' : 'Todos'}
          </button>
        ))}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar cliente..."
          className="ml-auto min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
        />
      </div>

      <main className="flex-1 px-4 py-4">
        {error && <ErrorBanner message={error} onRetry={() => void load(storeId)} />}
        {loading && <Spinner />}
        {!loading && !error && displayed.length === 0 && (
          <EmptyState message={search ? 'Sin resultados.' : 'No hay pedidos.'} />
        )}
        {!loading && !error && displayed.length > 0 && (
          <ul className="space-y-2">
            {displayed.map(order => (
              <li key={order.id}>
                <button
                  type="button"
                  onClick={() => setSelected(order)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-left hover:border-zinc-500 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="min-w-0 flex-1 truncate font-medium text-zinc-100"
                      title={order.customerName}
                    >
                      {order.customerName}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[order.status]}`}
                    >
                      {STATUS_LABEL[order.status]}
                    </span>
                    {order.priority && (
                      <span className="shrink-0 rounded-full bg-red-950/50 border border-red-900/40 px-1.5 py-0.5 text-xs text-red-400/80">
                        Prioritario
                      </span>
                    )}
                  </div>
                  {order.items && (
                    <p
                      className="mt-1 truncate text-sm text-zinc-400"
                      title={order.items}
                    >
                      {order.items}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                    <span>Retiro: {formatDate(order.pickupDate)}</span>
                    {formatPickupSlotLine(
                      order.timeSlot,
                      order.pickupTime,
                      storeHoursSourceFromRecord(stores.find(s => s.id === order.storeId) ?? null),
                      order.pickupDate,
                    ) && (
                      <span>
                        {formatPickupSlotLine(
                          order.timeSlot,
                          order.pickupTime,
                          storeHoursSourceFromRecord(stores.find(s => s.id === order.storeId) ?? null),
                          order.pickupDate,
                        )}
                      </span>
                    )}
                    {order.depositAmount > 0 && (
                      <span className="font-mono">
                        Seña: {formatMoney(order.depositAmount)}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* Order actions modal */}
      {selected && (
        <OrderActionsModal
          order={selected}
          onClose={() => setSelected(null)}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          onEdit={order => {
            setSelected(null)
            setEditingOrder(order)
          }}
        />
      )}

      {/* Create order modal */}
      {(showCreate || editingOrder) && (
        <OrderFormModal
          stores={activeStores}
          defaultStoreId={editingOrder?.storeId ?? defaultCreateStoreId(storeId)}
          createdBy={createdBy}
          editingOrder={editingOrder}
          onClose={() => {
            setShowCreate(false)
            setEditingOrder(null)
          }}
          onCreate={async order => {
            await createOrder(order)
            setShowCreate(false)
            void load(storeId)
          }}
          onUpdate={async (id, patch) => {
            await updateOrder(id, patch)
            setEditingOrder(null)
            void load(storeId)
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          title="Eliminar pedido"
          message={`¿Eliminar el pedido de ${pendingDelete.customerName}?`}
          confirmLabel="Eliminar"
          danger
          onClose={() => setPendingDelete(null)}
          onConfirm={async () => {
            await softDeleteOrder(pendingDelete.id)
            setOrders(prev => prev.filter(o => o.id !== pendingDelete.id))
            setSelected(null)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Order actions modal
// ---------------------------------------------------------------------------

interface OrderActionsModalProps {
  order: Order
  onClose: () => void
  onStatusChange: (order: Order, status: OrderStatus) => Promise<void>
  onDelete: (order: Order) => Promise<void>
  onEdit: (order: Order) => void
}

function OrderActionsModal({
  order,
  onClose,
  onStatusChange,
  onDelete,
  onEdit,
}: OrderActionsModalProps) {
  const [busy, setBusy] = useState(false)

  const handle = async (fn: () => Promise<void>) => {
    setBusy(true)
    await fn().catch(() => {})
    setBusy(false)
  }

  const productLines = order.budgetItems && order.budgetItems.length > 0 ? order.budgetItems : null
  const estimate = estimatedBudgetTotal(order.budgetItems ?? [])

  return (
    <Modal title={order.customerName} onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
          <p className="text-zinc-400">
            Estado:{' '}
            <span className={`rounded px-1.5 ${STATUS_BADGE[order.status]}`}>
              {STATUS_LABEL[order.status]}
            </span>
          </p>
          {productLines ? (
            <ul className="mt-2 space-y-1">
              {productLines.map((line, idx) => (
                <li key={`${line.productId}-${idx}`} className="flex items-center gap-2 min-w-0">
                  <span className="min-w-0 flex-1 truncate text-zinc-300" title={line.name}>
                    {line.name}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {formatOrderQty(line)}
                    {formatOrderQtyHint(line) ? ` ${formatOrderQtyHint(line)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : order.items ? (
            <p className="mt-1 text-zinc-300" title={order.items}>
              {order.items}
            </p>
          ) : null}
          {estimate > 0 && (
            <p className="mt-1 font-mono text-zinc-300">Estimado: {formatMoney(estimate)}</p>
          )}
          <p className="mt-1 text-zinc-500">Retiro: {formatDate(order.pickupDate)}</p>
          {timeSlotLabel(order.timeSlot, order.pickupTime) && (
            <p className="text-zinc-500">{timeSlotLabel(order.timeSlot, order.pickupTime)}</p>
          )}
          {order.phone && <p className="text-zinc-500">Tel: {order.phone}</p>}
          {order.depositAmount > 0 && (
            <div className="font-mono text-zinc-400">
              <p>Seña: {formatMoney(order.depositAmount)}</p>
              {(parseDepositPayments(order.depositPayments) ?? []).map(p => (
                <p key={p.method} className="text-xs text-zinc-500">
                  {DEPOSIT_METHOD_LABELS[p.method]}: {formatMoney(p.amount)}
                </p>
              ))}
            </div>
          )}
          {order.notes && <p className="mt-1 text-zinc-400 italic">{order.notes}</p>}
        </div>

        {order.status === 'pending' && (
          <Btn
            className="w-full"
            variant="ghost"
            disabled={busy}
            onClick={() => onEdit(order)}
          >
            Editar pedido
          </Btn>
        )}

        {TRANSITIONS[order.status].length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">Cambiar estado</p>
            {TRANSITIONS[order.status].map(s => (
              <Btn
                key={s}
                className="w-full"
                variant={s === 'cancelled' ? 'danger' : 'primary'}
                disabled={busy}
                onClick={() => handle(() => onStatusChange(order, s))}
              >
                Marcar como: {STATUS_LABEL[s]}
              </Btn>
            ))}
          </div>
        )}

        {order.status === 'cancelled' && (
          <Btn
            className="w-full"
            variant="danger"
            disabled={busy}
            onClick={() => handle(() => onDelete(order))}
          >
            Eliminar pedido
          </Btn>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Formulario de alta / edición
// ---------------------------------------------------------------------------

function timeSlotLabel(slot: string | null, pickupTime: string | null): string | null {
  return formatPickupSlotLine(slot, pickupTime)
}

function emptyDepositFields(): Record<DepositMethod, string> {
  return { cash: '', debit: '', wallet: '', credit: '' }
}

function depositFieldsFromOrder(order: Order | null): Record<DepositMethod, string> {
  const next = emptyDepositFields()
  if (!order) return next
  for (const p of parseDepositPayments(order.depositPayments) ?? []) {
    next[p.method] = String(p.amount)
  }
  return next
}

interface OrderFormModalProps {
  stores: StoreDoc[]
  defaultStoreId: string
  createdBy: string
  editingOrder: Order | null
  onClose: () => void
  onCreate: (order: Omit<Order, 'id'>) => Promise<void>
  onUpdate: (id: string, patch: ReturnType<typeof toMobileOrderPatch>) => Promise<void>
}

function OrderFormModal({
  stores,
  defaultStoreId,
  createdBy,
  editingOrder,
  onClose,
  onCreate,
  onUpdate,
}: OrderFormModalProps) {
  const allowLegacyText = Boolean(
    editingOrder && !(editingOrder.budgetItems && editingOrder.budgetItems.length > 0),
  )
  const [storeId, setStoreId] = useState(defaultStoreId)
  const [customerName, setCustomerName] = useState(editingOrder?.customerName ?? '')
  const [phone, setPhone] = useState(editingOrder?.phone ?? '')
  const [items, setItems] = useState(editingOrder?.items ?? '')
  const [budgetCart, setBudgetCart] = useState<BudgetCartDraft[]>(
    () => budgetDraftFromLines(editingOrder?.budgetItems ?? []),
  )
  const [pickupDate, setPickupDate] = useState(editingOrder?.pickupDate ?? todayLocalYmd())
  const [timeSlot, setTimeSlot] = useState<OrderTimeSlot | ''>(
    parseTimeSlot(editingOrder?.timeSlot) ?? '',
  )
  const [pickupTime, setPickupTime] = useState(editingOrder?.pickupTime ?? '')
  const [priority, setPriority] = useState(editingOrder?.priority ?? false)
  const [depositByMethod, setDepositByMethod] = useState<Record<DepositMethod, string>>(
    () => depositFieldsFromOrder(editingOrder),
  )
  const [notes, setNotes] = useState(editingOrder?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)

  useEffect(() => {
    if (stores.length === 1 && stores[0] && !storeId) {
      setStoreId(stores[0].id)
    }
  }, [stores, storeId])

  useEffect(() => {
    const source = storeHoursSourceFromRecord(stores.find(s => s.id === storeId) ?? null)
    const available = pickupSlotAvailability(source, pickupDate)
    if (
      (timeSlot === 'afternoon' && !available.afternoon)
      || (timeSlot === 'morning' && !available.morning)
    ) {
      setTimeSlot('')
    }
  }, [stores, storeId, pickupDate, timeSlot])

  useEffect(() => {
    if (!storeId) {
      setCatalog([])
      setCatalogLoading(false)
      return
    }
    let cancelled = false
    setCatalogLoading(true)
    void loadCatalogForStorePicker(storeId)
      .then(products => {
        if (cancelled) return
        setCatalog(products)
        setCatalogLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setCatalog([])
        setCatalogLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [storeId])

  const payments: DepositPayment[] = (['cash', 'debit', 'wallet', 'credit'] as const)
    .map(method => ({ method, amount: parseDigits(depositByMethod[method]) }))
    .filter(p => p.amount > 0)
  const totalDeposit = depositTotal(payments)

  const hours = storeHoursSourceFromRecord(stores.find(s => s.id === storeId) ?? null)
  const livePickupHoursError = pickupHoursLiveErrorOnDate(timeSlot, pickupTime, hours, pickupDate)
  const slotAvailability = pickupSlotAvailability(hours, pickupDate)
  const pickupSlotOptions = (['morning', 'afternoon', 'specific'] as const).filter(slot => {
    if (slot === 'morning') return slotAvailability.morning
    if (slot === 'afternoon') return slotAvailability.afternoon
    return true
  })

  function buildDraft() {
    return {
      storeId,
      customerName,
      phone,
      items,
      pickupDate,
      timeSlot,
      pickupTime,
      priority,
      payments,
      notes,
      createdBy,
      budgetCart,
    }
  }

  async function persistDraft() {
    const draft = buildDraft()
    setSaving(true)
    setErr(null)
    try {
      const now = new Date().toISOString()
      if (editingOrder) {
        await onUpdate(editingOrder.id, toMobileOrderPatch(draft, now))
      } else {
        await onCreate(toMobileOrderRecord(draft, now))
      }
    } catch {
      setErr(editingOrder ? 'No se pudo guardar el pedido.' : 'No se pudo crear el pedido.')
      setSaving(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validationError = validateMobileOrderDraft(buildDraft(), hours, { allowLegacyText })
    if (validationError) {
      setErr(validationError)
      return
    }
    await persistDraft()
  }

  const canChangeStore = !editingOrder && stores.length > 1

  return (
    <Modal title={editingOrder ? 'Editar pedido' : 'Nuevo pedido'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {canChangeStore && (
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-400">Local *</span>
            <select
              value={storeId}
              onChange={e => {
                const next = e.target.value
                setStoreId(next)
                setBudgetCart([])
                const source = storeHoursSourceFromRecord(stores.find(s => s.id === next) ?? null)
                const available = pickupSlotAvailability(source, pickupDate)
                setTimeSlot(current => {
                  if (current === 'afternoon' && !available.afternoon) return ''
                  if (current === 'morning' && !available.morning) return ''
                  return current
                })
              }}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none"
            >
              <option value="">Elegir un local</option>
              {stores.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!canChangeStore && (
          <p className="text-sm text-zinc-400">
            Local:{' '}
            <span className="text-zinc-200">
              {stores.find(s => s.id === storeId)?.name ?? '—'}
            </span>
          </p>
        )}

        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={priority}
            onChange={e => setPriority(e.target.checked)}
            className="h-4 w-4 accent-emerald-500"
          />
          <span className="text-sm font-medium text-zinc-400">⚡ Pedido prioritario / importante</span>
        </label>

        <LabeledInput
          label="Nombre del cliente *"
          value={customerName}
          onChange={setCustomerName}
          placeholder="Nombre del cliente"
          maxLength={100}
          required
        />
        <LabeledInput
          label="Teléfono"
          value={phone}
          onChange={setPhone}
          placeholder="11-1234-5678"
          inputMode="tel"
          maxLength={30}
        />

        <BudgetCartEditor
          catalog={catalog}
          catalogLoading={catalogLoading}
          cart={budgetCart}
          onChange={setBudgetCart}
          legacyItems={allowLegacyText ? items : ''}
          onLegacyItemsChange={allowLegacyText ? setItems : undefined}
        />

        <label className="block">
          <span className="mb-1 block text-sm text-zinc-400">Fecha de retiro *</span>
          <input
            type="date"
            value={pickupDate}
            onChange={e => {
              const next = e.target.value
              setPickupDate(next)
              const available = pickupSlotAvailability(hours, next)
              setTimeSlot(current => {
                if (current === 'afternoon' && !available.afternoon) return ''
                if (current === 'morning' && !available.morning) return ''
                return current
              })
            }}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none"
          />
        </label>

        <div className="space-y-2">
          <p className="text-sm text-zinc-400">Horario de retiro (opcional)</p>
          <div className={`grid gap-2 ${pickupSlotOptions.length === 3 ? 'grid-cols-3' : pickupSlotOptions.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {pickupSlotOptions.map(slot => (
              <button
                key={slot}
                type="button"
                onClick={() => setTimeSlot(s => (s === slot ? '' : slot))}
                className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                  timeSlot === slot
                    ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-300'
                }`}
              >
                {TIME_SLOT_LABELS[slot]}
              </button>
            ))}
          </div>
          {timeSlot === 'specific' && (
            <>
              <p className="text-xs text-amber-400/90 leading-snug">{PICKUP_SPECIFIC_HINT}</p>
              <input
                type="time"
                value={pickupTime}
                onChange={e => {
                  setErr(null)
                  setPickupTime(e.target.value)
                }}
                className={`w-full rounded-lg border bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none ${
                  livePickupHoursError ? 'border-red-500' : 'border-zinc-700'
                }`}
              />
              {livePickupHoursError && (
                <p className="text-sm text-red-400/90">{livePickupHoursError}</p>
              )}
            </>
          )}
        </div>

        <div className="space-y-2 rounded-xl border border-zinc-700/60 bg-zinc-800/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-zinc-300">Seña (opcional)</p>
            {totalDeposit > 0 && (
              <span className="shrink-0 font-mono text-sm text-zinc-100">{formatMoney(totalDeposit)}</span>
            )}
          </div>
          {(['cash', 'debit', 'wallet', 'credit'] as const).map(method => (
            <div key={method} className="flex items-center gap-2 min-w-0">
              <span className="w-28 shrink-0 truncate text-xs text-zinc-400" title={DEPOSIT_METHOD_LABELS[method]}>
                {DEPOSIT_METHOD_LABELS[method]}
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={depositByMethod[method]}
                onChange={e =>
                  setDepositByMethod(prev => ({ ...prev, [method]: filterDigits(e.target.value) }))
                }
                placeholder="0"
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
              />
            </div>
          ))}
        </div>

        <LabeledTextarea
          label="Notas"
          value={notes}
          onChange={setNotes}
          placeholder="Observaciones del pedido…"
          rows={2}
          maxLength={300}
        />

        {err && (
          <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400/80">
            {err}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Btn className="flex-1" variant="ghost" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn type="submit" className="flex-1" loading={saving} disabled={!!livePickupHoursError}>
            {editingOrder ? 'Guardar cambios' : 'Crear pedido'}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}

interface BudgetCartEditorProps {
  catalog: CatalogProduct[]
  catalogLoading: boolean
  cart: BudgetCartDraft[]
  onChange: (cart: BudgetCartDraft[]) => void
  legacyItems: string
  onLegacyItemsChange?: (value: string) => void
}

function BudgetCartEditor({
  catalog,
  catalogLoading,
  cart,
  onChange,
  legacyItems,
  onLegacyItemsChange,
}: BudgetCartEditorProps) {
  const [query, setQuery] = useState('')
  const suggestions = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    return catalogTypeaheadMatches(catalog, q).slice(0, 8)
  }, [catalog, query])

  const liveLines = resolvedBudgetLines(cart)
  const estimate = estimatedBudgetTotal(liveLines)
  const showLegacyText = Boolean(onLegacyItemsChange) && cart.length === 0

  return (
    <div className="space-y-3 rounded-xl border border-zinc-700/60 bg-zinc-800/50 p-3">
      <p className="text-sm font-medium text-zinc-300">Productos *</p>
      {showLegacyText && (
        <LabeledTextarea
          label="Descripción del pedido *"
          value={legacyItems}
          onChange={onLegacyItemsChange!}
          placeholder="Ej: 2 kg de asado, 1 pollo entero…"
          maxLength={500}
        />
      )}
      {!showLegacyText && onLegacyItemsChange && legacyItems && (
        <p className="text-[11px] text-zinc-500 break-words" title={legacyItems}>
          Texto anterior: {legacyItems}
        </p>
      )}

      {cart.length > 0 && (
        <div className="space-y-1.5">
          {cart.map((line, idx) => {
            const missingWeight = kgLineMissingWeight(line)
            return (
              <div key={`${line.productId}-${idx}`} className="space-y-1">
                <div className="flex items-center gap-2 min-w-0 rounded-lg bg-zinc-700/40 px-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-zinc-200" title={line.name}>{line.name}</p>
                    <p className="text-[10px] text-zinc-500">
                      {formatMoney(line.unitPrice)} / {line.unit === 'kg' ? 'kg' : 'u'}
                    </p>
                  </div>
                  <div className="w-20 shrink-0">
                    {line.unit === 'kg' ? (
                      <DecimalInput
                        value={line.qtyRaw}
                        onChange={v => onChange(cart.map((l, i) => (i === idx ? { ...l, qtyRaw: v } : l)))}
                        placeholder="kg"
                        maxDecimals={3}
                        weightMode
                        title="Peso estimado"
                        className={`w-full rounded bg-zinc-800 px-2 py-1 text-right text-xs text-white ${
                          missingWeight ? 'border border-orange-600/80' : 'border border-zinc-600'
                        }`}
                      />
                    ) : (
                      <NumericInput
                        value={line.qtyRaw}
                        onChange={v => onChange(cart.map((l, i) => (i === idx ? { ...l, qtyRaw: v } : l)))}
                        placeholder="0"
                        className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-right text-xs text-white"
                      />
                    )}
                  </div>
                  <span className="w-6 shrink-0 text-[10px] text-zinc-500">{line.unit === 'kg' ? 'kg' : 'u'}</span>
                  {line.unit === 'kg' && (
                    <>
                      <div className="w-12 shrink-0">
                        <NumericInput
                          value={line.requestedUnitsRaw}
                          onChange={v => onChange(cart.map((l, i) => (i === idx ? { ...l, requestedUnitsRaw: v } : l)))}
                          placeholder=""
                          title="Unidades pedidas (opcional). Vacío = pidió kilos."
                          className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-right text-xs text-white"
                        />
                      </div>
                      <span className="shrink-0 text-[10px] text-zinc-500" title="Unidades pedidas">u</span>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => onChange(cart.filter((_, i) => i !== idx))}
                    className="shrink-0 text-sm text-zinc-500 hover:text-red-400"
                    title="Quitar"
                  >
                    ×
                  </button>
                </div>
                {missingWeight && (
                  <p className="px-1 text-[11px] text-orange-500/85">
                    Sin kilos no hay precio estimado. Preguntá cuánto pueden pesar y cargalo en kg.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={catalogLoading ? 'Cargando catálogo…' : 'Buscar producto…'}
          disabled={catalog.length === 0}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
        />
        {suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-zinc-600 bg-zinc-800 shadow-xl">
            {suggestions.map(p => (
              <button
                key={p.productId}
                type="button"
                onClick={() => {
                  onChange([
                    ...cart,
                    {
                      productId: p.productId,
                      name: p.name,
                      unit: p.unit,
                      pluNumber: p.pluNumber,
                      estimatedQty: 1,
                      unitPrice: p.price,
                      qtyRaw: '',
                      requestedUnitsRaw: '',
                    },
                  ])
                  setQuery('')
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-700/80"
              >
                <span className="min-w-0 flex-1 truncate" title={p.name}>{p.name}</span>
                <span className="shrink-0 text-zinc-500">
                  {formatMoney(p.price)}/{p.unit === 'kg' ? 'kg' : 'u'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {!catalogLoading && catalog.length === 0 && (
        <p className="text-xs text-zinc-500">Sin productos en el catálogo de este local.</p>
      )}
      {estimate > 0 && (
        <div className="flex items-center justify-between gap-2 border-t border-zinc-700/50 pt-1">
          <span className="text-xs text-zinc-400">Total estimado</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-100">{formatMoney(estimate)}</span>
        </div>
      )}
    </div>
  )
}
