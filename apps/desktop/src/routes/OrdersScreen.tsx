/**
 * Pantalla de pedidos — cajera y admin.
 *
 * Cajera: ver lista, crear pedido, editar, cancelar, marcar listo/entregado.
 * Admin: igual + eliminación permanente.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import NumericInput from '../components/NumericInput'
import { parseNumericInput, formatNumericInputValue } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import { formatPhoneInput } from '../lib/phoneInput'
import type {
  OrderRow, OrderStatus, DepositMethod, DepositPayment,
  CreateOrderPayload, UpdateOrderPayload, OrderTimeSlot,
} from '../types/hw-api'

const DEPOSIT_METHOD_LABELS: Record<DepositMethod, string> = {
  cash: 'Efectivo',
  debit: 'Débito',
  wallet: 'Billetera Virtual',
  credit: 'Crédito',
}

const TIME_SLOT_LABELS: Record<OrderTimeSlot, string> = {
  morning: 'Turno mañana',
  afternoon: 'Turno tarde',
  specific: 'Horario específico',
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
  timeSlot: OrderTimeSlot | ''
  pickupTime: string
  priority: boolean
  notes: string
  depositPayments: DepositPayment[]
}

const EMPTY_FORM: FormState = {
  customerName: '',
  phone: '',
  items: '',
  pickupDate: '',
  timeSlot: '',
  pickupTime: '',
  priority: false,
  notes: '',
  depositPayments: [],
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function isToday(pickupDate: string): boolean {
  return pickupDate === todayDateStr()
}

function isTomorrow(pickupDate: string): boolean {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return pickupDate === tomorrow.toISOString().slice(0, 10)
}

function isOverdue(pickupDate: string, status: OrderStatus): boolean {
  return status === 'pending' && pickupDate < todayDateStr()
}

function depositTotal(payments: DepositPayment[]): number {
  return payments.reduce((s, p) => s + p.amount, 0)
}

interface Props {
  isAdmin: boolean
  onBack: () => void
  onDepositCreated?: () => void
}

// Modal de confirmación reutilizable
interface ConfirmModalProps {
  title: string
  message: React.ReactNode
  confirmLabel: string
  confirmClassName?: string
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmModal({ title, message, confirmLabel, confirmClassName = 'bg-blue-600 hover:bg-blue-700', onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-800 w-full max-w-sm p-6 space-y-4">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <div className="text-sm text-gray-400">{message}</div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors">
            Cancelar
          </button>
          <button onClick={onConfirm} className={`flex-1 py-2 rounded-xl font-semibold transition-colors text-white ${confirmClassName}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function OrdersScreen({ isAdmin, onBack, onDepositCreated }: Props) {
  const [ordersList, setOrdersList] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('active')
  const [search, setSearch] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [editingOrder, setEditingOrder] = useState<OrderRow | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Confirmaciones de estado y delete
  const [confirmStatus, setConfirmStatus] = useState<{ order: OrderRow; status: OrderStatus } | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<OrderRow | null>(null)
  const [confirmHardDelete, setConfirmHardDelete] = useState<OrderRow | null>(null)

  const loadOrders = useCallback(async () => {
    const r = await window.hw.listOrders()
    if (r.ok) setOrdersList(r.data)
    else setError(r.error)
    setLoading(false)
  }, [])

  useEffect(() => {
    setLoading(true)
    void loadOrders()
  }, [loadOrders])

  const filteredOrders = useMemo(() => {
    let list = ordersList
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
      // Prioritarios primero
      if (a.priority !== b.priority) return a.priority ? -1 : 1
      const statusOrder: Record<OrderStatus, number> = { pending: 0, ready: 1, delivered: 2, cancelled: 3 }
      if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status]
      // Por fecha, luego por hora (morning < afternoon < specific < null)
      if (a.pickupDate !== b.pickupDate) return a.pickupDate.localeCompare(b.pickupDate)
      const slotOrder: Record<string, number> = { morning: 0, afternoon: 1, specific: 2 }
      const aSlot = a.timeSlot ? (slotOrder[a.timeSlot] ?? 3) : 3
      const bSlot = b.timeSlot ? (slotOrder[b.timeSlot] ?? 3) : 3
      if (aSlot !== bSlot) return aSlot - bSlot
      if (a.pickupTime && b.pickupTime) return a.pickupTime.localeCompare(b.pickupTime)
      return 0
    })
  }, [ordersList, filterStatus, search])

  const urgentTodayCount = useMemo(
    () => ordersList.filter(o => (o.status === 'pending' || o.status === 'ready') && isToday(o.pickupDate)).length,
    [ordersList]
  )
  const urgentTomorrowCount = useMemo(
    () => ordersList.filter(o => (o.status === 'pending' || o.status === 'ready') && isTomorrow(o.pickupDate)).length,
    [ordersList]
  )

  function openCreate() {
    setForm({ ...EMPTY_FORM, pickupDate: todayDateStr() })
    setFormError(null)
    setShowCreate(true)
    setEditingOrder(null)
  }

  function openEdit(order: OrderRow) {
    const payments: DepositPayment[] = order.depositPayments
      ? order.depositPayments
      : order.depositMethod && order.depositAmount > 0
        ? [{ method: order.depositMethod, amount: order.depositAmount }]
        : []
    setForm({
      customerName: order.customerName,
      phone: formatPhoneInput(order.phone ?? ''),
      items: order.items,
      pickupDate: order.pickupDate,
      timeSlot: order.timeSlot ?? '',
      pickupTime: order.pickupTime ?? '',
      priority: order.priority,
      notes: order.notes ?? '',
      depositPayments: payments,
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
    const total = depositTotal(form.depositPayments)

    if (!customerName) { setFormError('El nombre del cliente es obligatorio.'); return }
    if (!items) { setFormError('Los ítems del pedido son obligatorios.'); return }
    if (!pickupDate) { setFormError('La fecha de retiro es obligatoria.'); return }
    if (pickupDate < todayDateStr()) { setFormError('La fecha de retiro no puede ser anterior a hoy.'); return }
    if (form.timeSlot === 'specific' && !form.pickupTime) {
      setFormError('Ingresá el horario específico de retiro.'); return
    }
    if (total > 0 && form.depositPayments.length === 0) {
      setFormError('Seleccioná el medio de pago de la seña.'); return
    }

    setSaving(true)
    try {
      if (editingOrder) {
        const payload: UpdateOrderPayload = {
          id: editingOrder.id,
          customerName,
          phone: form.phone.replace(/\s/g, '') || undefined,
          items,
          pickupDate,
          timeSlot: (form.timeSlot || null) as OrderTimeSlot | null,
          pickupTime: form.timeSlot === 'specific' ? form.pickupTime || null : null,
          priority: form.priority,
          notes: form.notes.trim() || null,
          depositAmount: total,
          depositPayments: form.depositPayments.length > 0 ? form.depositPayments : null,
        }
        const r = await window.hw.updateOrder(payload)
        if (!r.ok) { setFormError(r.error); setSaving(false); return }
        setOrdersList(prev => prev.map(o => o.id === editingOrder.id ? r.data : o))
      } else {
        const payload: CreateOrderPayload = {
          customerName,
          phone: form.phone.replace(/\s/g, '') || undefined,
          items,
          pickupDate,
          timeSlot: (form.timeSlot || undefined) as OrderTimeSlot | undefined,
          pickupTime: form.timeSlot === 'specific' ? form.pickupTime || undefined : undefined,
          priority: form.priority,
          notes: form.notes.trim() || undefined,
          depositAmount: total > 0 ? total : undefined,
          depositPayments: total > 0 ? form.depositPayments : undefined,
        }
        const r = await window.hw.createOrder(payload)
        if (!r.ok) { setFormError(r.error); setSaving(false); return }
        setOrdersList(prev => [r.data, ...prev])
        if (total > 0) onDepositCreated?.()
      }
      closeForm()
    } finally {
      setSaving(false)
    }
  }

  async function executeStatusChange(order: OrderRow, status: OrderStatus) {
    const r = await window.hw.updateOrderStatus({ id: order.id, status })
    if (r.ok) {
      setOrdersList(prev => prev.map(o => o.id === order.id ? r.data : o))
    }
    setConfirmStatus(null)
  }

  async function executeCancelOrder(order: OrderRow) {
    const r = await window.hw.deleteOrder({ id: order.id })
    if (r.ok) {
      setOrdersList(prev => prev.map(o => o.id === order.id ? { ...o, status: 'cancelled' as OrderStatus, updatedBy: null } : o))
    }
    setConfirmCancel(null)
  }

  async function executeHardDelete(order: OrderRow) {
    const r = await window.hw.hardDeleteOrder({ id: order.id })
    if (r.ok) {
      setOrdersList(prev => prev.filter(o => o.id !== order.id))
    }
    setConfirmHardDelete(null)
  }

  // Agrega o actualiza un medio de pago en el formulario de seña
  function setDepositForMethod(method: DepositMethod, rawValue: string) {
    const amount = parseNumericInput(rawValue) ?? 0
    setForm(f => {
      const existing = f.depositPayments.filter(p => p.method !== method)
      if (amount > 0) return { ...f, depositPayments: [...existing, { method, amount }] }
      return { ...f, depositPayments: existing }
    })
  }

  function getDepositRaw(method: DepositMethod): string {
    const p = form.depositPayments.find(p => p.method === method)
    return p ? formatNumericInputValue(String(p.amount)) : ''
  }

  const totalDeposit = depositTotal(form.depositPayments)
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
          >←</button>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-white">Pedidos</h1>
            <div className="flex items-center gap-1.5 flex-wrap">
              {urgentTodayCount > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-900/50 text-red-300 border border-red-800/60">
                  {urgentTodayCount} hoy
                </span>
              )}
              {urgentTomorrowCount > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-900/50 text-amber-300 border border-amber-800/60">
                  {urgentTomorrowCount} mañana
                </span>
              )}
            </div>
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
              {s === 'active' ? 'Activos' : 'Últimos 30 días'}
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
            onRequestStatusChange={(o, s) => setConfirmStatus({ order: o, status: s })}
            onEdit={() => openEdit(order)}
            onCancel={() => setConfirmCancel(order)}
            onHardDelete={isAdmin ? () => setConfirmHardDelete(order) : undefined}
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
              {/* Prioritario */}
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.checked }))}
                  className="w-4 h-4 accent-orange-500"
                />
                <span className="text-sm font-medium text-orange-400">⚡ Pedido prioritario / importante</span>
              </label>

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
                  min={todayDateStr()}
                  onChange={e => setForm(f => ({ ...f, pickupDate: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                />
              </Field>

              {/* Horario de retiro */}
              <div className="space-y-2">
                <label className="text-xs text-gray-400">Horario de retiro (opcional)</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['morning', 'afternoon', 'specific'] as OrderTimeSlot[]).map(slot => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, timeSlot: f.timeSlot === slot ? '' : slot }))}
                      className={`py-2 rounded-lg text-xs font-medium transition-colors border ${
                        form.timeSlot === slot
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {TIME_SLOT_LABELS[slot]}
                    </button>
                  ))}
                </div>
                {form.timeSlot === 'specific' && (
                  <input
                    type="time"
                    value={form.pickupTime}
                    onChange={e => setForm(f => ({ ...f, pickupTime: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  />
                )}
              </div>

              {/* Seña multi-método */}
              <div className="space-y-3 bg-gray-800/50 rounded-xl p-4 border border-gray-700/60">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-300">Seña (opcional)</p>
                  {totalDeposit > 0 && (
                    <span className="text-sm font-semibold text-blue-300">{formatARS(totalDeposit)} total</span>
                  )}
                </div>
                <div className="space-y-2">
                  {(['cash', 'debit', 'wallet', 'credit'] as DepositMethod[]).map(m => (
                    <div key={m} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-28 shrink-0">{DEPOSIT_METHOD_LABELS[m]}</span>
                      <NumericInput
                        value={getDepositRaw(m)}
                        onChange={v => setDepositForMethod(m, v)}
                        placeholder="0"
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  ))}
                </div>
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

      {/* Modales de confirmación de estado */}
      {confirmStatus && (
        <ConfirmModal
          title={`¿${confirmStatus.status === 'ready' ? 'Marcar como listo' : confirmStatus.status === 'delivered' ? 'Marcar como entregado' : 'Revertir a pendiente'}?`}
          message={
            <>
              Pedido de <strong className="text-white">{confirmStatus.order.customerName}</strong>.
              {' '}Esta acción quedará registrada con tu usuario.
            </>
          }
          confirmLabel={confirmStatus.status === 'ready' ? 'Sí, marcar listo' : confirmStatus.status === 'delivered' ? 'Sí, marcar entregado' : 'Sí, revertir'}
          confirmClassName={confirmStatus.status === 'delivered' ? 'bg-emerald-600 hover:bg-emerald-700' : confirmStatus.status === 'ready' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-amber-600 hover:bg-amber-700'}
          onConfirm={() => void executeStatusChange(confirmStatus.order, confirmStatus.status)}
          onCancel={() => setConfirmStatus(null)}
        />
      )}

      {/* Modal de cancelación de pedido */}
      {confirmCancel && (
        <ConfirmModal
          title="¿Cancelar pedido?"
          message={
            <>
              El pedido de <strong className="text-white">{confirmCancel.customerName}</strong> pasará a estado cancelado.
              Esta acción quedará registrada con tu usuario.
            </>
          }
          confirmLabel="Sí, cancelar pedido"
          confirmClassName="bg-red-600 hover:bg-red-700"
          onConfirm={() => void executeCancelOrder(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
        />
      )}

      {/* Modal de eliminación permanente (solo admin) */}
      {confirmHardDelete && (
        <ConfirmModal
          title="¿Eliminar pedido permanentemente?"
          message={
            <>
              Se eliminará el registro completo del pedido de{' '}
              <strong className="text-white">{confirmHardDelete.customerName}</strong>.
              Esta acción <strong>no se puede deshacer</strong>.
            </>
          }
          confirmLabel="Sí, eliminar para siempre"
          confirmClassName="bg-red-700 hover:bg-red-800"
          onConfirm={() => void executeHardDelete(confirmHardDelete)}
          onCancel={() => setConfirmHardDelete(null)}
        />
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
  onRequestStatusChange: (order: OrderRow, status: OrderStatus) => void
  onEdit: () => void
  onCancel: () => void
  onHardDelete?: () => void
}

function OrderCard({ order, isAdmin, onRequestStatusChange, onEdit, onCancel, onHardDelete }: OrderCardProps) {
  const [expanded, setExpanded] = useState(false)

  const today = isToday(order.pickupDate)
  const tomorrow = isTomorrow(order.pickupDate)
  const overdue = isOverdue(order.pickupDate, order.status)

  const depositPayments: DepositPayment[] = order.depositPayments
    ? order.depositPayments
    : order.depositMethod && order.depositAmount > 0
      ? [{ method: order.depositMethod, amount: order.depositAmount }]
      : []

  const formattedDate = new Date(order.pickupDate + 'T00:00:00').toLocaleDateString('es-AR', {
    weekday: 'short', day: 'numeric', month: 'short',
  })

  function timeSlotLabel(): string | null {
    if (!order.timeSlot) return null
    if (order.timeSlot === 'specific' && order.pickupTime) return order.pickupTime
    return TIME_SLOT_LABELS[order.timeSlot]
  }

  return (
    <div
      className={`rounded-xl border transition-colors ${
        order.status === 'cancelled'
          ? 'border-gray-800 bg-gray-900/30 opacity-60'
          : overdue
          ? 'border-red-800/60 bg-red-950/20'
          : today
          ? 'border-orange-800/60 bg-orange-950/20'
          : tomorrow
          ? 'border-amber-800/60 bg-amber-950/20'
          : order.priority
          ? 'border-orange-700/60 bg-orange-950/10'
          : 'border-gray-800 bg-gray-900'
      }`}
    >
      {/* Row principal */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {order.priority && (
              <span className="text-[10px] font-bold text-orange-400" title="Prioritario">⚡</span>
            )}
            <span className="font-medium text-white truncate max-w-[200px]" title={order.customerName}>
              {order.customerName}
            </span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLORS[order.status]}`}>
              {STATUS_LABELS[order.status]}
            </span>
            {overdue && order.status !== 'cancelled' && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-900/60 text-red-300 border border-red-800/60">Vencido</span>
            )}
            {!overdue && today && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-900/60 text-orange-300 border border-orange-800/60">Hoy</span>
            )}
            {!overdue && tomorrow && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-300 border border-amber-800/60">Mañana</span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5 truncate" title={order.items}>
            {order.items}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-gray-400">{formattedDate}</p>
          {timeSlotLabel() && <p className="text-[10px] text-gray-500">{timeSlotLabel()}</p>}
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
            <p className="text-xs text-gray-400 break-words">
              Notas: <span className="text-gray-200">{order.notes}</span>
            </p>
          )}
          {order.updatedBy && (
            <p className="text-[10px] text-gray-600">
              Última modificación: {order.updatedBy}
            </p>
          )}
          {depositPayments.length > 0 && (
            <div className="text-xs text-gray-400 space-y-0.5">
              <p className="font-medium text-gray-300">Seña: {formatARS(order.depositAmount)}</p>
              {depositPayments.map(p => (
                <p key={p.method}>{DEPOSIT_METHOD_LABELS[p.method]}: {formatARS(p.amount)}</p>
              ))}
            </div>
          )}

          {/* Acciones de estado — con doble confirmación */}
          {order.status !== 'cancelled' && (
            <div className="flex flex-wrap gap-2">
              {order.status === 'pending' && (
                <button
                  onClick={() => onRequestStatusChange(order, 'ready')}
                  className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-xs font-semibold transition-colors"
                >
                  Marcar listo
                </button>
              )}
              {(order.status === 'pending' || order.status === 'ready') && (
                <button
                  onClick={() => onRequestStatusChange(order, 'delivered')}
                  className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-xs font-semibold transition-colors"
                >
                  Marcar entregado
                </button>
              )}
              {(order.status === 'ready' || order.status === 'delivered') && (
                <button
                  onClick={() => onRequestStatusChange(order, 'pending')}
                  className="px-3 py-1.5 rounded-lg bg-amber-800/60 hover:bg-amber-700 text-xs font-medium text-amber-200 transition-colors"
                  title="Revertir a pendiente"
                >
                  ↩ Deshacer
                </button>
              )}
            </div>
          )}

          {/* Acciones de edición/cancelación — cajera y admin */}
          {order.status !== 'cancelled' && (
            <div className="flex gap-2 pt-1 border-t border-gray-800/40">
              <button
                onClick={onEdit}
                className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs font-medium transition-colors"
              >
                Editar
              </button>
              <button
                onClick={onCancel}
                className="px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-800 text-xs font-medium text-red-300 transition-colors"
              >
                Cancelar pedido
              </button>
              {isAdmin && onHardDelete && (
                <button
                  onClick={onHardDelete}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-red-950 text-xs font-medium text-gray-500 hover:text-red-400 transition-colors"
                  title="Eliminar permanentemente"
                >
                  🗑 Eliminar
                </button>
              )}
            </div>
          )}
          {order.status === 'cancelled' && isAdmin && onHardDelete && (
            <div className="pt-1 border-t border-gray-800/40">
              <button
                onClick={onHardDelete}
                className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-red-950 text-xs font-medium text-gray-500 hover:text-red-400 transition-colors"
                title="Eliminar permanentemente"
              >
                🗑 Eliminar permanentemente
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
