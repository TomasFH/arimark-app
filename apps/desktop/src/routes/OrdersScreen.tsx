/**
 * Pantalla de pedidos — cajera y admin.
 *
 * Cajera: ver lista, crear pedido, editar, cancelar, marcar listo/entregado.
 * Admin: igual + eliminación permanente.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import NumericInput from '../components/NumericInput'
import { ActionMenu, Button, ScreenHeader } from '../components/ui'
import DecimalInput from '../components/DecimalInput'
import { parseNumericInput, formatNumericInputValue, parseDecimalInput } from '../lib/numericInput'
import { addDaysYmd, formatARS, formatYmd, todayLocalYmd, toLocalDateTime } from '../lib/datetime'
import { formatPhoneInput } from '../lib/phoneInput'
import StoreFilter from '../components/StoreFilter'
import {
  searchProductsByQuery,
  formatKgQty,
  formatOrderQty,
  formatOrderQtyHint,
  summarizeBudgetItems,
  checkPickupTime,
  clockMinutes,
  hoursForDate,
  isPickupDueSoon,
  isPickupOutsideHoursOnDate,
  pickupHoursLiveErrorOnDate,
  pickupSlotAvailability,
  pickupSlotRegistrationError,
  PICKUP_SPECIFIC_HINT,
  storeHoursSourceFromRecord,
  type StoreHoursSource,
} from '@carniceria/shared'
import { buildOrdersView } from '../lib/orderListView'
import type { OrderSortContext } from '../lib/orderListSort'
import type {
  OrderRow, OrderStatus, DepositMethod, DepositPayment,
  CreateOrderPayload, UpdateOrderPayload, OrderTimeSlot, StoreRow,
  SaleItemDraft, BudgetCartLine, ProductRow,
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
  pending: 'bg-amber-950/50 text-amber-400/80 border-amber-900/40',
  ready: 'bg-raised text-ink border-line',
  delivered: 'bg-accent-soft text-success border-line-accent',
  cancelled: 'bg-raised text-muted border-line',
}

/** Línea editable en el carrito de presupuesto (UI) */
interface BudgetCartDraft extends BudgetCartLine {
  /** Cantidad ingresada como string (para los inputs controlados) */
  qtyRaw: string
  /** Unidades pedidas (solo productos kg). Vacío = pidió kilos. */
  requestedUnitsRaw: string
}

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
  /** Solo admin: local destino del pedido */
  storeId: string
  /** Productos del pedido */
  budgetCart: BudgetCartDraft[]
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
  storeId: '',
  budgetCart: [],
}

/** Producto por kg con unidades cargadas y el peso vacío: no hay precio estimado. */
function kgLineMissingWeight(line: BudgetCartDraft): boolean {
  if (line.unit !== 'kg') return false
  const kg = parseDecimalInput(line.qtyRaw)
  const units = parseNumericInput(line.requestedUnitsRaw)
  return units !== null && units > 0 && (kg === null || kg <= 0)
}

/** Líneas del carrito con cantidad válida (kg, unidades de catálogo, o piezas). */
function resolvedBudgetLines(cart: BudgetCartDraft[]): BudgetCartLine[] {
  return cart.flatMap((line): BudgetCartLine[] => {
    if (line.unit === 'unit') {
      const qty = parseNumericInput(line.qtyRaw)
      if (qty === null || qty <= 0) return []
      return [{
        productId: line.productId,
        name: line.name,
        unit: line.unit,
        pluNumber: line.pluNumber,
        estimatedQty: qty,
        unitPrice: line.unitPrice,
      }]
    }

    const kg = parseDecimalInput(line.qtyRaw)
    const units = parseNumericInput(line.requestedUnitsRaw)
    const hasKg = kg !== null && kg > 0
    const hasUnits = units !== null && units > 0
    if (!hasKg && !hasUnits) return []
    return [{
      productId: line.productId,
      name: line.name,
      unit: line.unit,
      pluNumber: line.pluNumber,
      estimatedQty: hasKg ? kg : 0,
      unitPrice: line.unitPrice,
      requestedUnits: hasUnits ? units : null,
    }]
  })
}

function estimatedBudgetTotal(lines: BudgetCartLine[]): number {
  return lines.reduce((sum, line) => {
    if (line.estimatedQty <= 0) return sum
    return sum + Math.round(line.unitPrice * line.estimatedQty)
  }, 0)
}

function todayDateStr(): string {
  return todayLocalYmd()
}

function isToday(pickupDate: string): boolean {
  return pickupDate === todayDateStr()
}

function isTomorrow(pickupDate: string): boolean {
  return pickupDate === addDaysYmd(todayDateStr(), 1)
}

function paymentsForOrder(order: OrderRow): DepositPayment[] {
  if (Array.isArray(order.depositPayments) && order.depositPayments.length > 0) {
    return order.depositPayments
  }
  if (order.depositMethod && order.depositAmount > 0) {
    return [{ method: order.depositMethod, amount: order.depositAmount }]
  }
  return []
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
  /** ID del turno activo cuando se navega desde la caja; null si se viene desde admin hub */
  currentShiftId: string | null
  /** Local de la sesión (cajera o admin con local elegido). */
  sessionStoreId?: string
  /** Callback para inyectar el carrito del pedido en el POS (solo cuando hay turno activo) */
  onInjectOrderCart?: (cart: {
    orderId: string
    customerName: string
    depositAmount: number
    depositPayments: DepositPayment[]
    items: SaleItemDraft[]
  }) => void
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

function ConfirmModal({ title, message, confirmLabel, confirmClassName = 'bg-accent hover:bg-accent', onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-panel rounded-2xl border border-line w-full max-w-sm p-6 space-y-4 overflow-hidden animate-modal-enter">
        <h2 className="text-base font-semibold text-ink break-words">{title}</h2>
        <div className="text-sm text-muted break-words">{message}</div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2 rounded-xl border border-line text-ink hover:bg-hover transition-colors">
            Cancelar
          </button>
          <button onClick={onConfirm} className={`flex-1 py-2 rounded-xl font-semibold transition-colors text-ink ${confirmClassName}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function OrdersScreen({ isAdmin, onBack, currentShiftId, sessionStoreId, onInjectOrderCart }: Props) {
  const [ordersList, setOrdersList] = useState<OrderRow[]>([])
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showClosed, setShowClosed] = useState(false)

  // Filtro de local — solo visible cuando admin llega desde el hub (sin turno activo)
  const showStoreFilter = isAdmin && currentShiftId === null
  const [storeIdFilter, setStoreIdFilter] = useState<string>('all')
  const [availableStores, setAvailableStores] = useState<StoreRow[]>([])

  // Catálogo de productos para el carrito de presupuesto
  const [catalog, setCatalog] = useState<ProductRow[]>([])

  // ID del pedido recién creado — para scroll y highlight
  const [newOrderId, setNewOrderId] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [editingOrder, setEditingOrder] = useState<OrderRow | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Búsqueda typeahead del carrito de presupuesto
  const [budgetSearch, setBudgetSearch] = useState('')
  const [budgetSuggestions, setBudgetSuggestions] = useState<ProductRow[]>([])
  const budgetSearchRef = useRef<HTMLInputElement>(null)
  const lastQtyRef = useRef<HTMLInputElement>(null)
  const prevCartLen = useRef(0)

  // Confirmaciones de estado y delete
  const [confirmStatus, setConfirmStatus] = useState<{ order: OrderRow; status: OrderStatus } | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<OrderRow | null>(null)
  // Confirmación de seña antes de guardar
  const [showDepositConfirm, setShowDepositConfirm] = useState(false)
  const [confirmHardDelete, setConfirmHardDelete] = useState<OrderRow | null>(null)
  // Si hay turno activo y el pedido tiene seña, ofrecer registrar la devolución como gasto
  const [registerRefund, setRegisterRefund] = useState(true)

  // Modal de cobro mediante inyección en POS (nuevo flujo)
  const [chargeModalOrder, setChargeModalOrder] = useState<OrderRow | null>(null)
  const [chargeCartLines, setChargeCartLines] = useState<Array<BudgetCartDraft & { checked: boolean }>>([])
  const [chargeError, setChargeError] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState(() => Date.now())

  const loadOrders = useCallback(async () => {
    const r = await window.hw.listOrders(showStoreFilter ? { storeIdFilter } : undefined)
    if (r.ok) setOrdersList(r.data)
    else setError(r.error)
    setLoading(false)
  }, [showStoreFilter, storeIdFilter])

  useEffect(() => {
    setLoading(true)
    void loadOrders()
  }, [loadOrders])

  useEffect(() => {
    const hw = window.hw
    if (typeof hw.onOrderSyncUpdated !== 'function') return undefined
    return hw.onOrderSyncUpdated(() => {
      void loadOrders()
    })
  }, [loadOrders])

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  // Cargar locales (horarios de atención) siempre: hace falta para validar retiro.
  useEffect(() => {
    window.hw.getStores().then(r => {
      if (r.ok) setAvailableStores(r.data)
    })
  }, [])

  // Cargar catálogo para el carrito de presupuesto
  useEffect(() => {
    window.hw.getProducts().then(r => {
      if (r.ok) setCatalog(r.data)
    })
  }, [])

  // Búsqueda de productos para el carrito de presupuesto
  useEffect(() => {
    const q = budgetSearch.trim()
    if (!q) { setBudgetSuggestions([]); return }
    const results = searchProductsByQuery(catalog, q, {
      nameOf: p => p.name,
      pluOf: p => p.pluNumber ?? 0,
    })
    setBudgetSuggestions(results.slice(0, 8))
  }, [budgetSearch, catalog])

  useEffect(() => {
    if (form.budgetCart.length > prevCartLen.current) {
      requestAnimationFrame(() => lastQtyRef.current?.focus())
    }
    prevCartLen.current = form.budgetCart.length
  }, [form.budgetCart.length])

  const hoursByStore = useMemo(() => {
    const map = new Map<string, StoreHoursSource>()
    for (const s of availableStores) {
      map.set(s.id, storeHoursSourceFromRecord(s))
    }
    return map
  }, [availableStores])

  const sortCtx: OrderSortContext = useMemo(() => ({
    todayYmd: todayDateStr(),
    nowMinutes: clockMinutes(new Date(nowTick)),
    hoursByStore,
  }), [hoursByStore, nowTick])

  const ordersView = useMemo(
    () => buildOrdersView(ordersList, search, showClosed, sortCtx),
    [ordersList, search, showClosed, sortCtx],
  )
  const listForScroll = ordersView.mode === 'grouped'
    ? [...ordersView.ready, ...ordersView.pending]
    : ordersView.results

  const urgentTodayCount = useMemo(
    () => ordersList.filter(o => (o.status === 'pending' || o.status === 'ready') && isToday(o.pickupDate)).length,
    [ordersList]
  )
  const urgentTomorrowCount = useMemo(
    () => ordersList.filter(o => (o.status === 'pending' || o.status === 'ready') && isTomorrow(o.pickupDate)).length,
    [ordersList]
  )

  // Cuando se crea un pedido: limpia filtros para que sea visible, scroll y highlight temporal
  useEffect(() => {
    if (!newOrderId) return
    const el = document.getElementById(`order-${newOrderId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    const timer = setTimeout(() => setNewOrderId(null), 2500)
    return () => clearTimeout(timer)
  // listForScroll en deps para reintentar el scroll una vez que la lista se re-renderiza
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newOrderId, listForScroll])

  function openCreate() {
    // Default del local: la tab activa (si no es 'all' ni vacío) o el primer local disponible
    const defaultStoreId = (storeIdFilter && storeIdFilter !== 'all')
      ? storeIdFilter
      : (availableStores[0]?.id ?? '')
    prevCartLen.current = 0
    setForm({ ...EMPTY_FORM, pickupDate: todayDateStr(), storeId: defaultStoreId })
    setFormError(null)
    setShowCreate(true)
    setEditingOrder(null)
  }

  function openEdit(order: OrderRow) {
    const payments: DepositPayment[] = paymentsForOrder(order)
    const budgetCart: BudgetCartDraft[] = (order.budgetItems ?? []).map(line => ({
      ...line,
      qtyRaw: line.unit === 'kg'
        ? (line.estimatedQty > 0 ? String(line.estimatedQty).replace('.', ',') : '')
        : String(Math.round(line.estimatedQty)),
      requestedUnitsRaw: line.requestedUnits && line.requestedUnits > 0
        ? String(line.requestedUnits)
        : '',
    }))
    prevCartLen.current = budgetCart.length
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
      storeId: order.storeId,
      budgetCart,
    })
    setFormError(null)
    setEditingOrder(order)
    setShowCreate(false)
  }

  function closeForm() {
    prevCartLen.current = 0
    setShowCreate(false)
    setEditingOrder(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  function hoursSourceForForm(): StoreHoursSource | null {
    const id = showStoreFilter
      ? form.storeId
      : (sessionStoreId || ordersList[0]?.storeId || availableStores[0]?.id || '')
    const store = availableStores.find(s => s.id === id)
    return store ? storeHoursSourceFromRecord(store) : null
  }

  useEffect(() => {
    const available = pickupSlotAvailability(hoursSourceForForm(), form.pickupDate)
    if (
      (form.timeSlot === 'afternoon' && !available.afternoon)
      || (form.timeSlot === 'morning' && !available.morning)
    ) {
      setForm(f => ({ ...f, timeSlot: '' }))
    }
  // hoursSourceForForm depende del local elegido y de la lista de locales.
  }, [form.pickupDate, form.timeSlot, form.storeId, availableStores, showStoreFilter, sessionStoreId])

  async function handleSave() {
    setFormError(null)
    const customerName = form.customerName.trim()
    const pickupDate = form.pickupDate.trim()
    const total = depositTotal(form.depositPayments)

    if (!customerName) { setFormError('El nombre del cliente es obligatorio.'); return }
    if (resolvedBudgetLines(form.budgetCart).length === 0) {
      setFormError('Agregá al menos un producto con cantidad.'); return
    }
    if (!pickupDate) { setFormError('La fecha de retiro es obligatoria.'); return }
    if (showStoreFilter && !form.storeId) { setFormError('Seleccioná un local para el pedido.'); return }
    if (pickupDate < todayDateStr()) { setFormError('La fecha de retiro no puede ser anterior a hoy.'); return }
    if (form.timeSlot === 'specific' && !form.pickupTime) {
      setFormError('Ingresá el horario específico de retiro.'); return
    }
    if (form.timeSlot === 'specific' && form.pickupTime) {
      const closed = pickupHoursLiveErrorOnDate(form.timeSlot, form.pickupTime, hoursSourceForForm(), form.pickupDate)
      if (closed) { setFormError(closed); return }
    }
    const slotClosed = pickupSlotRegistrationError(form.timeSlot, hoursSourceForForm(), form.pickupDate)
    if (slotClosed) { setFormError(slotClosed); return }
    if (total > 0 && form.depositPayments.length === 0) {
      setFormError('Seleccioná el medio de pago de la seña.'); return
    }

    // Si hay seña, pedir confirmación antes de persistir
    if (total > 0) {
      setShowDepositConfirm(true)
      return
    }

    await doSave()
  }

  async function doSave() {
    setShowDepositConfirm(false)
    const customerName = form.customerName.trim()
    const pickupDate = form.pickupDate.trim()
    const total = depositTotal(form.depositPayments)
    const budgetItems = resolvedBudgetLines(form.budgetCart)
    const items = summarizeBudgetItems(budgetItems)

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
          budgetItems,
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
          // Admin puede especificar un local diferente al de sesión
          storeId: showStoreFilter && form.storeId ? form.storeId : undefined,
          budgetItems,
        }
        const r = await window.hw.createOrder(payload)
        if (!r.ok) { setFormError(r.error); setSaving(false); return }
        setOrdersList(prev => [r.data, ...prev])
        setSearch('')
        setShowClosed(false)
        setNewOrderId(r.data.id)
      }
      closeForm()
    } finally {
      setSaving(false)
    }
  }

  /** Abre el modal de cobro por POS: prepopula líneas del carrito de presupuesto */
  function openChargeModal(order: OrderRow) {
    const lines = (order.budgetItems ?? []).map(line => ({
      ...line,
      qtyRaw: '',
      requestedUnitsRaw: line.requestedUnits && line.requestedUnits > 0
        ? String(line.requestedUnits)
        : '',
      checked: true,
    }))
    setChargeCartLines(lines)
    setChargeModalOrder(order)
    setChargeError(null)
  }

  /** Confirmar cobro: inyecta el carrito en el POS */
  function handleConfirmCharge() {
    if (!chargeModalOrder) return
    setChargeError(null)

    if (!onInjectOrderCart) {
      // Sin turno activo: solo se puede marcar entregado si la seña cubre todo (remaining=0)
      const deposit = chargeModalOrder.depositAmount
      if (deposit === 0 || chargeCartLines.length > 0) {
        setChargeError('Abrir un turno para cobrar con el POS.')
        return
      }
      // Seña cubre todo → CHARGE_ORDER con remaining=0
      void window.hw.chargeOrder({ orderId: chargeModalOrder.id, remaining: 0, payments: [] }).then(r => {
        if (!r.ok) { setChargeError(r.error ?? 'Error al marcar entregado.'); return }
        setOrdersList(prev => prev.map(o => o.id === r.data.id ? r.data : o))
        setChargeModalOrder(null)
      })
      return
    }

    // Construir items del carrito para inyectar en el POS
    const checked = chargeCartLines.filter(line => line.checked)
    for (const line of checked) {
      const typed = line.unit === 'kg'
        ? parseDecimalInput(line.qtyRaw)
        : parseNumericInput(line.qtyRaw)
      if ((typed === null || typed <= 0) && line.estimatedQty <= 0) {
        setChargeError(`Ingresá el peso de ${line.name}.`)
        return
      }
    }

    const items: SaleItemDraft[] = checked
      .map(line => {
        const qty = line.unit === 'kg'
          ? (parseDecimalInput(line.qtyRaw) ?? null)
          : (parseNumericInput(line.qtyRaw) ?? null)
        const weightKg = qty ?? line.estimatedQty
        return {
          pluNumber: line.pluNumber ?? 0,
          productId: line.productId,
          productName: line.name,
          weightKg,
          unit: line.unit,
          unitPrice: line.unitPrice,
          subtotal: Math.round(line.unitPrice * weightKg),
          manualEntry: true,
        }
      })
      .filter(item => item.subtotal > 0)

    const depositPayments = paymentsForOrder(chargeModalOrder)
    const deposit = chargeModalOrder.depositAmount

    onInjectOrderCart({
      orderId: chargeModalOrder.id,
      customerName: chargeModalOrder.customerName,
      depositAmount: deposit,
      depositPayments,
      items,
    })
    setChargeModalOrder(null)
  }

  async function executeStatusChange(order: OrderRow, status: OrderStatus) {
    const r = await window.hw.updateOrderStatus({ id: order.id, status })
    if (r.ok) {
      setOrdersList(prev => prev.map(o => o.id === order.id ? r.data : o))
    }
    setConfirmStatus(null)
  }

  async function executeCancelOrder(order: OrderRow, refund: boolean) {
    const r = await window.hw.deleteOrder({ id: order.id })
    if (r.ok) {
      setOrdersList(prev => prev.map(o => o.id === order.id ? { ...o, status: 'cancelled' as OrderStatus, updatedBy: null } : o))
      // Registrar devolución como gasto si corresponde
      if (refund && order.depositAmount > 0 && currentShiftId) {
        await window.hw.registerExpense({
          concept: 'Devolución de seña',
          amount: order.depositAmount,
          notes: `Seña devuelta al cliente: ${order.customerName}`,
        }).catch(err => {
          // El pedido ya fue cancelado; solo registrar el error sin bloquear
          console.error('[cancel-order] No se pudo registrar la devolución como gasto', err)
        })
      }
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
  const liveBudget = resolvedBudgetLines(form.budgetCart)
  const liveEstimate = estimatedBudgetTotal(liveBudget)
  const livePickupHoursError = pickupHoursLiveErrorOnDate(form.timeSlot, form.pickupTime, hoursSourceForForm(), form.pickupDate)
  const slotAvailability = pickupSlotAvailability(hoursSourceForForm(), form.pickupDate)
  const pickupSlotOptions = (['morning', 'afternoon', 'specific'] as OrderTimeSlot[]).filter(slot => {
    if (slot === 'morning') return slotAvailability.morning
    if (slot === 'afternoon') return slotAvailability.afternoon
    return true
  })
  const formIsValid = form.customerName.trim() && liveBudget.length > 0 && form.pickupDate && !livePickupHoursError

  function toggleExpanded(orderId: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  function renderOrderCard(order: OrderRow) {
    return (
      <OrderCard
        key={order.id}
        order={order}
        expanded={expandedIds.has(order.id)}
        onToggleExpanded={() => toggleExpanded(order.id)}
        isAdmin={isAdmin}
        isNew={order.id === newOrderId}
        onRequestStatusChange={(o, s) => setConfirmStatus({ order: o, status: s })}
        onCharge={openChargeModal}
        onEdit={order.status === 'pending' ? () => openEdit(order) : undefined}
        onCancel={order.status === 'delivered' ? undefined : () => { setRegisterRefund(true); setConfirmCancel(order) }}
        onHardDelete={isAdmin && order.status === 'cancelled' ? () => setConfirmHardDelete(order) : undefined}
        hours={hoursByStore.get(order.storeId) ?? null}
        sortCtx={sortCtx}
      />
    )
  }

  return (
    <div className="flex flex-col flex-1 h-full bg-app text-ink overflow-hidden">
      <ScreenHeader
        title="Pedidos"
        subtitle={
          [urgentTodayCount > 0 ? `${urgentTodayCount} para hoy` : '', urgentTomorrowCount > 0 ? `${urgentTomorrowCount} para mañana` : '']
            .filter(Boolean)
            .join(' · ') || undefined
        }
        onBack={onBack}
        actions={
          <>
            {showStoreFilter && availableStores.length > 0 && (
              <StoreFilter
                stores={availableStores}
                value={storeIdFilter}
                onChange={v => setStoreIdFilter(v)}
              />
            )}
            {!search.trim() && (
              <Button
                type="button"
                variant={showClosed ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setShowClosed(v => !v)}
                title={showClosed ? 'Volver a listos y pendientes' : 'Ver cobrados y cancelados'}
              >
                Entregados y cancelados
              </Button>
            )}
            <Button size="sm" onClick={openCreate}>+ Nuevo pedido</Button>
          </>
        }
      />

      {/* Filters */}
      <div className="px-4 py-2 border-b border-line shrink-0">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar cliente, teléfono o producto (incluye entregados)"
          className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-line-accent"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        {loading && <p className="text-muted text-sm text-center py-8 animate-pulse">Cargando pedidos…</p>}
        {error && <p className="text-danger text-sm text-center py-8">{error}</p>}
        {!loading && !error && ordersView.mode === 'search' && (
          ordersView.results.length === 0 ? (
            <p className="text-muted text-sm text-center py-8">Ningún pedido coincide.</p>
          ) : (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Resultados <span className="tabular-nums">({ordersView.results.length})</span>
              </h2>
              {ordersView.results.map(renderOrderCard)}
            </section>
          )
        )}
        {!loading && !error && ordersView.mode === 'closed' && (
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Entregados y cancelados <span className="tabular-nums">({ordersView.results.length})</span>
            </h2>
            {ordersView.results.length === 0 ? (
              <p className="text-xs text-subtle px-1">No hay entregados ni cancelados.</p>
            ) : (
              ordersView.results.map(renderOrderCard)
            )}
          </section>
        )}
        {!loading && !error && ordersView.mode === 'grouped' && (
          <>
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Listos <span className="tabular-nums text-muted">({ordersView.ready.length})</span>
              </h2>
              {ordersView.ready.length === 0 ? (
                <p className="text-xs text-subtle px-1">No hay pedidos listos.</p>
              ) : (
                ordersView.ready.map(renderOrderCard)
              )}
            </section>
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Pendientes <span className="tabular-nums text-muted">({ordersView.pending.length})</span>
              </h2>
              {ordersView.pending.length === 0 ? (
                <p className="text-xs text-subtle px-1">No hay pedidos pendientes.</p>
              ) : (
                ordersView.pending.map(renderOrderCard)
              )}
            </section>
          </>
        )}
      </div>

      {/* Create / Edit form modal */}
      {(showCreate || editingOrder) && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-lg bg-panel rounded-t-2xl sm:rounded-2xl border border-line max-h-[92vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-line flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {editingOrder ? 'Editar pedido' : 'Nuevo pedido'}
              </h2>
              <button onClick={closeForm} className="text-muted hover:text-ink text-xl">×</button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Selector de local — solo admin desde hub */}
              {showStoreFilter && !editingOrder && availableStores.length > 0 && (
                <Field label="Local *">
                  <select
                    value={form.storeId}
                    onChange={e => {
                      const storeId = e.target.value
                      setForm(f => {
                        const store = availableStores.find(s => s.id === storeId)
                        const available = pickupSlotAvailability(
                          store ? storeHoursSourceFromRecord(store) : null,
                          f.pickupDate,
                        )
                        const timeSlot = (f.timeSlot === 'afternoon' && !available.afternoon)
                          || (f.timeSlot === 'morning' && !available.morning)
                          ? ''
                          : f.timeSlot
                        return { ...f, storeId, timeSlot }
                      })
                    }}
                    className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-ink focus:outline-none focus:border-line-accent text-sm"
                  >
                    <option value="">— Seleccioná un local —</option>
                    {availableStores.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </Field>
              )}

              {/* Prioritario */}
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.checked }))}
                  className="w-4 h-4 accent-orange-500"
                />
                <span className="text-sm font-medium text-muted">⚡ Pedido prioritario / importante</span>
              </label>

              <Field label="Nombre del cliente *">
                <input
                  type="text"
                  value={form.customerName}
                  onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                  placeholder="Ej: Restaurante El Sol"
                  maxLength={100}
                  className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-ink placeholder:text-muted focus:outline-none focus:border-line-accent"
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
                  className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-ink placeholder:text-muted focus:outline-none focus:border-line-accent"
                />
              </Field>

              {/* Productos del pedido (obligatorio) */}
              <div className="space-y-3 bg-raised rounded-xl p-4 border border-line">
                <p className="text-sm font-medium text-ink">Productos *</p>
                {editingOrder && form.budgetCart.length === 0 && form.items && (
                  <p className="text-[11px] text-muted break-words" title={form.items}>
                    Texto anterior: {form.items}
                  </p>
                )}

                {form.budgetCart.length > 0 && (
                  <div className="space-y-1.5">
                    {form.budgetCart.map((line, idx) => {
                      const isLast = idx === form.budgetCart.length - 1
                      const missingWeight = kgLineMissingWeight(line)
                      return (
                      <div key={idx} className="space-y-1">
                      <div className="flex items-center gap-2 bg-hover rounded-lg px-3 py-1.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-ink truncate" title={line.name}>{line.name}</p>
                          <p className="text-[10px] text-muted">{formatARS(line.unitPrice)} / {line.unit === 'kg' ? 'kg' : 'u'}</p>
                        </div>
                        <div className="shrink-0 w-20">
                          {line.unit === 'kg' ? (
                            <DecimalInput
                              ref={isLast ? lastQtyRef : undefined}
                              value={line.qtyRaw}
                              onChange={v => setForm(f => ({ ...f, budgetCart: f.budgetCart.map((l, i) => i === idx ? { ...l, qtyRaw: v } : l) }))}
                              placeholder="kg"
                              maxDecimals={3}
                              weightMode
                              title="Peso estimado"
                              className={`w-full bg-panel rounded px-2 py-1 text-xs text-ink text-right ${
                                missingWeight
                                  ? 'border border-orange-600/80'
                                  : 'border border-line-strong'
                              }`}
                            />
                          ) : (
                            <NumericInput
                              ref={isLast ? lastQtyRef : undefined}
                              value={line.qtyRaw}
                              onChange={v => setForm(f => ({ ...f, budgetCart: f.budgetCart.map((l, i) => i === idx ? { ...l, qtyRaw: v } : l) }))}
                              placeholder="0"
                              className="w-full bg-panel border border-line-strong rounded px-2 py-1 text-xs text-ink text-right"
                            />
                          )}
                        </div>
                        <span className="text-[10px] text-muted shrink-0 w-6">{line.unit === 'kg' ? 'kg' : 'u'}</span>
                        {line.unit === 'kg' && (
                          <>
                            <div className="shrink-0 w-12">
                              <NumericInput
                                value={line.requestedUnitsRaw}
                                onChange={v => setForm(f => ({ ...f, budgetCart: f.budgetCart.map((l, i) => i === idx ? { ...l, requestedUnitsRaw: v } : l) }))}
                                placeholder=""
                                title="Unidades pedidas (opcional). Vacío = pidió kilos."
                                className="w-full bg-panel border border-line-strong rounded px-2 py-1 text-xs text-ink text-right"
                              />
                            </div>
                            <span className="text-[10px] text-muted shrink-0" title="Unidades pedidas">u</span>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, budgetCart: f.budgetCart.filter((_, i) => i !== idx) }))}
                          className="shrink-0 text-muted hover:text-danger text-sm"
                          title="Quitar"
                        >
                          ×
                        </button>
                      </div>
                      {missingWeight && (
                        <p className="text-[11px] text-orange-500/85 px-1">
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
                    ref={budgetSearchRef}
                    type="text"
                    value={budgetSearch}
                    onChange={e => setBudgetSearch(e.target.value)}
                    placeholder="Buscar producto…"
                    className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-line-accent"
                  />
                  {budgetSuggestions.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-panel border border-line-strong rounded-lg shadow-xl max-h-48 overflow-y-auto">
                      {budgetSuggestions.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setForm(f => ({
                              ...f,
                              budgetCart: [...f.budgetCart, {
                                productId: p.id,
                                name: p.name,
                                unit: p.unit as 'kg' | 'unit',
                                pluNumber: p.pluNumber ?? null,
                                estimatedQty: 1,
                                unitPrice: p.price ?? 0,
                                qtyRaw: '',
                                requestedUnitsRaw: '',
                              }],
                            }))
                            setBudgetSearch('')
                            setBudgetSuggestions([])
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-ink hover:bg-hover flex items-center gap-2"
                        >
                          <span className="truncate flex-1" title={p.name}>{p.name}</span>
                          <span className="text-muted shrink-0">{formatARS(p.price ?? 0)}/{p.unit === 'kg' ? 'kg' : 'u'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {liveEstimate > 0 && (
                  <div className="flex items-center justify-between pt-1 border-t border-line">
                    <span className="text-xs text-muted">Total estimado</span>
                    <span className="text-sm font-semibold text-ink tabular-nums">{formatARS(liveEstimate)}</span>
                  </div>
                )}
              </div>

              <Field label="Notas">
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Observaciones del pedido…"
                  rows={2}
                  maxLength={300}
                  className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-ink placeholder:text-muted focus:outline-none focus:border-line-accent resize-none"
                />
              </Field>

              <Field label="Fecha de retiro *">
                <input
                  type="date"
                  value={form.pickupDate}
                  min={todayDateStr()}
                  onChange={e => {
                    const pickupDate = e.target.value
                    setForm(f => {
                      const available = pickupSlotAvailability(hoursSourceForForm(), pickupDate)
                      const timeSlot = (f.timeSlot === 'afternoon' && !available.afternoon)
                        || (f.timeSlot === 'morning' && !available.morning)
                        ? ''
                        : f.timeSlot
                      return { ...f, pickupDate, timeSlot }
                    })
                  }}
                  className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-ink focus:outline-none focus:border-line-accent"
                />
              </Field>

              {/* Horario de retiro */}
              <div className="space-y-2">
                <label className="text-xs text-muted">Horario de retiro (opcional)</label>
                <div className={`grid gap-2 ${pickupSlotOptions.length === 3 ? 'grid-cols-3' : pickupSlotOptions.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {pickupSlotOptions.map(slot => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, timeSlot: f.timeSlot === slot ? '' : slot }))}
                      className={`py-2 rounded-lg text-xs font-medium transition-colors border ${
                        form.timeSlot === slot
                          ? 'bg-accent border-line-accent text-ink'
                          : 'bg-panel border-line text-ink hover:bg-hover'
                      }`}
                    >
                      {TIME_SLOT_LABELS[slot]}
                    </button>
                  ))}
                </div>
                {form.timeSlot === 'specific' && (
                  <>
                    <p className="text-xs text-amber-400/90 leading-snug">{PICKUP_SPECIFIC_HINT}</p>
                    <input
                      type="time"
                      value={form.pickupTime}
                      onChange={e => {
                        setFormError(null)
                        setForm(f => ({ ...f, pickupTime: e.target.value }))
                      }}
                      className={`w-full bg-panel border rounded-lg px-3 py-2 text-ink focus:outline-none ${
                        livePickupHoursError
                          ? 'border-red-500 focus:border-red-400'
                          : 'border-line focus:border-line-accent'
                      }`}
                    />
                    {livePickupHoursError && (
                      <p className="text-sm text-danger">{livePickupHoursError}</p>
                    )}
                  </>
                )}
              </div>

              {/* Seña multi-método */}
              <div className="space-y-3 bg-raised rounded-xl p-4 border border-line">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">Seña (opcional)</p>
                  {totalDeposit > 0 && (
                    <span className="text-sm font-semibold text-blue-300">{formatARS(totalDeposit)} total</span>
                  )}
                </div>
                <div className="space-y-2">
                  {(['cash', 'debit', 'wallet', 'credit'] as DepositMethod[]).map(m => (
                    <div key={m} className="flex items-center gap-2">
                      <span className="text-xs text-muted w-28 shrink-0">{DEPOSIT_METHOD_LABELS[m]}</span>
                      <NumericInput
                        value={getDepositRaw(m)}
                        onChange={v => setDepositForMethod(m, v)}
                        placeholder="0"
                        className="flex-1 bg-panel border border-line rounded-lg px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-line-accent"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {formError && <p className="text-danger text-sm">{formError}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={closeForm}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl border border-line text-ink hover:bg-hover transition-colors disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void handleSave()}
                  disabled={saving || !formIsValid}
                  className="flex-1 py-3 rounded-xl bg-accent hover:bg-accent font-semibold transition-colors disabled:opacity-40"
                >
                  {saving ? 'Guardando…' : editingOrder ? 'Guardar cambios' : 'Crear pedido'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cobro de pedido (resto − seña) */}
      {/* Modal de cobro por POS (nuevo flujo) */}
      {chargeModalOrder && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-overlay-fade">
          <div className="w-full sm:max-w-lg bg-panel rounded-t-2xl sm:rounded-2xl border border-line max-h-[92vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-line flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-ink">Cobrar pedido</h2>
                <p className="text-xs text-muted truncate" title={chargeModalOrder.customerName}>
                  {chargeModalOrder.customerName}
                  {chargeModalOrder.depositAmount > 0 && (
                    <> · Seña: <span className="text-blue-300 font-medium">{formatARS(chargeModalOrder.depositAmount)}</span></>
                  )}
                </p>
              </div>
              <button onClick={() => setChargeModalOrder(null)} className="text-muted hover:text-ink text-xl shrink-0 ml-2">×</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {chargeCartLines.length > 0 ? (
                <>
                  <p className="text-xs text-muted">Ingresá las cantidades reales. Podés quitar productos antes de cobrar.</p>
                  <div className="space-y-2">
                    {chargeCartLines.map((line, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-hover rounded-lg px-3 py-2">
                        <input
                          type="checkbox"
                          checked={line.checked}
                          onChange={e => setChargeCartLines(prev => prev.map((l, i) => i === idx ? { ...l, checked: e.target.checked } : l))}
                          className="shrink-0 accent-accent"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-ink truncate" title={line.name}>{line.name}</p>
                          <p className="text-[10px] text-muted">
                            {formatARS(line.unitPrice)} / {line.unit === 'kg' ? 'kg' : 'u'}
                            {line.requestedUnits != null && line.requestedUnits > 0 && (
                              <> · {line.requestedUnits} u</>
                            )}
                            {line.estimatedQty > 0 && line.unit === 'kg' && (
                              <> · est. {formatKgQty(line.estimatedQty)}</>
                            )}
                          </p>
                        </div>
                        <div className="shrink-0 w-24">
                          {line.unit === 'kg' ? (
                            <DecimalInput
                              value={line.qtyRaw}
                              onChange={v => setChargeCartLines(prev => prev.map((l, i) => i === idx ? { ...l, qtyRaw: v } : l))}
                              placeholder={line.estimatedQty > 0 ? formatKgQty(line.estimatedQty).replace(' kg', '') : ''}
                              maxDecimals={3}
                              weightMode
                              className="w-full bg-panel border border-line-strong rounded px-2 py-1 text-xs text-ink text-right"
                            />
                          ) : (
                            <NumericInput
                              value={line.qtyRaw}
                              onChange={v => setChargeCartLines(prev => prev.map((l, i) => i === idx ? { ...l, qtyRaw: v } : l))}
                              placeholder={String(Math.round(line.estimatedQty))}
                              className="w-full bg-panel border border-line-strong rounded px-2 py-1 text-xs text-ink text-right"
                            />
                          )}
                        </div>
                        <span className="text-[10px] text-muted shrink-0">{line.unit === 'kg' ? 'kg' : 'u'}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted">
                  Este pedido no tiene presupuesto cargado. Podés ir al POS y agregar los productos manualmente.
                  {!onInjectOrderCart && chargeModalOrder.depositAmount > 0 && (
                    <> La seña cubre el total — se marcará como entregado sin nueva venta.</>
                  )}
                </p>
              )}

              {chargeError && <p className="text-xs text-danger">{chargeError}</p>}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setChargeModalOrder(null)}
                  className="flex-1 py-2 rounded-xl border border-line text-ink text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCharge}
                  className="flex-1 py-2 rounded-xl bg-accent hover:bg-accent text-ink text-sm font-semibold"
                >
                  {onInjectOrderCart ? 'Confirmar' : 'Marcar entregado'}
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
              Pedido de <strong className="text-ink break-all">{confirmStatus.order.customerName}</strong>.
              {' '}Esta acción quedará registrada con tu usuario.
            </>
          }
          confirmLabel={confirmStatus.status === 'ready' ? 'Sí, marcar listo' : confirmStatus.status === 'delivered' ? 'Sí, marcar entregado' : 'Sí, revertir'}
          confirmClassName={confirmStatus.status === 'delivered' ? 'bg-accent hover:bg-accent' : confirmStatus.status === 'ready' ? 'bg-accent hover:bg-accent' : 'bg-amber-600 hover:bg-amber-700'}
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
              <p>
                El pedido de <strong className="text-ink break-all">{confirmCancel.customerName}</strong> pasará a estado cancelado.
                Esta acción quedará registrada con tu usuario.
              </p>
              {confirmCancel.depositAmount > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-amber-400 text-xs font-medium">
                    ⚠ Este pedido tenía una seña de <strong>${confirmCancel.depositAmount.toLocaleString('es-AR')}</strong>.
                  </p>
                  {currentShiftId ? (
                    <label className="flex items-start gap-2 cursor-pointer select-none bg-panel rounded-lg p-3">
                      <input
                        type="checkbox"
                        checked={registerRefund}
                        onChange={e => setRegisterRefund(e.target.checked)}
                        className="mt-0.5 shrink-0 accent-accent"
                      />
                      <span className="text-xs text-ink">
                        Registrar devolución de <strong className="text-ink">${confirmCancel.depositAmount.toLocaleString('es-AR')}</strong> como gasto de este turno
                      </span>
                    </label>
                  ) : (
                    <p className="text-xs text-muted bg-panel rounded-lg p-3">
                      No hay turno activo. Si se devuelve la seña, recordá registrarla manualmente como gasto en el próximo turno (categoría: <em>Devolución de seña</em>).
                    </p>
                  )}
                </div>
              )}
            </>
          }
          confirmLabel="Sí, cancelar pedido"
          confirmClassName="bg-danger hover:bg-danger"
          onConfirm={() => void executeCancelOrder(confirmCancel, registerRefund)}
          onCancel={() => setConfirmCancel(null)}
        />
      )}

      {/* Modal de confirmación de seña antes de guardar */}
      {showDepositConfirm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
          <div className="bg-panel rounded-2xl border border-line w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-semibold text-ink">
              {editingOrder ? 'Confirmar cambios en el pedido' : 'Confirmar pedido con seña'}
            </h2>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Cliente</span>
                <span className="text-ink font-medium truncate ml-4">{form.customerName.trim()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Retiro</span>
                <span className="text-ink">{formatYmd(form.pickupDate)}</span>
              </div>
              <div className="border-t border-line pt-2 space-y-1">
                <p className="text-xs text-muted font-semibold uppercase tracking-wider">Seña</p>
                {form.depositPayments.map(p => (
                  <div key={p.method} className="flex justify-between">
                    <span className="text-muted">{DEPOSIT_METHOD_LABELS[p.method]}</span>
                    <span className="text-blue-300 font-semibold">{formatARS(p.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-line pt-1">
                  <span className="text-ink font-semibold">Total seña</span>
                  <span className="text-blue-300 font-bold">{formatARS(depositTotal(form.depositPayments))}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDepositConfirm(false)}
                className="flex-1 py-2 rounded-xl border border-line text-ink hover:bg-hover transition-colors text-sm"
              >
                Volver
              </button>
              <button
                onClick={() => void doSave()}
                disabled={saving}
                className="flex-1 py-2 rounded-xl bg-accent hover:bg-accent font-semibold transition-colors text-ink text-sm disabled:opacity-40"
              >
                {saving ? 'Guardando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de eliminación permanente (solo admin) */}
      {confirmHardDelete && (
        <ConfirmModal
          title="¿Eliminar este pedido cancelado?"
          message={
            <>
              Se eliminará el registro completo del pedido de{' '}
              <strong className="text-ink break-all">{confirmHardDelete.customerName}</strong>.
              Esta acción <strong>no se puede deshacer</strong>.
            </>
          }
          confirmLabel="Sí, eliminar para siempre"
          confirmClassName="bg-danger hover:bg-danger"
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

function ProductQtyTable({ lines, showPrice = false }: { lines: BudgetCartLine[]; showPrice?: boolean }) {
  return (
    <table className="w-auto max-w-full border-collapse text-sm">
      <tbody>
        {lines.map((line, i) => {
          const hint = formatOrderQtyHint(line)
          return (
            <tr key={i}>
              <td
                className="border border-line px-2.5 py-1 text-ink max-w-[11rem] truncate"
                title={line.name}
              >
                {line.name}
              </td>
              <td className="border border-line px-2.5 py-1 text-right whitespace-nowrap">
                <span className="tabular-nums text-ink">{formatOrderQty(line)}</span>
                {hint && <span className="ml-1.5 text-[11px] text-muted">{hint}</span>}
              </td>
              {showPrice && (
                <td className="border border-line px-2.5 py-1 text-right text-muted tabular-nums whitespace-nowrap">
                  {formatARS(line.unitPrice)}/{line.unit === 'kg' ? 'kg' : 'u'}
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

interface OrderCardProps {
  order: OrderRow
  expanded: boolean
  onToggleExpanded: () => void
  isAdmin: boolean
  isNew?: boolean
  onRequestStatusChange: (order: OrderRow, status: OrderStatus) => void
  onCharge: (order: OrderRow) => void
  onEdit?: () => void
  onCancel?: () => void
  onHardDelete?: () => void
  hours?: StoreHoursSource | null
  sortCtx?: OrderSortContext
}

function OrderCard({ order, expanded, onToggleExpanded, isAdmin, isNew = false, onRequestStatusChange, onCharge, onEdit, onCancel, onHardDelete, hours, sortCtx }: OrderCardProps) {

  const today = isToday(order.pickupDate)
  const tomorrow = isTomorrow(order.pickupDate)
  const overdue = isOverdue(order.pickupDate, order.status)
  const dueSoon = isPickupDueSoon({
    pickupDate: order.pickupDate,
    pickupTime: order.pickupTime,
    todayYmd: sortCtx?.todayYmd ?? todayDateStr(),
    nowMinutes: sortCtx?.nowMinutes ?? clockMinutes(),
  })
  const dayHours = hours ? hoursForDate(hours, order.pickupDate) : null
  const outsideHours = isPickupOutsideHoursOnDate(order, hours)

  const depositPayments: DepositPayment[] = paymentsForOrder(order)

  const formattedDate = new Date(order.pickupDate + 'T00:00:00').toLocaleDateString('es-AR', {
    weekday: 'short', day: 'numeric', month: 'short',
  })

  function timeSlotLabel(): string | null {
    if (!order.timeSlot) return null
    if (order.timeSlot === 'specific' && order.pickupTime) {
      const check = dayHours ? checkPickupTime(order.pickupTime, dayHours) : null
      if (check?.window === 'morning') return `Turno mañana · ${order.pickupTime}`
      if (check?.window === 'afternoon') return `Turno tarde · ${order.pickupTime}`
      return order.pickupTime
    }
    return TIME_SLOT_LABELS[order.timeSlot]
  }

  const estimate = estimatedBudgetTotal(order.budgetItems ?? [])
  const productLines = order.budgetItems && order.budgetItems.length > 0 ? order.budgetItems : null

  return (
    <div
      id={`order-${order.id}`}
      className={`rounded-xl border transition-all duration-500 ${isNew ? 'ring-2 ring-accent shadow-[0_8px_24px_rgba(232,93,76,0.18)]' : ''} ${
        order.status === 'cancelled'
          ? 'border-line bg-raised opacity-60'
          : overdue
          ? 'border-danger/40 bg-danger/10'
          : today
          ? 'border-amber-900/50 bg-amber-950/20'
          : tomorrow
          ? 'border-line-strong bg-panel'
          : order.priority
          ? 'border-line-strong bg-panel'
          : 'border-line bg-panel'
      }`}
    >
      <div
        className="flex items-start gap-4 px-5 py-4 cursor-pointer"
        onClick={onToggleExpanded}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {order.priority && (
              <span className="text-xs text-muted" title="Prioritario">⚡</span>
            )}
            <span className="text-base font-semibold text-ink truncate" title={order.customerName}>
              {order.customerName}
            </span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_COLORS[order.status]}`}>
              {STATUS_LABELS[order.status]}
            </span>
            {overdue && order.status !== 'cancelled' && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-danger/10 text-danger border border-danger/30">Vencido</span>
            )}
            {!overdue && today && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-950/50 text-amber-400/70 border border-amber-900/40">Hoy</span>
            )}
            {!overdue && tomorrow && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-raised text-muted border border-line">Mañana</span>
            )}
            {dueSoon && (order.status === 'pending' || order.status === 'ready') && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-950/60 text-orange-300 border border-orange-900/40">Retiro próximo</span>
            )}
            {outsideHours && (order.status === 'pending' || order.status === 'ready') && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-danger/10 text-danger border border-danger/30" title="El horario de retiro ya no cae en la franja actual del local. Avisá al cliente.">Fuera de horario</span>
            )}
          </div>
          {productLines ? (
            <div className="mt-2">
              <ProductQtyTable lines={productLines} />
            </div>
          ) : (
            <p className="text-sm text-muted mt-1.5 truncate" title={order.items}>
              {order.items}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right w-36">
          <p className="text-sm text-ink">{formattedDate}</p>
          {timeSlotLabel() && <p className="text-xs text-muted mt-0.5">{timeSlotLabel()}</p>}
          {estimate > 0 && (
            <p className="text-sm font-semibold text-ink tabular-nums mt-2">{formatARS(estimate)}</p>
          )}
          {order.depositAmount > 0 && (
            <p className="text-xs text-blue-300/90 mt-0.5">{formatARS(order.depositAmount)} seña</p>
          )}
        </div>
        <span className="text-muted shrink-0 mt-1">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="px-5 pb-4 space-y-4 border-t border-line pt-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 min-w-0">
              {order.phone && (
                <p className="text-sm text-muted">Tel: <span className="text-ink">{order.phone}</span></p>
              )}
              {order.notes && (
                <p className="text-sm text-muted break-words">
                  Notas: <span className="text-ink">{order.notes}</span>
                </p>
              )}
              {order.createdBy && (
                <p className="text-xs text-muted">
                  Registrado por <span className="text-ink">{order.createdBy}</span>
                  {order.createdAt ? ` · ${toLocalDateTime(order.createdAt)}` : ''}
                </p>
              )}
              {order.readyByName && order.readyAt && (
                <p className="text-xs text-success">
                  Listo por <span className="font-medium">{order.readyByName}</span>
                  {' · '}{toLocalDateTime(order.readyAt)}
                </p>
              )}
              {order.status === 'delivered' && (order.updatedBy || order.updatedAt) && (
                <p className="text-xs text-success">
                  Cobrado por <span className="font-medium">{order.updatedBy ?? '—'}</span>
                  {order.updatedAt ? ` · ${toLocalDateTime(order.updatedAt)}` : ''}
                </p>
              )}
              {order.status !== 'delivered' && order.updatedBy && (
                <p className="text-xs text-subtle">
                  Última modificación: {order.updatedBy}
                </p>
              )}
            </div>
            <div className="space-y-2 min-w-0">
              {estimate > 0 && (
                <p className="text-sm text-ink">
                  Total estimado: <span className="font-semibold text-ink tabular-nums">{formatARS(estimate)}</span>
                </p>
              )}
              {depositPayments.length > 0 && (
                <div className="text-sm text-muted space-y-0.5">
                  <p className="font-medium text-ink">Seña: {formatARS(order.depositAmount)}</p>
                  {depositPayments.map(p => (
                    <p key={p.method}>{DEPOSIT_METHOD_LABELS[p.method]}: {formatARS(p.amount)}</p>
                  ))}
                </div>
              )}
            </div>
          </div>

          {productLines && (
            <ProductQtyTable lines={productLines} showPrice />
          )}

          {(order.status === 'pending' || order.status === 'ready') && (
            <div className="flex items-center gap-2 pt-1 border-t border-line" onClick={e => e.stopPropagation()}>
              {order.status === 'pending' && (
                <Button size="sm" variant="secondary" onClick={() => onRequestStatusChange(order, 'ready')}>
                  Listo
                </Button>
              )}
              <Button size="sm" onClick={() => onCharge(order)}>
                Cobrar
              </Button>
              <ActionMenu
                items={[
                  ...(order.status === 'ready'
                    ? [{ id: 'undo', label: 'Deshacer', onSelect: () => onRequestStatusChange(order, 'pending') }]
                    : []),
                  ...(onEdit ? [{ id: 'edit', label: 'Editar', onSelect: onEdit }] : []),
                  ...(onCancel ? [{ id: 'cancel', label: 'Cancelar pedido', danger: true, onSelect: onCancel }] : []),
                ]}
              />
            </div>
          )}
          {order.status === 'cancelled' && isAdmin && onHardDelete && (
            <div className="pt-1 border-t border-line" onClick={e => e.stopPropagation()}>
              <Button size="sm" variant="danger" onClick={onHardDelete} title="Eliminar permanentemente">
                Eliminar permanentemente
              </Button>
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
      <label className="text-xs text-muted">{label}</label>
      {children}
    </div>
  )
}
