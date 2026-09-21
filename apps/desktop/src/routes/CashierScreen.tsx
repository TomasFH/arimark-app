import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import DevToolsPanel from '../components/DevToolsPanel'
import ScanInput from '../components/ScanInput'
import PaymentModal from '../components/PaymentModal'
import ProductsListModal from '../components/ProductsListModal'
import ExpenseModal from './ExpenseModal'
import CashInjectModal from './CashInjectModal'
import CashDiscountModal from './CashDiscountModal'
import CeboModal from './CeboModal'
import ExpenseListModal from './ExpenseListModal'
import SettleProviderDebtModal from './SettleProviderDebtModal'
import AttendanceModal from './AttendanceModal'
import ValesModal from './ValesModal'
import SalaryPaymentModal from './SalaryPaymentModal'
import StockCountModal from './StockCountModal'
import ShiftSalesModal from './ShiftSalesModal'
import DebtModal from '../components/DebtModal'
import ChangePasswordModal from '../components/ChangePasswordModal'
import { BrandMark, Button, ListRow, ScreenHeader, SectionLabel, cx } from '../components/ui'
import type { SaleItemDraft, SalePaymentPayload, ShiftInfo, SessionInfo, ProductRow, SpecialCustomerRow } from '../types/hw-api'
import { formatARS, formatKg } from '../lib/datetime'
import { applyColorScheme, type ColorScheme } from '../lib/theme'
import { useBarcodeScanner } from '../lib/useBarcodeScanner'
import { parseKretzBarcode, centsToARS, normalizeCashDiscountRule, parseCashDiscountSchedule, resolveCashDiscountRule, weekdayInTimeZone, type CashDiscountBlock } from '@carniceria/shared'
import { applySpecialUnitPrice, buildItemFromBarcode } from '../lib/barcodeItem'
import { useCatalogSyncReload } from '../lib/useCatalogSyncReload'

interface Props {
  session: SessionInfo
  shift: ShiftInfo
  onLogout: () => void
  onCloseShift: () => void
  onReturnToHub?: () => void
  onViewDebts?: () => void
  onViewSpecialCustomers?: () => void
  onViewOrders?: () => void
  isActive?: boolean
  /** Carrito inyectado desde un pedido (se carga al POS al activarse la pantalla) */
  pendingOrderCart?: {
    orderId: string
    customerName: string
    depositAmount: number
    depositPayments: import('../types/hw-api').DepositPayment[]
    items: SaleItemDraft[]
  } | null
  /** Callback para indicar que el carrito fue consumido (App.tsx limpia el estado) */
  onOrderCartConsumed?: () => void
}

const FALLBACK_PRODUCT_ID = '00000000-0000-0000-0001-000000000099'

/**
 * Selector de cliente especial en el header del POS (aplica precios acordados al escanear / Manual).
 * Oculto 2026-08-27: los acuerdos se consultan en Menú → Clientes especiales; el ticket se controla a mano.
 * Para reactivar: `true`. Ver PLAN.md FEAT-SPECIAL-POS-SELECTOR-01.
 */
const SHOW_SPECIAL_CUSTOMER_POS_SELECTOR = false

/** Asistencia pausada: reactivar con `true`. No borrar AttendanceModal. */
const SHOW_ATTENDANCE_UI = false

interface CartItem extends SaleItemDraft {
  localId: string
}

// ---------------------------------------------------------------------------
// Inline SVG icons (Heroicons outline 1.5px stroke)
// ---------------------------------------------------------------------------

const IconMenu = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
  </svg>
)

const IconCart = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
  </svg>
)

const IconBanknote = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
  </svg>
)

const IconReceipt = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0c1.1.128 1.907 1.077 1.907 2.185Z" />
  </svg>
)

const IconClock = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
)

const IconSettle = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75h19.5M4.5 15.75l4.5-7.5 3 4.5 3.75-6 3.75 9" />
  </svg>
)

const IconCashInject = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v9m0 0-3.75-3.75M12 13.5l3.75-3.75M3.75 19.5h16.5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 16.5h13.5v2.25a.75.75 0 0 1-.75.75H6a.75.75 0 0 1-.75-.75V16.5Z" />
  </svg>
)

const IconCebo = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M8.25 6.75h7.5M6 10.5h12M7.5 14.25h9M9 18h6" />
  </svg>
)

const IconX = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
  </svg>
)

const IconScan = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.5v15M7.5 4.5v15M10.5 4.5v15M12.75 4.5v15M16.5 4.5v15M20.25 4.5v15" />
  </svg>
)

// ---------------------------------------------------------------------------
// Sidebar button
// ---------------------------------------------------------------------------

interface SidebarBtnProps {
  icon: ReactNode
  label: string
  onClick: () => void
  active?: boolean
}

function SidebarBtn({ icon, label, onClick, active }: SidebarBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'w-full flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl transition-colors duration-150 select-none',
        active
          ? 'bg-accent-soft text-accent'
          : 'text-muted hover:bg-hover hover:text-ink',
      )}
    >
      <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
      <span className="text-[11px] font-medium leading-none">{label}</span>
    </button>
  )
}

function MenuDangerItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left text-sm font-medium text-danger transition-colors hover:bg-hover"
    >
      <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CashierScreen({
  session,
  shift,
  onLogout,
  onCloseShift,
  onReturnToHub,
  onViewDebts,
  onViewSpecialCustomers,
  onViewOrders,
  isActive = true,
  pendingOrderCart,
  onOrderCartConsumed,
}: Props) {
  // ── Existing state ─────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [showAttendanceModal, setShowAttendanceModal] = useState(false)
  const [showValesModal, setShowValesModal] = useState(false)
  const [showSalaryModal, setShowSalaryModal] = useState(false)
  const [showStockCountModal, setShowStockCountModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showProductsModal, setShowProductsModal] = useState(false)
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [showCashInjectModal, setShowCashInjectModal] = useState(false)
  const [showCeboModal, setShowCeboModal] = useState(false)
  const [hasMerchVisitDraft, setHasMerchVisitDraft] = useState(false)
  const [showCashDiscountModal, setShowCashDiscountModal] = useState(false)
  const [cashDiscountFallback, setCashDiscountFallback] = useState({ minAmount: 0, percent: 0 })
  const [cashDiscountSchedule, setCashDiscountSchedule] = useState<CashDiscountBlock[]>([])
  const cashDiscountRule = useMemo(
    () => resolveCashDiscountRule({
      fallback: cashDiscountFallback,
      schedule: cashDiscountSchedule,
      weekday: weekdayInTimeZone(),
      shiftType: shift.shiftType,
    }),
    [cashDiscountFallback, cashDiscountSchedule, shift.shiftType],
  )
  const [showSettleDebtModal, setShowSettleDebtModal] = useState(false)
  const [showExpenseListModal, setShowExpenseListModal] = useState(false)
  const [showSalesModal, setShowSalesModal] = useState(false)
  const [showDebtModal, setShowDebtModal] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [debtLoading, setDebtLoading] = useState(false)
  const [debtError, setDebtError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastSaleId, setLastSaleId] = useState<string | null>(null)
  const [cashInHand, setCashInHand] = useState<number | null>(null)
  const [scanFlash, setScanFlash] = useState<string | null>(null)

  /** Pedido activo inyectado en el POS (para marcar entregado al confirmar la venta) */
  const [activeOrder, setActiveOrder] = useState<{
    orderId: string
    customerName: string
    depositAmount: number
    depositPayments: import('../types/hw-api').DepositPayment[]
  } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [storeName, setStoreName] = useState<string | null>(null)
  const [specialCustomers, setSpecialCustomers] = useState<SpecialCustomerRow[]>([])
  const [specialCustomerId, setSpecialCustomerId] = useState<string | null>(null)
  const [specialPriceByProductId, setSpecialPriceByProductId] = useState<Record<string, number>>({})
  const scanFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── New UI state ───────────────────────────────────────────────────────────
  const [showManualPanel, setShowManualPanel] = useState(false)
  const [showMenuPanel, setShowMenuPanel] = useState(false)
  const [heroInput, setHeroInput] = useState('')
  const [heroError, setHeroError] = useState('')
  const heroInputRef = useRef<HTMLInputElement>(null)
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => (
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  ))

  // ── Effects ────────────────────────────────────────────────────────────────

  const reloadPosCatalog = useCallback(() => {
    void window.hw.getProducts().then(res => {
      if (res.ok) setProducts(res.data)
    })
  }, [])

  const refreshMerchVisitDraft = useCallback(() => {
    void window.hw.getMerchVisitDraft().then(r => {
      setHasMerchVisitDraft(Boolean(r.ok && r.data && r.data.lines.length > 0))
    })
  }, [])

  useEffect(() => {
    reloadPosCatalog()
  }, [reloadPosCatalog])

  useEffect(() => {
    refreshMerchVisitDraft()
  }, [refreshMerchVisitDraft, isActive])

  useCatalogSyncReload(reloadPosCatalog)

  useEffect(() => {
    void window.hw.getUiSettings().then(r => {
      if (!r.ok) return
      setColorScheme(r.data.colorScheme)
      applyColorScheme(r.data.colorScheme)
    })
    return window.hw.onUiSettingsChanged(settings => {
      setColorScheme(settings.colorScheme)
      applyColorScheme(settings.colorScheme)
    })
  }, [])

  async function handleColorScheme(scheme: ColorScheme): Promise<void> {
    applyColorScheme(scheme)
    setColorScheme(scheme)
    const r = await window.hw.setUiSettings({ colorScheme: scheme })
    if (r.ok) {
      setColorScheme(r.data.colorScheme)
      applyColorScheme(r.data.colorScheme)
    }
  }

  useEffect(() => {
    const storeId = session.storeId ?? shift.storeId
    if (!storeId) return
    void window.hw.getStores().then(res => {
      if (!res.ok) return
      const store = res.data.find(s => s.id === storeId)
      if (store) {
        setStoreName(store.name)
        setCashDiscountFallback(normalizeCashDiscountRule(
          store.cashDiscountMinAmount ?? 0,
          store.cashDiscountPercent ?? 0,
        ))
        setCashDiscountSchedule(parseCashDiscountSchedule(store.cashDiscountSchedule))
      }
    })
  }, [session.storeId, shift.storeId])

  const loadSpecialCustomers = useCallback(async () => {
    const res = await window.hw.listSpecialCustomers()
    if (!res.ok) return
    setSpecialCustomers(res.data)
  }, [])

  const loadSpecialPrices = useCallback(async (customerId: string | null) => {
    if (!customerId) {
      setSpecialPriceByProductId({})
      return
    }
    const res = await window.hw.getSpecialCustomerPrices({ specialCustomerId: customerId })
    if (!res.ok) {
      setSpecialPriceByProductId({})
      return
    }
    const map: Record<string, number> = {}
    for (const row of res.data) {
      map[row.productId] = row.specialPrice
    }
    setSpecialPriceByProductId(map)
  }, [])

  useEffect(() => {
    if (!SHOW_SPECIAL_CUSTOMER_POS_SELECTOR) return
    void loadSpecialCustomers()
    return window.hw.onSpecialCustomerSyncUpdated(() => {
      void loadSpecialCustomers()
      void loadSpecialPrices(specialCustomerId)
    })
  }, [loadSpecialCustomers, loadSpecialPrices, specialCustomerId])

  function refreshBalance(): void {
    void window.hw.getShiftSummary().then(r => {
      if (r.ok) setCashInHand(r.data.cashInHand)
    })
  }

  async function handleRefreshRemote(): Promise<void> {
    if (refreshing) return
    setRefreshing(true)
    setError('')
    try {
      const sync = await window.hw.refreshRemoteData()
      if (!sync.ok) {
        setError(sync.error ?? 'No se pudieron actualizar los datos remotos.')
        return
      }
      const productsRes = await window.hw.getProducts()
      if (productsRes.ok) setProducts(productsRes.data)
      if (SHOW_SPECIAL_CUSTOMER_POS_SELECTOR) {
        await loadSpecialCustomers()
        await loadSpecialPrices(specialCustomerId)
      }
      const storeId = session.storeId ?? shift.storeId
      if (storeId) {
        const storesRes = await window.hw.getStores()
        if (storesRes.ok) {
          const store = storesRes.data.find(s => s.id === storeId)
          if (store) setStoreName(store.name)
        }
      }
      refreshBalance()
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    refreshBalance()
    const interval = setInterval(refreshBalance, 30_000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isActive) refreshBalance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  // Inyectar carrito de pedido al activarse el POS
  useEffect(() => {
    if (!isActive || !pendingOrderCart) return
    const items = pendingOrderCart.items.map(item => ({
      ...item,
      localId: `order-${crypto.randomUUID()}`,
    }))
    setCart(items)
    setActiveOrder({
      orderId: pendingOrderCart.orderId,
      customerName: pendingOrderCart.customerName,
      depositAmount: pendingOrderCart.depositAmount,
      depositPayments: pendingOrderCart.depositPayments,
    })
    setError('')
    setLastSaleId(null)
    onOrderCartConsumed?.()
  // Solo ejecutar cuando el POS se activa con un carrito pendiente
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, pendingOrderCart])

  // ── Cart logic ─────────────────────────────────────────────────────────────

  const cartTotal = cart.reduce((sum, item) => sum + item.subtotal, 0)
  /** Monto neto a cobrar ahora: descuenta la seña del pedido activo */
  const cartNetTotal = Math.max(0, cartTotal - (activeOrder?.depositAmount ?? 0))
  const hasManualItems = cart.some(item => item.manualEntry)

  const addItem = useCallback((item: SaleItemDraft) => {
    const special = item.productId ? specialPriceByProductId[item.productId] : undefined
    const priced = applySpecialUnitPrice(item, special)
    setCart(prev => [...prev, { ...priced, localId: `tmp-${crypto.randomUUID()}` }])
    setError('')
    setLastSaleId(null)
  }, [specialPriceByProductId])

  const anyModalOpen = showPaymentModal || showProductsModal
    || showCashInjectModal || showCeboModal || showCashDiscountModal

  const handleGlobalScan = useCallback((digits: string) => {
    const parsed = parseKretzBarcode(digits)
    if (!parsed) return
    const plu = parseInt(parsed.pluNumber, 10)
    const product = products.find(p => p.pluNumber === plu)
    const item = buildItemFromBarcode(plu, centsToARS(parsed.totalCents), product)
    addItem(item)
    if (scanFlashTimerRef.current) clearTimeout(scanFlashTimerRef.current)
    setScanFlash(item.productName)
    scanFlashTimerRef.current = setTimeout(() => setScanFlash(null), 2000)
  }, [products, addItem])

  useBarcodeScanner({ onScan: handleGlobalScan, disabled: anyModalOpen || !isActive })

  function removeItem(localId: string) {
    setCart(prev => prev.filter(i => i.localId !== localId))
  }

  function clearCart() {
    setCart([])
    setError('')
    setLastSaleId(null)
    setActiveOrder(null)
  }

  useEffect(() => {
    if (cart.length === 0 && activeOrder) setActiveOrder(null)
  }, [cart.length, activeOrder])

  // ── Hero input handlers ────────────────────────────────────────────────────

  function handleHeroChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, '')
    setHeroInput(digits)
    setHeroError('')
    if (digits.length === 13) {
      const parsed = parseKretzBarcode(digits)
      if (parsed) {
        const plu = parseInt(parsed.pluNumber, 10)
        const product = products.find(p => p.pluNumber === plu)
        const item = buildItemFromBarcode(plu, centsToARS(parsed.totalCents), product)
        addItem(item)
        setHeroInput('')
        setTimeout(() => heroInputRef.current?.focus(), 0)
      }
    }
  }

  function handleHeroSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!heroInput.trim()) return
    const parsed = parseKretzBarcode(heroInput.trim())
    if (parsed) {
      const plu = parseInt(parsed.pluNumber, 10)
      const product = products.find(p => p.pluNumber === plu)
      const item = buildItemFromBarcode(plu, centsToARS(parsed.totalCents), product)
      addItem(item)
      setHeroInput('')
      setTimeout(() => heroInputRef.current?.focus(), 0)
    } else {
      setHeroError('Código inválido — verificá que sea el ticket de la balanza (13 dígitos, prefijo 20).')
    }
  }

  // ── Sale handlers ──────────────────────────────────────────────────────────

  async function handleConfirmSale(payments: SalePaymentPayload[], notes?: string) {
    if (cart.length === 0) {
      setError('Agregá al menos un producto antes de confirmar.')
      return
    }
    setLoading(true)
    setError('')
    setShowPaymentModal(false)
    try {
      const result = await window.hw.createSale({
        items: cart.map(item => ({
          productId: item.productId ?? FALLBACK_PRODUCT_ID,
          quantity: item.unit === 'unit' ? Math.round(item.weightKg) : item.weightKg,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
        })),
        payments,
        manualEntry: hasManualItems,
        notes,
        orderId: activeOrder?.orderId,
        depositCredit: activeOrder?.depositAmount && activeOrder.depositAmount > 0 ? activeOrder.depositAmount : undefined,
      })
      if (!result.ok) {
        setError(result.error ?? 'Error al procesar la venta.')
        return
      }
      setLastSaleId(result.data.saleId)
      setCart([])
      setActiveOrder(null)
      refreshBalance()
    } catch {
      setError('Error de comunicación. Reintentar.')
    } finally {
      setLoading(false)
    }
  }

  function openPaymentModal() {
    setError('')
    setLastSaleId(null)
    setShowPaymentModal(true)
  }

  const handleOpenFiado = useCallback(() => {
    setShowPaymentModal(false)
    setDebtError(null)
    setShowDebtModal(true)
  }, [])

  const handleCloseDebtModal = useCallback(() => {
    setShowDebtModal(false)
    setDebtError(null)
  }, [])

  async function handleConfirmFiado(payload: {
    customerId?: string
    newCustomer?: { name: string; phone: string }
    initialPayment: number
    paymentMethods: SalePaymentPayload[]
    dueDate?: string
    notes?: string
  }) {
    if (cart.length === 0) return
    setDebtLoading(true)
    setDebtError(null)
    try {
      const saleResult = await window.hw.createSale({
        items: cart.map(item => ({
          productId: item.productId ?? FALLBACK_PRODUCT_ID,
          quantity: item.unit === 'unit' ? Math.round(item.weightKg) : item.weightKg,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
        })),
        payments: payload.paymentMethods,
        isDebt: true,
        customerId: payload.customerId,
        manualEntry: hasManualItems,
        notes: payload.notes,
      })
      if (!saleResult.ok) {
        setDebtError(saleResult.error ?? 'Error al registrar la venta.')
        return
      }
      const debtResult = await window.hw.createDebt({
        saleId: saleResult.data.saleId,
        customerId: payload.customerId,
        newCustomer: payload.newCustomer,
        initialPayment: payload.initialPayment,
        dueDate: payload.dueDate ? new Date(payload.dueDate).toISOString() : undefined,
        notes: payload.notes,
      })
      if (!debtResult.ok) {
        setDebtError(debtResult.error ?? 'Error al registrar la deuda.')
        return
      }
      setShowDebtModal(false)
      setCart([])
      refreshBalance()
    } catch {
      setDebtError('Error de comunicación. Reintentar.')
    } finally {
      setDebtLoading(false)
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  const shiftLabel = shift.shiftType === 'morning' ? 'Mañana' : 'Tarde'

  function closeMenu() { setShowMenuPanel(false) }

  useEffect(() => {
    if (!showMenuPanel) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setShowMenuPanel(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showMenuPanel])

  const railActive: 'menu' | 'venta' | 'vales' | 'gastos' | 'turno' = showMenuPanel
    ? 'menu'
    : showValesModal
      ? 'vales'
      : showExpenseModal
        ? 'gastos'
        : showSalesModal
          ? 'turno'
          : 'venta'

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-app text-ink font-sans">

      {/* ━━━ SIDEBAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <nav className="flex w-16 flex-none flex-col items-center border-r border-line bg-panel px-1.5 py-2 gap-0.5 z-10">
        <SidebarBtn
          icon={<IconMenu />}
          label="Menú"
          onClick={() => setShowMenuPanel(v => !v)}
          active={railActive === 'menu'}
        />

        <div className="my-1.5 w-8 h-px bg-line shrink-0" />

        <SidebarBtn
          icon={<IconCart />}
          label="Venta"
          onClick={() => setShowMenuPanel(false)}
          active={railActive === 'venta'}
        />
        <SidebarBtn
          icon={<IconBanknote />}
          label="Vales"
          onClick={() => { setShowMenuPanel(false); setShowValesModal(true) }}
          active={railActive === 'vales'}
        />
        <SidebarBtn
          icon={<IconReceipt />}
          label="Gastos"
          onClick={() => { setShowMenuPanel(false); setShowExpenseModal(true) }}
          active={railActive === 'gastos'}
        />
        <SidebarBtn
          icon={<IconClock />}
          label="Turno"
          onClick={() => { setShowMenuPanel(false); setShowSalesModal(true) }}
          active={railActive === 'turno'}
        />

        <div className="flex-1" />

        <div className="mb-1.5 flex items-center justify-center">
          <BrandMark size={32} />
        </div>
      </nav>

      {/* ━━━ MAIN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">

        <ScreenHeader
          title={storeName ?? 'Caja'}
          subtitle={shiftLabel}
          actions={
            <>
              {cashInHand !== null && (
                <span className="font-mono text-xs tabular-nums text-success shrink-0" title="Efectivo estimado en caja">
                  {formatARS(cashInHand)} en caja
                </span>
              )}
              {hasMerchVisitDraft && (
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(true)}
                  className="shrink-0 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/25"
                  title="Hay una visita de proveedor sin confirmar"
                >
                  Visita en curso
                </button>
              )}
              {SHOW_SPECIAL_CUSTOMER_POS_SELECTOR && specialCustomers.length > 0 && (
                <select
                  value={specialCustomerId ?? ''}
                  onChange={e => {
                    const id = e.target.value || null
                    setSpecialCustomerId(id)
                    void loadSpecialPrices(id)
                  }}
                  title={specialCustomerId
                    ? specialCustomers.find(c => c.id === specialCustomerId)?.name
                    : 'Precio de lista'}
                  className="max-w-[11rem] truncate rounded-lg border border-line bg-input px-2 py-1 text-xs text-ink focus:outline-none"
                >
                  <option value="">Precio de lista</option>
                  {specialCustomers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </>
          }
        />

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          <div className="flex h-full w-full gap-5 px-6 py-5">

            {/* ━━━ LEFT COLUMN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div className="flex flex-1 flex-col min-w-0 gap-4">

              {/* Page title */}
              <p className="text-base font-semibold text-ink shrink-0">Área de Venta</p>

              {/* Hero scan input + manual toggle */}
              <div className="shrink-0 flex gap-2">
                <form onSubmit={handleHeroSubmit} className="flex-1 min-w-0">
                  <div className={cx(
                    'flex h-14 items-center gap-3 rounded-xl border bg-panel px-4 transition-colors focus-within:border-accent',
                    heroError ? 'border-danger' : 'border-line',
                  )}>
                    <span className="shrink-0 text-muted"><IconScan /></span>
                    <input
                      ref={heroInputRef}
                      type="text"
                      inputMode="numeric"
                      value={heroInput}
                      onChange={handleHeroChange}
                      placeholder="Escaneá el ticket de la balanza"
                      data-barcode-input="true"
                      autoFocus
                      className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-subtle focus:outline-none"
                    />
                    {scanFlash ? (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-success animate-pulse">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        <span className="max-w-[8rem] truncate" title={scanFlash}>{scanFlash}</span>
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                        <span className="h-1.5 w-1.5 rounded-full bg-line" />
                        Lector listo
                      </span>
                    )}
                  </div>
                  {heroError && (
                    <p className="mt-1.5 px-1 text-xs text-danger">{heroError}</p>
                  )}
                </form>

                <button
                  type="button"
                  onClick={() => setShowManualPanel(v => !v)}
                  title="Ingresar producto manualmente por PLU y precio"
                  className={cx(
                    'h-14 shrink-0 rounded-xl border px-4 text-sm font-medium transition-colors',
                    showManualPanel
                      ? 'border-accent bg-accent-soft text-ink'
                      : 'border-line bg-panel text-muted hover:bg-hover hover:text-ink',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5 3 12l3.75 4.5m6.75-9L17.25 12l-3.75 4.5M11.25 3l-1.5 18" />
                    </svg>
                    <span>Manual</span>
                  </span>
                </button>
              </div>

              {/* Manual PLU panel */}
              {showManualPanel && (
                <div className="shrink-0 rounded-xl border border-line bg-panel">
                  <ScanInput
                    onAddItem={addItem}
                    products={products}
                    specialPriceByProductId={specialPriceByProductId}
                  />
                </div>
              )}

              {/* Cart section header */}
              <div className="flex items-center justify-between shrink-0 gap-2 min-w-0">
                <span className="min-w-0 truncate text-xs font-medium text-muted">
                  {cart.length > 0
                    ? `${cart.length} producto${cart.length !== 1 ? 's' : ''} en la venta`
                    : 'Sin productos'}
                </span>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={clearCart}
                    className="shrink-0 text-xs text-muted hover:text-danger transition-colors"
                  >
                    Vaciar
                  </button>
                )}
              </div>

              {/* Cart items — panel elevado para no fundirse con el fondo */}
              <div className="flex-1 min-h-0 overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_8px_24px_rgba(28,28,30,0.06)]">
                <div className="h-full overflow-y-auto space-y-0.5 p-1">
                {cart.length === 0 ? (
                  <div className="flex h-48 flex-col items-center justify-center gap-3 text-muted">
                    <svg className="h-10 w-10 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                    </svg>
                    <div className="text-center space-y-1 px-4">
                      <p className="text-sm text-muted">Escaneá un producto para empezar</p>
                      <p className="text-xs text-subtle">
                        Sin lector o balanza → usá el botón{' '}
                        <span className="font-medium text-muted">Manual</span>{' '}
                        para ingresar PLU y precio
                      </p>
                    </div>
                  </div>
                ) : (
                  cart.map(item => (
                    <div
                      key={item.localId}
                      className="group flex items-center gap-3 min-w-0 rounded-xl px-3 py-3 hover:bg-hover transition-colors"
                    >
                      {item.pluNumber ? (
                        <span className="w-9 shrink-0 rounded-md bg-hover px-1.5 py-0.5 text-center font-mono text-[10px] font-bold text-muted tabular-nums">
                          {item.pluNumber}
                        </span>
                      ) : (
                        <span className="w-9 shrink-0" />
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate text-sm text-ink" title={item.productName}>
                            {item.productName}
                          </span>
                          {item.manualEntry && (
                            <span className="shrink-0 rounded bg-hover px-1 py-0.5 text-[10px] text-muted">
                              manual
                            </span>
                          )}
                          {item.priceDiscrepancy && (
                            <span
                              className="shrink-0 rounded px-1 py-0.5 text-[10px] text-danger bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
                              title="El precio del ticket no coincide con el catálogo. Verificar la balanza."
                            >
                              precio
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] text-muted tabular-nums">
                          {item.unit === 'unit'
                            ? `${Math.round(item.weightKg)} u. × ${formatARS(item.unitPrice)}/u.`
                            : `${formatKg(item.weightKg)} @ ${formatARS(item.unitPrice)}/kg`}
                        </p>
                      </div>

                      <span className="shrink-0 font-mono text-sm font-semibold text-ink tabular-nums">
                        {formatARS(item.subtotal)}
                      </span>

                      <button
                        type="button"
                        onClick={() => removeItem(item.localId)}
                        className="shrink-0 flex items-center rounded-lg px-1.5 py-1 text-muted hover:bg-hover hover:text-danger transition-colors"
                        title="Quitar de la venta"
                        aria-label="Quitar de la venta"
                      >
                        <IconX />
                      </button>
                    </div>
                  ))
                )}
                </div>
              </div>
            </div>

            {/* ━━━ RIGHT COLUMN — CHECKOUT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div className="w-80 flex-none flex flex-col gap-4">
              <div className="flex flex-col flex-1 rounded-xl border border-line bg-panel overflow-hidden shadow-[0_8px_24px_rgba(28,28,30,0.06)]">

                <div className="border-b border-line px-5 py-4 shrink-0">
                  <h2 className="text-sm font-semibold text-ink">Total de la Venta</h2>
                </div>

                {activeOrder && (
                  <div className="mx-3 mt-3 rounded-xl bg-accent-soft px-3 py-2.5 space-y-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-accent mb-0.5">Pedido activo</p>
                      <p className="text-sm text-ink truncate" title={activeOrder.customerName}>{activeOrder.customerName}</p>
                      {activeOrder.depositAmount > 0 && (
                        <p className="text-xs text-muted">Seña: <span className="font-semibold text-ink">{formatARS(activeOrder.depositAmount)}</span></p>
                      )}
                    </div>
                    <Button variant="secondary" size="sm" fullWidth onClick={clearCart}>
                      Cancelar cobro
                    </Button>
                  </div>
                )}

                <div className="flex-1 space-y-2 px-5 py-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Subtotal</span>
                    <span className="font-mono text-sm text-ink tabular-nums">{formatARS(cartTotal)}</span>
                  </div>
                  {activeOrder && activeOrder.depositAmount > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-accent">Seña descontada</span>
                      <span className="font-mono text-sm text-accent tabular-nums">−{formatARS(activeOrder.depositAmount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink font-medium">A cobrar</span>
                    <span className="font-mono text-sm text-ink tabular-nums">{formatARS(cartNetTotal)}</span>
                  </div>
                </div>

                <div className="shrink-0 space-y-4 border-t border-line px-5 pb-5 pt-4">
                  <div>
                    <p className="text-xs font-semibold text-muted mb-1.5">
                      {activeOrder ? 'A cobrar' : 'Total'}
                    </p>
                    <p className="font-mono text-5xl font-bold leading-none text-ink tabular-nums tracking-tight">
                      {formatARS(cartNetTotal)}
                    </p>
                  </div>

                  {error && (
                    <div className="rounded-lg px-3 py-2 bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]">
                      <p className="text-xs text-danger">{error}</p>
                    </div>
                  )}
                  {lastSaleId && (
                    <div className="rounded-lg px-3 py-2 bg-[color-mix(in_srgb,var(--success)_12%,transparent)]">
                      <p className="text-xs text-success">Venta confirmada</p>
                    </div>
                  )}

                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    loading={loading}
                    disabled={cart.length === 0}
                    onClick={openPaymentModal}
                    className="!h-14 text-lg"
                  >
                    Cobrar
                  </Button>
                </div>
              </div>

              <DevToolsPanel onDataChanged={refreshBalance} />
            </div>

          </div>
        </div>
      </div>

      {/* ━━━ MENU OVERLAY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {showMenuPanel && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={closeMenu}
          />
          <div
            role="dialog"
            aria-label="Opciones"
            className="fixed left-16 top-0 z-50 flex h-full w-64 flex-col border-r border-line bg-panel shadow-[0_8px_28px_rgba(28,28,30,0.16)]"
          >
            <div className="shrink-0 border-b border-line px-4 py-4">
              <p className="text-sm font-semibold text-ink">Opciones</p>
              {storeName && (
                <p className="mt-0.5 min-w-0 truncate text-xs text-muted" title={`${storeName} · Turno ${shiftLabel}`}>
                  {storeName} · Turno {shiftLabel}
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              <SectionLabel className="px-4">Caja</SectionLabel>
              <ListRow
                title="Ingreso"
                leading={<span className="text-muted"><IconCashInject /></span>}
                onClick={() => { setShowCashInjectModal(true); closeMenu() }}
              />
              <ListRow
                title="Cebo"
                leading={<span className="text-muted"><IconCebo /></span>}
                onClick={() => { setShowCeboModal(true); closeMenu() }}
              />
              <ListRow
                title="Saldar"
                leading={<span className="text-muted"><IconSettle /></span>}
                onClick={() => { setShowSettleDebtModal(true); closeMenu() }}
              />

              <SectionLabel className="mt-4 px-4">Consultas</SectionLabel>
              <ListRow title="Catálogo" onClick={() => { setShowProductsModal(true); closeMenu() }} />
              {onViewOrders && (
                <ListRow title="Pedidos" onClick={() => { onViewOrders(); closeMenu() }} />
              )}
              {onViewDebts && (
                <ListRow title="Fiados" onClick={() => { onViewDebts(); closeMenu() }} />
              )}
              {onViewSpecialCustomers && (
                <ListRow title="Clientes especiales" onClick={() => { onViewSpecialCustomers(); closeMenu() }} />
              )}

              <SectionLabel className="mt-4 px-4">Operación</SectionLabel>
              <ListRow title="Stock" onClick={() => { setShowStockCountModal(true); closeMenu() }} />
              <ListRow title="Liquidación" onClick={() => { setShowSalaryModal(true); closeMenu() }} />
              <ListRow title="Desc. efectivo" onClick={() => { setShowCashDiscountModal(true); closeMenu() }} />
              <ListRow title="Gastos del turno" onClick={() => { setShowExpenseListModal(true); closeMenu() }} />
              <ListRow
                title={refreshing ? 'Actualizando…' : 'Actualizar'}
                disabled={refreshing}
                onClick={() => { void handleRefreshRemote(); closeMenu() }}
              />
              {SHOW_ATTENDANCE_UI && (
                <ListRow title="Asistencia" onClick={() => { setShowAttendanceModal(true); closeMenu() }} />
              )}
            </div>

            <div className="shrink-0 max-h-[55%] overflow-y-auto border-t border-line py-2">
              <SectionLabel className="px-4">Apariencia</SectionLabel>
              <div className="mx-3 mb-3 flex rounded-xl bg-hover p-1">
                <button
                  type="button"
                  onClick={() => { void handleColorScheme('light') }}
                  aria-pressed={colorScheme === 'light'}
                  className={cx(
                    'flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors',
                    colorScheme === 'light' ? 'bg-panel text-ink shadow-[0_1px_2px_rgba(28,28,30,0.12)]' : 'text-muted hover:text-ink',
                  )}
                >
                  Claro
                </button>
                <button
                  type="button"
                  onClick={() => { void handleColorScheme('dark') }}
                  aria-pressed={colorScheme === 'dark'}
                  className={cx(
                    'flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors',
                    colorScheme === 'dark' ? 'bg-panel text-ink shadow-[0_1px_2px_rgba(28,28,30,0.12)]' : 'text-muted hover:text-ink',
                  )}
                >
                  Oscuro
                </button>
              </div>

              <SectionLabel className="px-4">Sesión</SectionLabel>
              {onReturnToHub && (
                <ListRow title="Hub" onClick={() => { onReturnToHub(); closeMenu() }} />
              )}
              <MenuDangerItem label="Cerrar caja" onClick={() => { onCloseShift(); closeMenu() }} />
              <ListRow title="Contraseña" onClick={() => { setShowChangePassword(true); closeMenu() }} />
              <ListRow title="Cerrar sesión" onClick={() => { onLogout(); closeMenu() }} />
            </div>
          </div>
        </>
      )}

      {/* ━━━ MODALS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      {showPaymentModal && cart.length > 0 && (
        <PaymentModal
          itemTotal={cartTotal}
          depositAmount={activeOrder?.depositAmount ?? 0}
          depositDigitalAmount={
            activeOrder
              ? activeOrder.depositPayments
                .filter(p => p.method !== 'cash')
                .reduce((sum, p) => sum + p.amount, 0)
              : 0
          }
          cashDiscountRule={cashDiscountRule}
          onConfirm={handleConfirmSale}
          onFiado={activeOrder ? undefined : handleOpenFiado}
          onClose={() => setShowPaymentModal(false)}
        />
      )}

      {showDebtModal && cart.length > 0 && (
        <DebtModal
          total={cartTotal}
          onConfirm={handleConfirmFiado}
          onClose={handleCloseDebtModal}
          loading={debtLoading}
          error={debtError}
        />
      )}

      {showProductsModal && session.storeId && (
        <ProductsListModal
          storeId={session.storeId}
          storeName={storeName}
          onClose={() => {
            setShowProductsModal(false)
            reloadPosCatalog()
          }}
        />
      )}

      {SHOW_ATTENDANCE_UI && showAttendanceModal && (
        <AttendanceModal storeId={shift.storeId} onClose={() => setShowAttendanceModal(false)} />
      )}

      {showValesModal && (
        <ValesModal
          storeId={shift.storeId}
          viewerRole={session.role}
          viewerName={session.displayName ?? ''}
          onClose={() => setShowValesModal(false)}
          onSaved={refreshBalance}
        />
      )}

      {showSalaryModal && (
        <SalaryPaymentModal
          onClose={() => setShowSalaryModal(false)}
          onPaid={refreshBalance}
        />
      )}

      {showStockCountModal && (
        <StockCountModal
          storeId={session.storeId ?? shift.storeId}
          onClose={() => setShowStockCountModal(false)}
        />
      )}

      {showExpenseModal && (
        <ExpenseModal
          onSaved={refreshBalance}
          onRegistered={() => { setShowExpenseModal(false); refreshMerchVisitDraft() }}
          onCancel={() => { setShowExpenseModal(false); refreshMerchVisitDraft() }}
          onDraftChanged={refreshMerchVisitDraft}
        />
      )}

      {showCashInjectModal && (
        <CashInjectModal
          onSaved={refreshBalance}
          onCancel={() => setShowCashInjectModal(false)}
        />
      )}

      {showCeboModal && (
        <CeboModal onClose={() => setShowCeboModal(false)} />
      )}

      {showCashDiscountModal && (
        <CashDiscountModal
          onClose={() => {
            setShowCashDiscountModal(false)
            void window.hw.getCashDiscountRule().then(r => {
              if (r.ok) {
                setCashDiscountFallback({ minAmount: r.data.minAmount, percent: r.data.percent })
                setCashDiscountSchedule(r.data.schedule)
              }
            })
          }}
        />
      )}

      {showSettleDebtModal && (
        <SettleProviderDebtModal
          onClose={() => setShowSettleDebtModal(false)}
          onSaved={refreshBalance}
        />
      )}

      {showExpenseListModal && (
        <ExpenseListModal onClose={() => setShowExpenseListModal(false)} />
      )}

      {showSalesModal && (
        <ShiftSalesModal onClose={() => setShowSalesModal(false)} onCancelled={refreshBalance} />
      )}

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}

    </div>
  )
}
