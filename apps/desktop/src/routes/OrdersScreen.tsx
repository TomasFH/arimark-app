/**
 * Pantalla de pedidos — cajera y admin.
 *
 * Cajera: ver lista, crear pedido, marcar listo/entregado.
 * Admin: además editar, cancelar y eliminar pedidos.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import NumericInput from '../components/NumericInput'
import { parseNumericInput, formatNumericInputValue } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import { formatPhoneInput } from '../lib/phoneInput'
import type { OrderRow, OrderStatus, DepositMethod, CreateOrderPayload, UpdateOrderPayload } from '../types/hw-api'

const DEPOSIT_METHOD_LABELS: Record<DepositMethod, string> = {
  cash: 'Efectivo',
  debit: 'Débito',
  wallet: 'Billetera',
  credit: 'Crédito',
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  ready: 'Listo',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'bg-amber-900/40 text-amber-300 border-amber-800/60',
  ready: 'bg-blue-900/40 text-blue-300 border-blue-800/60',
  delivered: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/60',
  cancelled: 'bg-gray-800/60 text-gray-400 border-gray-700/60',
}

type FilterStatus = 'active' | 'all'

interface FormState {
  customerName: string
  phone: string
  items: string
  pickupDate: string
  notes: string
  depositAmountRaw: string
  depositMethod: DepositMethod | ''
}

const EMPTY_FORM: FormState = {
  customerName: '',
  phone: '',
  items: '',
  pickupDate: '',
  notes: '',
  depositAmountRaw: '',
  depositMethod: '',
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function isUrgent(pickupDate: string): boolean {
  const today = todayDateStr()
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)
  return pickupDate === today || pickupDate === tomorrowStr
}

function isOverdue(pickupDate: string, status: OrderStatus): boolean {
  return status === 'pending' && pickupDate < todayDateStr()
}

interface Props {
  isAdmin: boolean
  onBack: () => void
}

export default function OrdersScreen({ isAdmin, onBack }: Props) {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('active')
  const [search, setSearch] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [editingOrder, setEditingOrder] = useState<OrderRow | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [confirmDelete, setConfirmDelete] = useState<OrderRow | null>(null)

  const loadOrders = useCallback(async () => {
    const r = await window.hw.listOrders()
    if (r.ok) setOrders(r.data)
    else setError(r.error)
    setLoading(false)
  }, [])

  useEffect(() => {
    setLoading(true)
    void loadOrders()
  }, [loadOrders])

  const filteredOrders = useMemo(() => {
    let list = orders
    if (filterStatus === 'active') {
      list = list.filter(o => o.status === 'pending' || o.status === 'ready')
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(o =>
        o.customerName.toLowerCase().includes(q) ||
        (o.phone ?? '').includes(q) ||
        o.items.toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => {
      // Pendientes primero, luego listos, luego entregados, luego cancelados
      const statusOrder: Record<OrderStatus, number> = { pending: 0, ready: 1, delivered: 2, cancelled: 3 }
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status]
      }
      return a.pickupDate.localeCompare(b.pickupDate)
    })
  }, [orders, filterStatus, search])

  const urgentCount = useMemo(
    () => orders.filter(o => (o.status === 'pending' || o.status === 'ready') && isUrgent(o.pickupDate)).length,
    [orders]
  )

  function openCreate() {
    setForm({ ...EMPTY_FORM, pickupDate: todayDateStr() })
    setFormError(null)
    setShowCreate(true)
    setEditingOrder(null)
  }

  function openEdit(order: OrderRow) {
    if (!isAdmin) return
    setForm({
      customerName: order.customerName,
      phone: formatPhoneInput(order.phone ?? ''),
      items: order.items,
      pickupDate: order.pickupDate,
      notes: order.notes ?? '',
      depositAmountRaw: order.depositAmount > 0 ? formatNumericInputValue(String(order.depositAmount)) : '',
      depositMethod: order.depositMethod ?? '',
    })
    setFormError(null)
    setEditingOrder(order)
    setShowCreate(false)
  }

  function closeForm() {
    setShowCreate(false)
    setEditingOrder(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  async function handleSave() {
    setFormError(null)
    const customerName = form.customerName.trim()
    const items = form.items.trim()
    const pickupDate = form.pickupDate.trim()
    const depositAmount = parseNumericInput(form.depositAmountRaw) ?? 0
    const depositMethod = form.depositMethod || undefined

    if (!customerName) { setFormError('El nombre del cliente es obligatorio.'); return }
    if (!items) { setFormError('Los ítems del pedido son obligatorios.'); return }
    if (!pickupDate) { setFormError('La fecha de retiro es obligatoria.'); return }
    if (depositAmount > 0 && !depositMethod) { setFormError('Seleccioná el medio de pago de la seña.'); return }

    setSaving(true)
    try {
      if (editingOrder) {
        const payload: UpdateOrderPayload = {
          id: editingOrder.id,
          customerName,
          phone: form.phone.replace(/\s/g, '') || undefined,
          items,
          pickupDate,
          notes: form.notes.trim() || undefined,
          depositAmount,
          depositMethod: depositMethod as DepositMethod | undefined ?? null,
        }
        const r = await window.hw.updateOrder(payload)
        if (!r.ok) { setFormError(r.error); setSaving(false); return }
        setOrders(prev => prev.map(o => o.id === editingOrder.id ? r.data : o))
      } else {
        const payload: CreateOrderPayload = {
          customerName,
          phone: form.phone.replace(/\s/g, '') || undefined,
          items,
          pickupDate,
          notes: form.notes.trim() || undefined,
          depositAmount: depositAmount > 0 ? depositAmount : undefined,
          depositMethod: depositAmount > 0 ? depositMethod as DepositMethod : undefined,
        }
        const r = await window.hw.createOrder(payload)
        if (!r.ok) { setFormError(r.error); setSaving(false); return }
        setOrders(prev => [r.data, ...prev])
      }
      closeForm()
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(order: OrderRow, status: OrderStatus) {
    const r = await window.hw.updateOrderStatus({ id: order.id, status })
    if (r.ok) {
      setOrders(prev => prev.map(o => o.id === order.id ? r.data : o))
    }
  }

  async function handleDelete(order: OrderRow) {
    const r = await window.hw.deleteOrder({ id: order.id })
    if (r.ok) {
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'cancelled' } : o))
    }
    setConfirmDelete(null)
  }

  const formIsValid = form.customerName.trim() && form.items.trim() && form.pickupDate

  return (
    <div className="flex flex-col flex-1 h-full bg-gray-950 text-white overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg hover:bg-gray-800 transition-colors text-gray-400 hover:text-white shrink-0"
            title="Volver"
          >
            ←
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-white">Pedidos</h1>
            {urgentCount > 0 && (
              <p className="text-xs text-amber-400">
                {urgentCount} para hoy o mañana
              </p>
            )}
          </div>
        </div>
        <button
          onClick={openCreate}
          className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-sm font-semibold transition-colors shrink-0"
        >
          + Nuevo pedido
        </button>
      </header>

      {/* Filters */}
      <div className="px-4 py-2 border-b border-gray-800/60 shrink-0 space-y-2">
        <div className="flex gap-2">
          {(['active', 'all'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filterStatus === s ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {s === 'active' ? 'Activos' : 'Todos'}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, teléfono o descripción…"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading && <p className="text-gray-500 text-sm text-center py-8 animate-pulse">Cargando pedidos…</p>}
        {error && <p className="text-red-400 text-sm text-center py-8">{error}</p>}
        {!loading && !error && filteredOrders.length === 0 && (
          <p className="text-gray-500 text-sm text-center py-8">No hay pedidos.</p>
        )}
        {filteredOrders.map(order => (
          <OrderCard
            key={order.id}
            order={order}
            isAdmin={isAdmin}
            onStatusChange={handleStatusChange}
            onEdit={() => openEdit(order)}
            onDelete={() => setConfirmDelete(order)}
          />
        ))}
      </div>

      {/* Create / Edit form modal */}
      {(showCreate || editingOrder) && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-lg bg-gray-900 rounded-t-2xl sm:rounded-2xl border border-gray-800 max-h-[92vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {editingOrder ? 'Editar pedido' : 'Nuevo pedido'}
              </h2>
              <button onClick={closeForm} className="text-gray-400 hover:text-white text-xl">×</button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <Field label="Nombre del cliente *">
                <input
                  type="text"
                  value={form.customerName}
                  onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                  placeholder="Ej: Restaurante El Sol"
                  maxLength={100}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </Field>

              <Field label="Teléfono (opcional)">
                <input
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: formatPhoneInput(e.target.value) }))}
                  placeholder="+54 9 11 1234-5678"
                  maxLength={30}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </Field>

              <Field label="Descripción del pedido *">
                <textarea
                  value={form.items}
                  onChange={e => setForm(f => ({ ...f, items: e.target.value }))}
                  placeholder="Ej: 2 kg de asado, 1 pollo entero…"
                  rows={3}
                  maxLength={500}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
                />
              </Field>

              <Field label="Fecha de retiro *">
                <input
                  type="date"
                  value={form.pickupDate}
                  onChange={e => setForm(f => ({ ...f, pickupDate: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                />
              </Field>

              <div className="space-y-3 bg-gray-800/50 rounded-xl p-4 border border-gray-700/60">
                <p className="text-sm font-medium text-gray-300">Seña (opcional)</p>
                <Field label="Monto">
                  <NumericInput
                    value={form.depositAmountRaw}
                    onChange={v => setForm(f => ({ ...f, depositAmountRaw: v }))}
                    placeholder="0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </Field>
                {(parseNumericInput(form.depositAmountRaw) ?? 0) > 0 && (
                  <Field label="Medio de pago">
                    <div className="grid grid-cols-2 gap-2">
                      {(['cash', 'debit', 'wallet', 'credit'] as DepositMethod[]).map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, depositMethod: m }))}
                          className={`py-2 rounded-lg text-sm font-medium transition-colors border ${
                            form.depositMethod === m
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                          }`}
                        >
                          {DEPOSIT_METHOD_LABELS[m]}
                        </button>
                      ))}
                    </div>
                  </Field>
                )}
              </div>

              <Field label="Notas (opcional)">
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Observaciones del pedido…"
                  rows={2}
                  maxLength={300}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
                />
              </Field>

              {formError && <p className="text-red-400 text-sm">{formError}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={closeForm}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void handleSave()}
                  disabled={saving || !formIsValid}
                  className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-semibold transition-colors disabled:opacity-40"
                >
                  {saving ? 'Guardando…' : editingOrder ? 'Guardar cambios' : 'Crear pedido'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl border border-gray-800 w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-semibold text-white">¿Cancelar pedido?</h2>
            <p className="text-sm text-gray-400">
              El pedido de <span className="text-white font-medium">{confirmDelete.customerName}</span> pasará a estado
              cancelado. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
              >
                No cancelar
              </button>
              <button
                onClick={() => void handleDelete(confirmDelete)}
                className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 font-semibold transition-colors"
              >
                Sí, cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componentes internos
// ---------------------------------------------------------------------------

interface OrderCardProps {
  order: OrderRow
  isAdmin: boolean
  onStatusChange: (order: OrderRow, status: OrderStatus) => Promise<void>
  onEdit: () => void
  onDelete: () => void
}

function OrderCard({ order, isAdmin, onStatusChange, onEdit, onDelete }: OrderCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [changing, setChanging] = useState(false)

  const urgent = isUrgent(order.pickupDate)
  const overdue = isOverdue(order.pickupDate, order.status)

  async function changeStatus(status: OrderStatus) {
    setChanging(true)
    await onStatusChange(order, status)
    setChanging(false)
  }

  const formattedDate = new Date(order.pickupDate + 'T00:00:00').toLocaleDateString('es-AR', {
    weekday: 'short', day: 'numeric', month: 'short',
  })

  return (
    <div
      className={`rounded-xl border transition-colors ${
        order.status === 'cancelled'
          ? 'border-gray-800 bg-gray-900/30 opacity-60'
          : overdue
          ? 'border-red-800/60 bg-red-950/20'
          : urgent
          ? 'border-amber-800/60 bg-amber-950/20'
          : 'border-gray-800 bg-gray-900'
      }`}
    >
      {/* Row principal (siempre visible) */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-white truncate max-w-[200px]" title={order.customerName}>
              {order.customerName}
            </span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLORS[order.status]}`}>
              {STATUS_LABELS[order.status]}
            </span>
            {overdue && order.status !== 'cancelled' && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-900/60 text-red-300 border border-red-800/60">
                Vencido
              </span>
            )}
            {urgent && !overdue && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-300 border border-amber-800/60">
                Hoy/Mañana
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5 truncate" title={order.items}>
            {order.items}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-gray-400">{formattedDate}</p>
          {order.depositAmount > 0 && (
            <p className="text-xs text-blue-400">{formatARS(order.depositAmount)} seña</p>
          )}
        </div>
        <span className="text-gray-600 shrink-0">{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Detalle expandido */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-800/60 pt-3">
          {order.phone && (
            <p className="text-xs text-gray-400">Tel: <span className="text-gray-200">{order.phone}</span></p>
          )}
          {order.notes && (
            <p className="text-xs text-gray-400">Notas: <span className="text-gray-200">{order.notes}</span></p>
          )}
          {order.depositAmount > 0 && (
            <p className="text-xs text-gray-400">
              Seña: <span className="text-blue-300 font-medium">{formatARS(order.depositAmount)}</span>
              {order.depositMethod && ` en ${DEPOSIT_METHOD_LABELS[order.depositMethod]}`}
            </p>
          )}

          {/* Acciones de estado */}
          {order.status !== 'cancelled' && order.status !== 'delivered' && (
            <div className="flex flex-wrap gap-2">
              {order.status === 'pending' && (
                <button
                  onClick={() => void changeStatus('ready')}
                  disabled={changing}
                  className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-xs font-semibold transition-colors disabled:opacity-40"
                >
                  Marcar listo
                </button>
              )}
              {(order.status === 'pending' || order.status === 'ready') && (
                <button
                  onClick={() => void changeStatus('delivered')}
                  disabled={changing}
                  className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-xs font-semibold transition-colors disabled:opacity-40"
                >
                  Marcar entregado
                </button>
              )}
            </div>
          )}

          {/* Acciones admin */}
          {isAdmin && order.status !== 'cancelled' && (
            <div className="flex gap-2 pt-1 border-t border-gray-800/40">
              <button
                onClick={onEdit}
                className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs font-medium transition-colors"
              >
                Editar
              </button>
              <button
                onClick={onDelete}
                className="px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-800 text-xs font-medium text-red-300 transition-colors"
              >
                Cancelar pedido
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-400">{label}</label>
      {children}
    </div>
  )
}
