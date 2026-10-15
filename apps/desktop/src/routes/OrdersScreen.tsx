/**
 * Pantalla de pedidos — cajera y admin.
 *
 * Cajera: ver lista, crear pedido, editar, cancelar, marcar listo/entregado.
 * Admin: igual + eliminación permanente.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import NumericInput from '../components/NumericInput'
import { ActionMenu, Button, CollapseReveal, ModalCloseButton, ModalLayer } from '../components/ui'
import { AdminSectionHeader } from '../components/AdminSectionHeader'
import DecimalInput from '../components/DecimalInput'
import OrderFormModal from '../components/OrderFormModal'
import { parseNumericInput, parseDecimalInput } from '../lib/numericInput'
import { addDaysYmd, formatARS, todayLocalYmd, toLocalDateTime } from '../lib/datetime'
import HistoryStoreSelect from '../components/HistoryStoreSelect'
import {
  DEPOSIT_METHOD_LABELS,
  TIME_SLOT_LABELS,
  estimatedBudgetTotal,
  paymentsForOrder,
  seedOrderCreateDraft,
  type BudgetCartDraft,
} from '../lib/orderCreateDraft'
import {
  formatKgQty,
  formatOrderQty,
  formatOrderQtyHint,
  checkPickupTime,
  clockMinutes,
  hoursForDate,
  isPickupDueSoon,
  isPickupOutsideHoursOnDate,
  storeHoursSourceFromRecord,
  type StoreHoursSource,
} from '@carniceria/shared'
import { buildOrdersView } from '../lib/orderListView'
import type { OrderSortContext } from '../lib/orderListSort'
import type {
  OrderRow, OrderStatus, DepositPayment,
  StoreRow, SaleItemDraft, BudgetCartLine,
} from '../types/hw-api'

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  ready: 'Listo',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'bg-accent-soft text-ink border-line',
  ready: 'bg-raised text-ink border-line',
  delivered: 'bg-accent-soft text-success border-line-accent',
  cancelled: 'bg-raised text-muted border-line',
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

function isOverdue(pickupDate: string, status: OrderStatus): boolean {
  return status === 'pending' && pickupDate < todayDateStr()
}

interface Props {
  isAdmin: boolean
  onBack: () => void
  /** ID del turno activo cuando se navega desde la caja; null si se viene desde admin hub */
  currentShiftId: string | null
  /** Local de la sesión (cajera o admin con local elegido). */
  sessionStoreId?: string
  /** Callback para inyectar el carrito del pedido en el POS (solo cuando hay turno activo) */
  onLogout?: () => void
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
    <ModalLayer onClose={onCancel} className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-panel rounded-2xl border border-line w-full max-w-sm p-6 space-y-4 overflow-hidden animate-modal-enter">
        <div className="flex items-start gap-2 min-w-0">
          <h2 className="min-w-0 flex-1 text-base font-semibold text-ink break-words">{title}</h2>
          <ModalCloseButton onClick={onCancel} />
        </div>
        <div className="text-sm text-muted break-words">{message}</div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2 rounded-xl border border-line text-ink hover:bg-hover transition-colors">
            Cancelar
          </button>
          <button onClick={onConfirm} className={`flex-1 rounded-xl py-2 font-semibold transition-colors ${confirmClassName}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalLayer>
  )
}

export default function OrdersScreen({ isAdmin, onBack, currentShiftId, sessionStoreId, onLogout, onInjectOrderCart }: Props) {
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

  // ID del pedido recién creado — para scroll y highlight
  const [newOrderId, setNewOrderId] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [editingOrder, setEditingOrder] = useState<OrderRow | null>(null)

  // Confirmaciones de estado y delete
  const [confirmStatus, setConfirmStatus] = useState<{ order: OrderRow; status: OrderStatus } | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<OrderRow | null>(null)
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

  const defaultStoreId = (storeIdFilter && storeIdFilter !== 'all')
    ? storeIdFilter
    : (availableStores[0]?.id ?? sessionStoreId ?? '')
  const hoursStoreId = sessionStoreId || ordersList[0]?.storeId || availableStores[0]?.id || ''

  function openCreate() {
    seedOrderCreateDraft(defaultStoreId)
    setEditingOrder(null)
    setShowCreate(true)
  }

  function openEdit(order: OrderRow) {
    setShowCreate(false)
    setEditingOrder(order)
  }

  function closeOrderForm() {
    setShowCreate(false)
    setEditingOrder(null)
  }

  function handleOrderSaved(saved: OrderRow, savedMode: 'create' | 'edit') {
    if (savedMode === 'create') {
      setOrdersList(prev => [saved, ...prev])
      setSearch('')
      setShowClosed(false)
      setNewOrderId(saved.id)
    } else {
      setOrdersList(prev => prev.map(order => order.id === saved.id ? saved : order))
    }
    closeOrderForm()
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
      <AdminSectionHeader
        title="Pedidos"
        subtitle={
          [urgentTodayCount > 0 ? `${urgentTodayCount} para hoy` : '', urgentTomorrowCount > 0 ? `${urgentTomorrowCount} para mañana` : '']
            .filter(Boolean)
            .join(' · ') || undefined
        }
        onBack={onBack}
        onLogout={onLogout}
        actions={
          <>
            {showStoreFilter && availableStores.length > 0 && (
              <div className="w-52 shrink-0">
                <HistoryStoreSelect
                  stores={availableStores}
                  value={storeIdFilter}
                  onChange={v => setStoreIdFilter(v)}
                />
              </div>
            )}
            <Button size="sm" onClick={openCreate}>+ Nuevo pedido</Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente, teléfono o producto (incluye entregados)"
            className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-line-accent focus:outline-none"
          />
          <div className="inline-flex shrink-0 rounded-lg border border-line-accent bg-accent-soft p-1" role="tablist" aria-label="Qué pedidos ver">
            <button
              type="button"
              role="tab"
              aria-selected={!showClosed}
              onClick={() => setShowClosed(false)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                !showClosed ? 'bg-accent text-accent-fg shadow-[0_1px_2px_rgba(28,28,30,0.18)]' : 'text-ink hover:bg-panel'
              }`}
            >
              Listos y pendientes
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={showClosed}
              onClick={() => setShowClosed(true)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                showClosed ? 'bg-accent text-accent-fg shadow-[0_1px_2px_rgba(28,28,30,0.18)]' : 'text-ink hover:bg-panel'
              }`}
            >
              Entregados y cancelados
            </button>
          </div>
        </div>
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

      {(showCreate || editingOrder) && (
        <OrderFormModal
          key={editingOrder?.id ?? 'create'}
          open
          mode={editingOrder ? 'edit' : 'create'}
          editingOrder={editingOrder}
          onClose={closeOrderForm}
          onSaved={handleOrderSaved}
          showStoreFilter={showStoreFilter}
          hoursStoreId={hoursStoreId}
          defaultStoreId={defaultStoreId}
          stores={availableStores}
        />
      )}

      {/* Cobro de pedido (resto − seña) */}
      {/* Modal de cobro por POS (nuevo flujo) */}
      {chargeModalOrder && (
        <ModalLayer onClose={() => setChargeModalOrder(null)} className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-overlay-fade">
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
              <ModalCloseButton onClick={() => setChargeModalOrder(null)} />
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
        </ModalLayer>
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
          confirmClassName="bg-accent text-accent-fg hover:bg-accent"
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
          confirmClassName="bg-danger text-accent-fg hover:bg-danger"
          onConfirm={() => void executeCancelOrder(confirmCancel, registerRefund)}
          onCancel={() => setConfirmCancel(null)}
        />
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
          confirmClassName="bg-danger text-accent-fg hover:bg-danger"
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

function productSummary(lines: BudgetCartLine[]): string {
  return lines.map(line => {
    const hint = formatOrderQtyHint(line)
    const qty = hint ? `${formatOrderQty(line)} ${hint}` : formatOrderQty(line)
    return `${line.name} ${qty}`
  }).join(' · ')
}

function ProductDetailList({ lines }: { lines: BudgetCartLine[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {lines.map((line, i) => {
        const hint = formatOrderQtyHint(line)
        const qty = hint ? `${formatOrderQty(line)} ${hint}` : formatOrderQty(line)
        const price = `${formatARS(line.unitPrice)}/${line.unit === 'kg' ? 'kg' : 'u'}`
        return (
          <li key={i} className="flex min-w-0 max-w-full items-baseline gap-2 rounded-lg bg-app px-3 py-1.5">
            <span className="min-w-0 max-w-[18rem] truncate text-sm text-ink" title={line.name}>{line.name}</span>
            <span className="shrink-0 text-sm tabular-nums text-ink" title={qty}>{qty}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted" title={price}>{price}</span>
          </li>
        )
      })}
    </ul>
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

  const surface = order.status === 'cancelled'
    ? 'border-line bg-panel opacity-60'
    : overdue
      ? 'border-line-strong bg-panel'
      : today || order.priority
        ? 'border-line-strong bg-panel'
        : 'border-line bg-panel'

  return (
    <div
      id={`order-${order.id}`}
      className={`rounded-xl border ${surface} ${isNew ? 'ring-2 ring-accent shadow-[0_8px_24px_rgba(232,93,76,0.18)]' : ''}`}
    >
      <div
        className={`flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-hover ${expanded ? 'rounded-t-xl' : 'rounded-xl'}`}
        onClick={onToggleExpanded}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {order.priority && (
              <span className="text-xs text-muted" title="Prioritario">⚡</span>
            )}
            <span className="min-w-0 max-w-[18rem] truncate text-base font-semibold text-ink" title={order.customerName}>
              {order.customerName}
            </span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_COLORS[order.status]}`}>
              {STATUS_LABELS[order.status]}
            </span>
            {overdue && order.status !== 'cancelled' && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-raised text-danger border border-line-strong">Vencido</span>
            )}
            {!overdue && today && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-raised text-ink border border-line-strong">Hoy</span>
            )}
            {!overdue && tomorrow && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-app text-muted border border-line">Mañana</span>
            )}
            {dueSoon && (order.status === 'pending' || order.status === 'ready') && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-raised text-ink border border-line">Retiro próximo</span>
            )}
            {outsideHours && (order.status === 'pending' || order.status === 'ready') && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-raised text-danger border border-line-strong" title="El horario de retiro ya no cae en la franja actual del local. Avisá al cliente.">Fuera de horario</span>
            )}
            <span className="text-sm text-ink">{formattedDate}</span>
            {timeSlotLabel() && <span className="text-xs text-muted">{timeSlotLabel()}</span>}
            {estimate > 0 && (
              <span className="text-sm font-semibold tabular-nums text-ink">{formatARS(estimate)}</span>
            )}
            {!expanded && order.depositAmount > 0 && (
              <span className="text-xs text-blue-300/90">{formatARS(order.depositAmount)} seña</span>
            )}
          </div>
          {!expanded && (
            <p
              className="mt-1.5 truncate text-sm text-muted"
              title={productLines ? productSummary(productLines) : order.items}
            >
              {productLines ? productSummary(productLines) : order.items}
            </p>
          )}
        </div>
        <svg className={`mt-1 h-4 w-4 shrink-0 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <CollapseReveal open={expanded}>
        <div className="space-y-3 border-t border-line px-4 py-3">
          {(order.phone || depositPayments.length > 0) && (
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            {order.phone && (
              <p className="text-sm text-muted">Tel <span className="text-ink">{order.phone}</span></p>
            )}
            {depositPayments.length > 0 && (
              <p className="text-sm text-muted">
                Seña <span className="font-medium tabular-nums text-ink">{formatARS(order.depositAmount)}</span>
                {depositPayments.map(p => (
                  <span key={p.method}>
                    {' · '}{DEPOSIT_METHOD_LABELS[p.method]}{' '}
                    <span className="tabular-nums text-ink">{formatARS(p.amount)}</span>
                  </span>
                ))}
              </p>
            )}
          </div>
          )}
          {order.notes && (
            <p className="max-w-prose text-sm text-muted break-words">
              Notas <span className="text-ink">{order.notes}</span>
            </p>
          )}
          {(order.createdBy || order.readyByName || order.updatedBy) && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
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
          )}

          {productLines ? (
            <ProductDetailList lines={productLines} />
          ) : order.items ? (
            <p className="text-sm text-muted" title={order.items}>{order.items}</p>
          ) : null}

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
      </CollapseReveal>
    </div>
  )
}
