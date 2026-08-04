import { useState, useEffect, useCallback } from 'react'
import { useOnlineStatus } from '../../lib/connectivity'
import {
  ScreenHeader,
  OfflineBanner,
  ErrorBanner,
  Spinner,
  EmptyState,
  Modal,
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
  type OrderPriority,
  type StoreDoc,
} from '../../lib/adminFirestore'

interface Props {
  onBack: () => void
  stores: StoreDoc[]
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
  pending: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: ['pending'],
}

type Filter = 'active' | 'all'

export function OrdersScreen({ onBack, stores }: Props) {
  const online = useOnlineStatus()
  const activeStores = stores.filter(s => !s.archivedAt)

  const [storeId, setStoreId] = useState<string>(() => activeStores[0]?.id ?? '')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('active')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Order | null>(null)
  const [showCreate, setShowCreate] = useState(false)

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
    if (!confirm(`¿Eliminar el pedido de ${order.customerName}?`)) return
    try {
      await softDeleteOrder(order.id)
      setOrders(prev => prev.filter(o => o.id !== order.id))
      setSelected(null)
    } catch {
      setError('No se pudo eliminar el pedido.')
    }
  }

  const displayed = orders.filter(o => {
    if (filter === 'active' && (o.status === 'delivered' || o.status === 'cancelled'))
      return false
    if (search && !o.customerName.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
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
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-left hover:border-zinc-700 transition-colors"
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
                    {order.priority === 'high' && (
                      <span className="shrink-0 rounded-full bg-red-950/50 border border-red-900/40 px-1.5 py-0.5 text-xs text-red-400/80">
                        Urgente
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
          defaultStoreId={storeId}
          onClose={() => setShowCreate(false)}
          onCreate={async order => {
            await createOrder(order)
            setShowCreate(false)
            void load(storeId)
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
          {order.timeSlot && (
            <p className="text-zinc-500">Turno: {order.timeSlot}</p>
          )}
          {order.phone && <p className="text-zinc-500">Tel: {order.phone}</p>}
          {order.depositAmount > 0 && (
            <p className="font-mono text-zinc-400">
              Seña: {formatMoney(order.depositAmount)}
            </p>
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

        <Btn
          className="w-full"
          variant="danger"
          disabled={busy}
          onClick={() => handle(() => onDelete(order))}
        >
          Eliminar pedido
        </Btn>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Create order modal
// ---------------------------------------------------------------------------

interface CreateOrderModalProps {
  stores: StoreDoc[]
  defaultStoreId: string
  onClose: () => void
  onCreate: (order: Omit<Order, 'id'>) => Promise<void>
}

function CreateOrderModal({
  stores,
  defaultStoreId,
  onClose,
  onCreate,
}: CreateOrderModalProps) {
  const [storeId, setStoreId] = useState(defaultStoreId)
  const [customerName, setCustomerName] = useState('')
  const [phone, setPhone] = useState('')
  const [items, setItems] = useState('')
  const [pickupDate, setPickupDate] = useState(
    new Date().toISOString().split('T')[0] ?? '',
  )
  const [timeSlot, setTimeSlot] = useState('')
  const [priority, setPriority] = useState<OrderPriority>('normal')
  const [depositInput, setDepositInput] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerName.trim()) {
      setErr('El nombre del cliente es obligatorio.')
      return
    }
    if (!storeId) {
      setErr('Seleccioná un local.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const now = new Date().toISOString()
      await onCreate({
        storeId,
        customerName: customerName.trim(),
        phone: phone.trim() || null,
        items: items.trim(),
        pickupDate,
        timeSlot: timeSlot || null,
        pickupTime: null,
        priority,
        status: 'pending',
        depositAmount: parseDigits(depositInput),
        depositPayments: 0,
        notes: notes.trim() || null,
        deleted: false,
        createdAt: now,
        updatedAt: now,
      })
    } catch {
      setErr('No se pudo crear el pedido.')
      setSaving(false)
    }
  }

  return (
    <Modal title="Nuevo pedido" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {stores.length > 1 && (
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-400">Local</span>
            <select
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none"
            >
              {stores.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <LabeledInput
          label="Cliente *"
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
          label="Detalle del pedido"
          value={items}
          onChange={setItems}
          placeholder="Ej: 2 kg vacío, 1 kg costilla..."
          maxLength={500}
        />
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-400">Fecha de retiro</span>
          <input
            type="date"
            value={pickupDate}
            onChange={e => setPickupDate(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-400">Turno</span>
          <select
            value={timeSlot}
            onChange={e => setTimeSlot(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none"
          >
            <option value="">Sin especificar</option>
            <option value="mañana">Mañana</option>
            <option value="tarde">Tarde</option>
            <option value="todo el día">Todo el día</option>
          </select>
        </label>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-zinc-400">Urgente</span>
          <button
            type="button"
            onClick={() => setPriority(p => (p === 'high' ? 'normal' : 'high'))}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              priority === 'high' ? 'bg-red-600' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                priority === 'high' ? 'left-5' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        <LabeledInput
          label="Seña ($)"
          value={depositInput}
          onChange={v => setDepositInput(filterDigits(v))}
          placeholder="0"
          inputMode="numeric"
        />
        <LabeledTextarea
          label="Notas"
          value={notes}
          onChange={setNotes}
          placeholder="Observaciones..."
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
          <Btn type="submit" className="flex-1" loading={saving}>
            Crear pedido
          </Btn>
        </div>
      </form>
    </Modal>
  )
}
