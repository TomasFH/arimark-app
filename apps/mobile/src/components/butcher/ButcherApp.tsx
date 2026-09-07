/**
 * Shell móvil del carnicero.
 *
 * - Selector de local: hay que confirmar al abrir el proceso (si hay más de
 *   un local). El último se preselecciona. Si la app estuvo en segundo plano
 *   ≥ 2 h o cambió el día, vuelve a preguntar.
 * - Tab "Pedidos": pendientes (trabajo), listos y entregados recientes (auditoría).
 *   "Listo" pide confirmación; después hay un aviso para deshacer.
 * - Tab "Mi semana": sueldo + vales de la semana en curso (sin historial).
 *
 * No hay creación, edición ni cobro de pedidos.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  subscribeButcherOrders,
  subscribeButcherReadyOrders,
  subscribeButcherDeliveredOrders,
  markOrderReady,
  unmarkOrderReady,
  groupOrdersByDayAndShift,
  deliveredPickupFrom,
  formatPickupDayHeading,
  formatPickupDayChip,
  type ButcherOrder,
  type DayGroup,
  type BudgetLine,
} from '../../lib/butcherOrders'
import {
  fetchButcherEmployee,
  subscribeButcherVales,
  subscribeButcherPayment,
} from '../../lib/butcherPayroll'
import { buildWeeklyPayroll, type PayrollVale, type PayrollPayment, type PayrollEmployee } from '../../lib/payroll'
import { isOnline, useOnlineStatus } from '../../lib/connectivity'
import {
  loadAuthorizedStoreOptions,
  peekAuthorizedStoreOptions,
  type CashierStoreOption,
} from '../../lib/cashierStores'
import {
  readPersistedStore,
  writePersistedStore,
  clearPersistedStore,
  markStoreSessionConfirmed,
  clearStoreSessionConfirmed,
  shouldReconfirmStore,
  initialButcherStore,
  displayStoreName,
} from '../../lib/butcherStoreSession'
import {
  weekStartMondayLocalYmd,
  addDaysYmd,
  todayLocalYmd,
  formatYmd,
} from '../../lib/week'
import {
  formatPickupSlotLine,
  formatDepositPaymentsLine,
} from '../../lib/orderMapping'
import { useBackLayer } from '../../lib/backStack'
import type { LocalProfile } from '../../types/pos'
import { formatOrderQty, formatOrderQtyHint, clockMinutes, isPickupOutsideHoursOnDate } from '@carniceria/shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'orders' | 'week'
type OrdersListKind = 'pending' | 'ready' | 'delivered'

const READY_TOAST_MS = 7000

interface ReadyToast {
  orderId: string
  customerName: string
  shownAt: number
}

interface ConfirmReady {
  kind: 'ready' | 'undo'
  order: ButcherOrder
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ButcherAppProps {
  profile: LocalProfile
  onLogout: () => void
}

export function ButcherApp({ profile, onLogout }: ButcherAppProps) {
  const online = useOnlineStatus()

  const authorizedIds = profile.authorizedStores.filter(id => id.trim().length > 0)
  const authorizedKey = authorizedIds.join('\u0001')

  const [storeOptions, setStoreOptions] = useState<CashierStoreOption[]>(() =>
    peekAuthorizedStoreOptions(authorizedIds),
  )
  const [storesLoading, setStoresLoading] = useState(
    () => peekAuthorizedStoreOptions(authorizedIds).length === 0,
  )
  const [storesError, setStoresError] = useState<string | null>(null)

  const reloadStores = useCallback(() => {
    const ids = authorizedKey.split('\u0001').filter(Boolean)
    setStoresError(null)
    setStoresLoading(peekAuthorizedStoreOptions(ids).length === 0)
    return loadAuthorizedStoreOptions(ids)
      .then(opts => {
        setStoreOptions(opts)
        setStoresError(opts.length === 0
          ? 'No hay locales asignados a tu cuenta. Contactá al administrador.'
          : null)
      })
      .catch(() => {
        setStoreOptions(prev => (prev.length > 0 ? prev : []))
        setStoresError('No se pudieron cargar los locales.')
      })
      .finally(() => setStoresLoading(false))
  }, [authorizedKey])

  useEffect(() => {
    void reloadStores()
  }, [reloadStores])

  const [storeId, setStoreId] = useState(() =>
    initialButcherStore({
      authorizedStores: authorizedIds,
      persistedId: readPersistedStore(),
      todayYmd: todayLocalYmd(),
    }).storeId,
  )
  const [showStorePicker, setShowStorePicker] = useState(() =>
    initialButcherStore({
      authorizedStores: authorizedIds,
      persistedId: readPersistedStore(),
      todayYmd: todayLocalYmd(),
    }).showPicker,
  )
  const [pickerRequired, setPickerRequired] = useState(() =>
    initialButcherStore({
      authorizedStores: authorizedIds,
      persistedId: readPersistedStore(),
      todayYmd: todayLocalYmd(),
    }).showPicker,
  )

  const [tab, setTab] = useState<Tab>('orders')
  const [ordersListKind, setOrdersListKind] = useState<OrdersListKind>('pending')

  // Orders state
  const [orders, setOrders] = useState<ButcherOrder[]>([])
  const [readyOrders, setReadyOrders] = useState<ButcherOrder[]>([])
  const [deliveredOrders, setDeliveredOrders] = useState<ButcherOrder[]>([])
  const [ordersError, setOrdersError] = useState<string | null>(null)
  const [deliveredError, setDeliveredError] = useState<string | null>(null)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [markError, setMarkError] = useState<string | null>(null)
  const [readyToast, setReadyToast] = useState<ReadyToast | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [confirmReady, setConfirmReady] = useState<ConfirmReady | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Payroll state
  const employeeId = profile.employeeId ?? null
  const [employee, setEmployee] = useState<PayrollEmployee | null>(null)
  const [vales, setVales] = useState<PayrollVale[]>([])
  const [payment, setPayment] = useState<PayrollPayment | null>(null)
  const [payrollError, setPayrollError] = useState<string | null>(null)

  const today = todayLocalYmd()
  const weekStart = weekStartMondayLocalYmd(today)
  const weekEnd = addDaysYmd(weekStart, 6)

  // ---------------------------------------------------------------------------
  // Orders subscription
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!storeId) return undefined
    setOrdersError(null)
    const unsubPending = subscribeButcherOrders(
      storeId,
      data => setOrders(data),
      msg => setOrdersError(msg),
    )
    const unsubReady = subscribeButcherReadyOrders(
      storeId,
      data => setReadyOrders(data),
      msg => setOrdersError(msg),
    )
    return () => {
      unsubPending()
      unsubReady()
    }
  }, [storeId])

  const deliveredFrom = deliveredPickupFrom(today)

  useEffect(() => {
    if (!storeId || tab !== 'orders' || ordersListKind !== 'delivered') return undefined
    setDeliveredError(null)
    const unsub = subscribeButcherDeliveredOrders(
      storeId,
      deliveredFrom,
      data => {
        setDeliveredOrders(data)
        setDeliveredError(null)
      },
      msg => setDeliveredError(msg),
    )
    return unsub
  }, [storeId, tab, ordersListKind, deliveredFrom])

  // ---------------------------------------------------------------------------
  // Payroll subscription (only when on "week" tab and employeeId is set)
  // ---------------------------------------------------------------------------

  const payrollLoaded = useRef(false)

  useEffect(() => {
    if (tab !== 'week' || !employeeId) return undefined

    // Fetch employee profile once
    if (!payrollLoaded.current) {
      fetchButcherEmployee(employeeId)
        .then(emp => setEmployee(emp))
        .catch(err => setPayrollError((err as Error).message))
      payrollLoaded.current = true
    }

    const unsubVales = subscribeButcherVales(
      employeeId,
      weekStart,
      weekEnd,
      data => {
        setVales(data)
        setPayrollError(null)
      },
      msg => setPayrollError(msg),
    )
    const unsubPayment = subscribeButcherPayment(
      employeeId,
      weekStart,
      data => {
        setPayment(data)
        setPayrollError(null)
      },
      msg => setPayrollError(msg),
    )
    return () => {
      unsubVales()
      unsubPayment()
    }
  }, [tab, employeeId, weekStart, weekEnd])

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function requestStoreConfirm() {
    setPickerRequired(true)
    setStoreId('')
    setOrders([])
    setReadyOrders([])
    setDeliveredOrders([])
    setOrdersError(null)
    setShowStorePicker(true)
  }

  function handleStoreSelect(id: string) {
    setStoreId(id)
    writePersistedStore(id)
    markStoreSessionConfirmed(todayLocalYmd())
    setPickerRequired(false)
    setShowStorePicker(false)
    setOrders([])
    setReadyOrders([])
    setDeliveredOrders([])
    setOrdersError(null)
    setOrdersListKind('pending')
  }

  function handleOpenStorePicker() {
    setPickerRequired(false)
    setShowStorePicker(true)
  }

  function askMarkReady(order: ButcherOrder) {
    setMarkError(null)
    setConfirmReady({ kind: 'ready', order })
  }

  function askUndoFromList(order: ButcherOrder) {
    setMarkError(null)
    setConfirmReady({ kind: 'undo', order })
  }

  async function handleMarkReady(order: ButcherOrder) {
    setMarkError(null)
    const connected = await isOnline()
    if (!connected) {
      setMarkError('Sin conexión: no se puede marcar Listo.')
      return
    }
    setMarkingId(order.id)
    try {
      await markOrderReady(order.id, profile.uid, profile.displayName)
      if (toastTimer.current) clearTimeout(toastTimer.current)
      setReadyToast({
        orderId: order.id,
        customerName: order.customerName.trim() || 'Pedido',
        shownAt: Date.now(),
      })
      toastTimer.current = setTimeout(() => setReadyToast(null), READY_TOAST_MS)
    } catch (err) {
      setMarkError((err as Error).message || 'No se pudo marcar como Listo.')
    } finally {
      setMarkingId(null)
    }
  }

  function dismissReadyToast() {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current)
      toastTimer.current = null
    }
    setReadyToast(null)
  }

  async function revertReady(orderId: string) {
    const connected = await isOnline()
    if (!connected) {
      setMarkError('Sin conexión: no se puede deshacer.')
      return
    }
    setUndoing(true)
    setMarkError(null)
    try {
      await unmarkOrderReady(orderId, profile.uid)
      dismissReadyToast()
    } catch (err) {
      setMarkError((err as Error).message || 'No se pudo deshacer.')
    } finally {
      setUndoing(false)
    }
  }

  async function handleUndoReady() {
    if (!readyToast || undoing) return
    await revertReady(readyToast.orderId)
  }

  async function executeConfirmReady() {
    if (!confirmReady) return
    const action = confirmReady
    setConfirmReady(null)
    if (action.kind === 'ready') {
      await handleMarkReady(action.order)
      return
    }
    await revertReady(action.order.id)
  }

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  function handleLogout() {
    clearPersistedStore()
    clearStoreSessionConfirmed()
    onLogout()
  }

  useEffect(() => {
    if (authorizedIds.length <= 1) return undefined
    let lastHiddenAt: number | null = null

    function onHidden(): void {
      lastHiddenAt = Date.now()
    }

    function onVisible(): void {
      if (lastHiddenAt == null) return
      const hiddenForMs = Date.now() - lastHiddenAt
      lastHiddenAt = null
      if (shouldReconfirmStore({
        authorizedCount: authorizedIds.length,
        todayYmd: todayLocalYmd(),
        hiddenForMs,
      })) {
        requestStoreConfirm()
      }
    }

    function onVisibility(): void {
      if (document.visibilityState === 'hidden') onHidden()
      else onVisible()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onHidden)
    window.addEventListener('pageshow', onVisible)

    let removeCap: (() => void) | undefined
    void import('@capacitor/app').then(({ App }) => {
      void App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) onVisible()
        else onHidden()
      }).then(handle => {
        removeCap = () => { void handle.remove() }
      })
    }).catch(() => { /* web sin Capacitor */ })

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHidden)
      window.removeEventListener('pageshow', onVisible)
      removeCap?.()
    }
  }, [authorizedIds.length])

  // ---------------------------------------------------------------------------
  // Store picker modal
  // ---------------------------------------------------------------------------

  if (showStorePicker) {
    const lastStoreId = storeId || readPersistedStore() || ''
    return (
      <StorePicker
        stores={storeOptions}
        loading={storesLoading}
        error={storesError}
        currentStoreId={lastStoreId}
        onSelect={handleStoreSelect}
        onRetry={() => { void reloadStores() }}
        onCancel={pickerRequired ? null : () => setShowStorePicker(false)}
        onLogout={handleLogout}
      />
    )
  }

  // ---------------------------------------------------------------------------
  // Grouped orders
  // ---------------------------------------------------------------------------

  const visibleOrders =
    ordersListKind === 'pending' ? orders
    : ordersListKind === 'ready' ? readyOrders
    : deliveredOrders
  const storeHours = storeOptions.find(s => s.id === storeId) ?? null
  const dayGroups = groupOrdersByDayAndShift(visibleOrders, today, {
    hours: storeHours,
    nowMinutes: clockMinutes(),
    pinDueSoon: ordersListKind === 'pending',
  })

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const storeName = displayStoreName(
    storeOptions.find(s => s.id === storeId),
    storesLoading,
  )

  return (
    <div className="relative flex flex-col h-full min-h-0 bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-zinc-400 truncate">Carnicero · {profile.displayName}</p>
          <button
            type="button"
            onClick={handleOpenStorePicker}
            className="text-base font-bold text-amber-400 truncate max-w-full text-left"
            title={`Local: ${storeName}`}
          >
            {storeName} ▾
          </button>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300 ml-3 px-2 py-1"
        >
          Salir
        </button>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 shrink-0">
        {(['orders', 'week'] as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-semibold transition-colors ${
              tab === t
                ? 'text-amber-400 border-b-2 border-amber-400'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t === 'orders' ? 'Pedidos' : 'Mi semana'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'orders' && (
          <OrdersView
            listKind={ordersListKind}
            onListKind={setOrdersListKind}
            pendingCount={orders.length}
            readyCount={readyOrders.length}
            dayGroups={dayGroups}
            storeHours={storeHours}
            storeId={storeId}
            online={online}
            ordersError={ordersListKind === 'delivered' ? deliveredError : ordersError}
            markingId={markingId}
            undoing={undoing}
            markError={markError}
            onMarkReady={askMarkReady}
            onUndoReady={askUndoFromList}
            onDismissMarkError={() => setMarkError(null)}
          />
        )}
        {tab === 'week' && (
          <WeekView
            employee={employee}
            vales={vales}
            payment={payment}
            weekStart={weekStart}
            weekEnd={weekEnd}
            employeeId={employeeId}
            error={payrollError}
          />
        )}
      </div>

      {confirmReady && (
        <ButcherConfirmModal
          title={confirmReady.kind === 'ready' ? '¿Marcar como listo?' : '¿Devolver a pendientes?'}
          customerName={confirmReady.order.customerName.trim() || 'Pedido'}
          confirmLabel={confirmReady.kind === 'ready' ? 'Sí, marcar listo' : 'Sí, devolver'}
          onConfirm={() => { void executeConfirmReady() }}
          onClose={() => setConfirmReady(null)}
        />
      )}

      {readyToast && (
        <ReadyUndoToast
          key={readyToast.shownAt}
          customerName={readyToast.customerName}
          undoing={undoing}
          onUndo={() => { void handleUndoReady() }}
          onDismiss={dismissReadyToast}
        />
      )}
    </div>
  )
}

function friendlyFirestoreError(raw: string, fallback: string): string {
  if (/requires an index/i.test(raw) || /failed-precondition/i.test(raw)) {
    return fallback
  }
  return raw
}

function ReadyUndoToast({
  customerName,
  undoing,
  onUndo,
  onDismiss,
}: {
  customerName: string
  undoing: boolean
  onUndo: () => void
  onDismiss: () => void
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-50 flex justify-end p-3"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-xl border border-zinc-600 bg-zinc-800 shadow-lg shadow-black/40">
        <div className="h-0.5 w-full bg-zinc-700">
          <div className="toast-progress h-full bg-amber-400" />
        </div>
        <div className="flex items-stretch">
          <div className="min-w-0 flex-1 px-3 py-2">
            <p className="flex min-w-0 items-baseline gap-1 text-xs text-zinc-200">
              <span className="shrink-0">Listo ·</span>
              <span className="min-w-0 truncate font-medium text-white" title={customerName}>
                {customerName}
              </span>
            </p>
            <button
              type="button"
              disabled={undoing}
              onClick={onUndo}
              className="mt-1 text-xs font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-50"
            >
              {undoing ? '…' : 'Deshacer'}
            </button>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="flex w-12 shrink-0 items-center justify-center border-l border-zinc-600 text-2xl leading-none text-zinc-400 hover:bg-zinc-700 hover:text-white"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}

function ButcherConfirmModal({
  title,
  customerName,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string
  customerName: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}) {
  useBackLayer(true, onClose)
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-600 bg-zinc-900 p-4 shadow-xl">
        <h2 className="text-base font-bold text-white">{title}</h2>
        <p className="mt-2 text-sm text-zinc-300">
          Pedido de{' '}
          <span className="inline-block max-w-full truncate align-bottom font-semibold text-white" title={customerName}>
            {customerName}
          </span>
          . Esta acción queda registrada con tu usuario.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-zinc-800 py-2.5 text-sm font-semibold text-zinc-200"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-green-600 py-2.5 text-sm font-bold text-white hover:bg-green-500"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// StorePicker
// ---------------------------------------------------------------------------

function StorePicker({
  stores,
  loading,
  error,
  currentStoreId,
  onSelect,
  onRetry,
  onCancel,
  onLogout,
}: {
  stores: CashierStoreOption[]
  loading: boolean
  error: string | null
  currentStoreId: string
  onSelect: (id: string) => void
  onRetry: () => void
  onCancel: (() => void) | null
  onLogout: () => void
}) {
  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-950 text-white">
      <header className="flex items-center justify-between px-4 py-4 border-b border-zinc-800 shrink-0">
        <div className="min-w-0 flex-1 mr-3">
          <h1 className="text-lg font-bold">¿En qué local estás?</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Si es el de siempre, tocá el mismo.</p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1"
        >
          Salir
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {loading && stores.length === 0 && (
          <p className="text-zinc-500 text-sm text-center mt-8">Cargando locales…</p>
        )}
        {error && stores.length === 0 && !loading && (
          <div className="text-center mt-8 space-y-3">
            <p className="text-zinc-400 text-sm">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="text-sm text-amber-400 hover:text-amber-300"
            >
              Reintentar
            </button>
          </div>
        )}
        {stores.map(store => (
          <button
            key={store.id}
            type="button"
            onClick={() => onSelect(store.id)}
            className={`w-full rounded-xl px-5 py-4 text-left font-semibold border transition-colors min-w-0 ${
              store.id === currentStoreId
                ? 'bg-amber-500 text-black border-amber-400'
                : 'bg-zinc-800 text-white border-zinc-700 hover:bg-zinc-700'
            }`}
          >
            <span className="block truncate" title={store.name}>{store.name}</span>
          </button>
        ))}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-xl px-5 py-3 text-zinc-400 text-sm border border-zinc-700 hover:bg-zinc-800"
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// OrdersView
// ---------------------------------------------------------------------------

const SLOT_LABELS: Record<string, string> = {
  dueSoon: 'Retiro próximo',
  morning: 'Turno mañana',
  afternoon: 'Turno tarde',
  specific: 'Horario específico',
  noSlot: 'Sin turno',
}

function emptyListMessage(kind: OrdersListKind): string {
  if (kind === 'ready') return 'No hay pedidos listos en este local.'
  if (kind === 'delivered') return 'No hay entregados en los últimos 7 días.'
  return 'No hay pedidos pendientes en este local.'
}

function formatDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function OrdersView({
  listKind,
  onListKind,
  pendingCount,
  readyCount,
  dayGroups,
  storeHours,
  storeId,
  online,
  ordersError,
  markingId,
  undoing,
  markError,
  onMarkReady,
  onUndoReady,
  onDismissMarkError,
}: {
  listKind: OrdersListKind
  onListKind: (k: OrdersListKind) => void
  pendingCount: number
  readyCount: number
  dayGroups: DayGroup[]
  storeHours: CashierStoreOption | null
  storeId: string
  online: boolean
  ordersError: string | null
  markingId: string | null
  undoing: boolean
  markError: string | null
  onMarkReady: (order: ButcherOrder) => void
  onUndoReady: (order: ButcherOrder) => void
  onDismissMarkError: () => void
}) {
  if (!storeId) {
    return (
      <div className="p-6 text-center text-zinc-500 text-sm mt-8">
        Seleccioná un local para ver los pedidos.
      </div>
    )
  }

  const today = todayLocalYmd()
  const tabs: { id: OrdersListKind; label: string }[] = [
    { id: 'pending', label: `Pendientes (${pendingCount})` },
    { id: 'ready', label: `Listos (${readyCount})` },
    { id: 'delivered', label: 'Entregados' },
  ]

  return (
    <div className="p-3 space-y-4">
      <div className="flex gap-1 rounded-xl bg-zinc-900 p-1 border border-zinc-800">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => onListKind(t.id)}
            className={`min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${
              listKind === t.id
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title={t.label}
          >
            {t.label}
          </button>
        ))}
      </div>

      {markError && (
        <div className="bg-red-900/60 border border-red-700 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-red-300 text-sm min-w-0 flex-1">{markError}</span>
          <button
            type="button"
            onClick={onDismissMarkError}
            className="shrink-0 text-zinc-500 hover:text-zinc-300 text-lg leading-none"
          >
            ×
          </button>
        </div>
      )}

      {ordersError && (
        <p className="text-red-400 text-sm text-center px-2">
          {friendlyFirestoreError(ordersError, 'No se pudieron cargar los pedidos. Reintentá en unos minutos.')}
        </p>
      )}

      {!ordersError && dayGroups.length === 0 && (
        <div className="text-center text-zinc-500 text-sm mt-12">
          {emptyListMessage(listKind)}
        </div>
      )}

      {!ordersError && dayGroups.map(day => {
        const isToday = day.date === today
        const isFuture = day.date > today
        const workList = listKind !== 'delivered'
        return (
        <section
          key={day.date}
          className={`rounded-2xl border px-3 pt-3 pb-1 ${
            !workList
              ? 'border-zinc-800 bg-zinc-900/40'
              : isToday
                ? 'border-zinc-700 bg-zinc-900/40'
                : isFuture
                  ? 'border-sky-800/80 bg-sky-950/25'
                  : 'border-red-900/50 bg-red-950/20'
          }`}
        >
          <h2
            className={`text-sm font-bold tracking-wide mb-3 px-1 ${
              !workList
                ? 'text-zinc-300'
                : isToday
                  ? 'text-zinc-100'
                  : isFuture
                    ? 'text-sky-300'
                    : 'text-red-300'
            }`}
          >
            {formatPickupDayHeading(day.date, today, listKind === 'delivered' ? 'history' : 'work')}
          </h2>
          {day.groups.map(group => (
            <div key={group.slot} className="mb-3">
              {group.slot !== 'noSlot' && (
                <p className="text-xs text-amber-500 font-medium mb-1 px-1">
                  {SLOT_LABELS[group.slot] ?? group.slot}
                </p>
              )}
              <div className="space-y-2">
                {group.orders.map(order => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    hours={storeHours}
                    todayYmd={today}
                    online={online}
                    marking={markingId === order.id}
                    undoing={undoing && listKind === 'ready'}
                    onMarkReady={onMarkReady}
                    onUndoReady={onUndoReady}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// OrderCard
// ---------------------------------------------------------------------------

function OrderCard({
  order,
  hours,
  todayYmd,
  online,
  marking,
  undoing,
  onMarkReady,
  onUndoReady,
}: {
  order: ButcherOrder
  hours: CashierStoreOption | null
  todayYmd: string
  online: boolean
  marking: boolean
  undoing: boolean
  onMarkReady: (order: ButcherOrder) => void
  onUndoReady: (order: ButcherOrder) => void
}) {
  const slotLine = formatPickupSlotLine(order.timeSlot ?? null, order.pickupTime ?? undefined, hours, order.pickupDate)
  const outsideHours = isPickupOutsideHoursOnDate(order, hours)
  const dayChip = formatPickupDayChip(order.pickupDate, todayYmd)
  const otherDay = order.pickupDate !== todayYmd
  const futureDay = order.pickupDate > todayYmd
  const depositLine = formatDepositPaymentsLine(order.depositPayments, {
    fallbackAmount: order.depositAmount,
    formatAmount: (n: number) => `$${n.toLocaleString('es-AR')}`,
  })
  const readyWhen = formatDateTime(order.readyAt)
  const readyLine = order.readyByName
    ? `Listo por ${order.readyByName}${readyWhen ? ` · ${readyWhen}` : ''}`
    : readyWhen ? `Listo · ${readyWhen}` : null
  const deliveredWhen = formatDateTime(order.deliveredAt)
  const deliveredLine = order.status === 'delivered'
    ? (order.deliveredByName
      ? `Entregado por ${order.deliveredByName}${deliveredWhen ? ` · ${deliveredWhen}` : ''}`
      : deliveredWhen ? `Entregado · ${deliveredWhen}` : 'Entregado')
    : null

  return (
    <div className={`rounded-xl border p-4 space-y-2 ${
      order.priority
        ? 'border-amber-600 bg-amber-950/40'
        : otherDay && order.status === 'pending' && futureDay
          ? 'border-sky-700/80 border-l-4 border-l-sky-400 bg-sky-950/30'
          : otherDay && order.status === 'pending'
            ? 'border-red-900/60 border-l-4 border-l-red-400 bg-red-950/25'
            : 'border-zinc-700 bg-zinc-800/60'
    }`}>
      {dayChip && (
        <p className={`text-xs font-bold ${futureDay ? 'text-sky-300' : 'text-red-300'}`}>
          {dayChip}
        </p>
      )}
      <div className="flex items-start gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white truncate" title={order.customerName}>
            {order.customerName}
          </p>
          {order.phone && (
            <p className="text-xs text-zinc-400 truncate">{order.phone}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {order.status === 'delivered' && (
            <span className="text-xs bg-emerald-900/80 text-emerald-300 font-semibold px-2 py-0.5 rounded-full">
              Entregado
            </span>
          )}
          {order.status === 'ready' && (
            <span className="text-xs bg-green-800/80 text-green-200 font-semibold px-2 py-0.5 rounded-full">
              Listo
            </span>
          )}
          {order.priority && (
            <span className="text-xs bg-amber-500 text-black font-bold px-2 py-0.5 rounded-full">
              Prioridad
            </span>
          )}
          {outsideHours && (
            <span className="text-xs bg-red-950/80 text-red-300 font-semibold px-2 py-0.5 rounded-full">
              Fuera de horario
            </span>
          )}
        </div>
      </div>

      {order.budgetItems && order.budgetItems.length > 0 ? (
        <BudgetItemsList items={order.budgetItems} />
      ) : (
        <p className="text-sm text-zinc-300 whitespace-pre-wrap">{order.items}</p>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-400">
        {slotLine && <span>{slotLine}</span>}
        {depositLine && <span>Seña: {depositLine}</span>}
        {readyLine && order.status !== 'pending' && (
          <span className="text-zinc-300 truncate" title={readyLine}>{readyLine}</span>
        )}
        {deliveredLine && (
          <span className="text-emerald-400/90 truncate" title={deliveredLine}>{deliveredLine}</span>
        )}
        {order.notes && <span className="text-zinc-500 italic truncate" title={order.notes}>{order.notes}</span>}
      </div>

      {order.status === 'pending' && (
        <button
          type="button"
          disabled={!online || marking}
          onClick={() => onMarkReady(order)}
          title={!online ? 'Sin conexión: no se puede marcar Listo' : undefined}
          className={`w-full rounded-lg py-2.5 text-sm font-bold transition-colors ${
            !online
              ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
              : marking
                ? 'bg-zinc-700 text-zinc-400 cursor-wait'
                : 'bg-green-600 hover:bg-green-500 text-white'
          }`}
        >
          {marking ? 'Marcando…' : '✓ Listo'}
        </button>
      )}

      {order.status === 'ready' && (
        <button
          type="button"
          disabled={!online || undoing}
          onClick={() => onUndoReady(order)}
          title={!online ? 'Sin conexión: no se puede revertir' : undefined}
          className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-colors ${
            !online
              ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
              : 'border border-amber-700 bg-amber-950/40 text-amber-300 hover:bg-amber-900/50'
          }`}
        >
          {undoing ? 'Devolviendo…' : 'Devolver a pendientes'}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BudgetItemsList
// ---------------------------------------------------------------------------

function BudgetItemsList({ items }: { items: BudgetLine[] }) {
  return (
    <table className="w-auto max-w-full border-collapse text-sm">
      <tbody>
        {items.map((line, i) => {
          const hint = formatOrderQtyHint(line)
          return (
            <tr key={line.productId + String(i)}>
              <td
                className="border border-zinc-600 px-2 py-1 text-zinc-200 max-w-[10rem] truncate"
                title={line.name}
              >
                {line.name}
              </td>
              <td className="border border-zinc-600 px-2 py-1 text-right whitespace-nowrap">
                <span className="font-semibold tabular-nums text-white">{formatOrderQty(line)}</span>
                {hint && <span className="ml-1.5 text-[11px] text-zinc-500">{hint}</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// WeekView
// ---------------------------------------------------------------------------

function WeekView({
  employee,
  vales,
  payment,
  weekStart,
  weekEnd,
  employeeId,
  error,
}: {
  employee: PayrollEmployee | null
  vales: PayrollVale[]
  payment: PayrollPayment | null
  weekStart: string
  weekEnd: string
  employeeId: string | null
  error: string | null
}) {
  if (!employeeId) {
    return (
      <div className="p-6 text-center text-zinc-500 text-sm mt-8">
        Esta cuenta no tiene ficha de empleado asociada. Contactá al administrador.
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-400 text-sm">
          {friendlyFirestoreError(error, 'No se pudo cargar la semana. Reintentá en unos minutos.')}
        </p>
      </div>
    )
  }

  if (!employee) {
    return (
      <div className="p-6 flex justify-center mt-12">
        <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const rows = buildWeeklyPayroll([employee], vales, weekStart, weekEnd)
  const row = rows[0]

  if (!row) {
    return (
      <div className="p-6 text-center text-zinc-500 text-sm mt-8">
        No hay datos de liquidación disponibles.
      </div>
    )
  }

  const isPaid = Boolean(payment)
  const weeklyWage = payment ? payment.amount : row.weeklyWage
  const totalVales = payment ? payment.valesDeducted : row.totalVales
  const netToPay = payment ? payment.netPaid : row.netToPay

  return (
    <div className="p-4 space-y-4">
      {/* Week range */}
      <div className="text-center">
        <p className="text-xs text-zinc-400">Semana en curso</p>
        <p className="text-sm font-semibold text-zinc-200">
          {formatYmd(weekStart)} — {formatYmd(weekEnd)}
        </p>
      </div>

      {/* Summary card */}
      <div className="rounded-xl border border-zinc-700 bg-zinc-800/60 divide-y divide-zinc-700">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-zinc-300">Sueldo semanal</span>
          <span className="font-semibold text-white">${weeklyWage.toLocaleString('es-AR')}</span>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-zinc-300">Vales</span>
          <span className="font-semibold text-red-400">
            {totalVales > 0 ? `−$${totalVales.toLocaleString('es-AR')}` : '$0'}
          </span>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-bold text-zinc-100">Neto</span>
          <span className={`text-lg font-bold ${isPaid ? 'text-green-400' : 'text-amber-400'}`}>
            ${netToPay.toLocaleString('es-AR')}
          </span>
        </div>
        {isPaid && (
          <div className="px-4 py-2 text-center">
            <span className="inline-block bg-green-600/20 text-green-400 text-xs font-semibold px-3 py-1 rounded-full border border-green-600/40">
              ✓ Pagado
            </span>
            {payment?.paidAt && (
              <p className="text-xs text-zinc-500 mt-1">
                {new Date(payment.paidAt).toLocaleDateString('es-AR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Vales list */}
      {row.vales.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
            Vales de la semana
          </h3>
          <div className="rounded-xl border border-zinc-700 overflow-hidden">
            {row.vales.map(v => (
              <div key={v.id} className="flex items-center gap-2 px-4 py-3 border-b border-zinc-700 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-200 truncate" title={v.description ?? ''}>
                    {v.description || 'Vale'}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {new Date(v.paidAt).toLocaleDateString('es-AR', {
                      weekday: 'short', day: '2-digit', month: '2-digit',
                    })}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-red-400">
                  −${v.amount.toLocaleString('es-AR')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {row.vales.length === 0 && !isPaid && (
        <p className="text-center text-zinc-600 text-sm">Sin vales esta semana.</p>
      )}
    </div>
  )
}
