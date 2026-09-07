import { useState, useEffect, useCallback } from 'react'
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
import {
  fetchOrders,
  createOrder,
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
  validateMobileOrderDraft,
  type DepositMethod,
  type DepositPayment,
  type OrderTimeSlot,
} from '../../lib/orderMapping'
import {
  pickupHoursLiveErrorOnDate,
  pickupSlotAvailability,
  PICKUP_SPECIFIC_HINT,
  storeHoursSourceFromRecord,
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
        />
      )}

      {/* Create order modal */}
      {showCreate && (
        <CreateOrderModal
          stores={activeStores}
          defaultStoreId={defaultCreateStoreId(storeId)}
          createdBy={createdBy}
          onClose={() => setShowCreate(false)}
          onCreate={async order => {
            await createOrder(order)
            setShowCreate(false)
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
}

function OrderActionsModal({
  order,
  onClose,
  onStatusChange,
  onDelete,
}: OrderActionsModalProps) {
  const [busy, setBusy] = useState(false)

  const handle = async (fn: () => Promise<void>) => {
    setBusy(true)
    await fn().catch(() => {})
    setBusy(false)
  }

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
          {order.items && (
            <p className="mt-1 text-zinc-300" title={order.items}>
              {order.items}
            </p>
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
// Create order modal
// ---------------------------------------------------------------------------

function timeSlotLabel(slot: string | null, pickupTime: string | null): string | null {
  return formatPickupSlotLine(slot, pickupTime)
}

interface CreateOrderModalProps {
  stores: StoreDoc[]
  defaultStoreId: string
  createdBy: string
  onClose: () => void
  onCreate: (order: Omit<Order, 'id'>) => Promise<void>
}

function CreateOrderModal({
  stores,
  defaultStoreId,
  createdBy,
  onClose,
  onCreate,
}: CreateOrderModalProps) {
  const [storeId, setStoreId] = useState(defaultStoreId)
  const [customerName, setCustomerName] = useState('')
  const [phone, setPhone] = useState('')
  const [items, setItems] = useState('')
  const [pickupDate, setPickupDate] = useState(todayLocalYmd())
  const [timeSlot, setTimeSlot] = useState<OrderTimeSlot | ''>('')
  const [pickupTime, setPickupTime] = useState('')
  const [priority, setPriority] = useState(false)
  const [depositByMethod, setDepositByMethod] = useState<Record<DepositMethod, string>>({
    cash: '',
    debit: '',
    wallet: '',
    credit: '',
  })
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

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

  async function persistDraft() {
    const draft = {
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
    }
    setSaving(true)
    setErr(null)
    try {
      await onCreate(toMobileOrderRecord(draft, new Date().toISOString()))
    } catch {
      setErr('No se pudo crear el pedido.')
      setSaving(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const draft = {
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
    }
    const validationError = validateMobileOrderDraft(draft, hours)
    if (validationError) {
      setErr(validationError)
      return
    }
    await persistDraft()
  }

  return (
    <>
    <Modal title="Nuevo pedido" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {stores.length > 1 && (
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-400">Local *</span>
            <select
              value={storeId}
              onChange={e => {
                const next = e.target.value
                setStoreId(next)
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
        {stores.length === 1 && stores[0] && (
          <p className="text-sm text-zinc-400">
            Local: <span className="text-zinc-200">{stores[0].name}</span>
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
        <LabeledTextarea
          label="Descripción del pedido *"
          value={items}
          onChange={setItems}
          placeholder="Ej: 2 kg de asado, 1 pollo entero…"
          maxLength={500}
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
            Crear pedido
          </Btn>
        </div>
      </form>
    </Modal>
    </>
  )
}
