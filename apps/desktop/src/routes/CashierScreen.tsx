import { useState, useEffect, useCallback, useRef } from 'react'
import DevToolsPanel from '../components/DevToolsPanel'
import ScanInput from '../components/ScanInput'
import PaymentModal from '../components/PaymentModal'
import ProductsListModal from '../components/ProductsListModal'
import ExpenseModal from './ExpenseModal'
import CashInjectModal from './CashInjectModal'
import ExpenseListModal from './ExpenseListModal'
import SettleProviderDebtModal from './SettleProviderDebtModal'
import AttendanceModal from './AttendanceModal'
import ValesModal from './ValesModal'
import SalaryPaymentModal from './SalaryPaymentModal'
import StockCountModal from './StockCountModal'
import ShiftSalesModal from './ShiftSalesModal'
import DebtModal from '../components/DebtModal'
import type { SaleItemDraft, SalePaymentPayload, ShiftInfo, SessionInfo, ProductRow, SpecialCustomerRow } from '../types/hw-api'
import { formatARS, formatKg } from '../lib/datetime'
import { useBarcodeScanner } from '../lib/useBarcodeScanner'
import { parseKretzBarcode, centsToARS } from '@carniceria/shared'
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
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
  danger?: boolean
}

function SidebarBtn({ icon, label, onClick, active, danger }: SidebarBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex flex-col items-center justify-center gap-1 py-3 rounded-lg transition-all active:scale-95 select-none ${
        danger
          ? 'text-red-500 hover:bg-red-950/40 hover:text-red-400'
          : active
            ? 'bg-zinc-700 text-zinc-100'
            : 'text-zinc-500 hover:bg-zinc-700/70 hover:text-zinc-300'
      }`}
    >
      <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
      <span className="text-[9px] font-medium tracking-wide leading-none">{label}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Menu overlay action
// ---------------------------------------------------------------------------

interface MenuActionProps {
  emoji: string
  label: string
  onClick: () => void
  danger?: boolean
  muted?: boolean
}

function MenuAction({ emoji, label, onClick, danger, muted }: MenuActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-zinc-700/80 active:bg-zinc-700 ${
        danger ? 'text-red-400 hover:text-red-300' : muted ? 'text-zinc-600 hover:text-zinc-400' : 'text-zinc-300 hover:text-zinc-100'
      }`}
    >
      <span className="text-base shrink-0 w-5 text-center">{emoji}</span>
      {label}
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
  const [showSettleDebtModal, setShowSettleDebtModal] = useState(false)
  const [showExpenseListModal, setShowExpenseListModal] = useState(false)
  const [showSalesModal, setShowSalesModal] = useState(false)
  const [showDebtModal, setShowDebtModal] = useState(false)
  const [debtLoading, setDebtLoading] = useState(false)
  const [debtError, setDebtError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastSaleId, setLastSaleId] = useState<string | null>(null)
  const [cashInHand, setCashInHand] = useState<number | null>(null)
  const [scanFlash, setScanFlash] = useState<string | null>(null)
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

  // ── Effects ────────────────────────────────────────────────────────────────

  const reloadPosCatalog = useCallback(() => {
    void window.hw.getProducts().then(res => {
      if (res.ok) setProducts(res.data)
    })
  }, [])

  useEffect(() => {
    reloadPosCatalog()
  }, [reloadPosCatalog])

  useCatalogSyncReload(reloadPosCatalog)

  useEffect(() => {
    const storeId = session.storeId ?? shift.storeId
    if (!storeId) return
    void window.hw.getStores().then(res => {
      if (!res.ok) return
      const store = res.data.find(s => s.id === storeId)
      if (store) setStoreName(store.name)
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

  // ── Cart logic ─────────────────────────────────────────────────────────────

  const cartTotal = cart.reduce((sum, item) => sum + item.subtotal, 0)
  const hasManualItems = cart.some(item => item.manualEntry)

  const addItem = useCallback((item: SaleItemDraft) => {
    const special = item.productId ? specialPriceByProductId[item.productId] : undefined
    const priced = applySpecialUnitPrice(item, special)
    setCart(prev => [...prev, { ...priced, localId: `tmp-${crypto.randomUUID()}` }])
    setError('')
    setLastSaleId(null)
  }, [specialPriceByProductId])

  const anyModalOpen = showPaymentModal || showProductsModal

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
  }

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
      })
      if (!result.ok) {
        setError(result.error ?? 'Error al procesar la venta.')
        return
      }
      setLastSaleId(result.data.saleId)
      setCart([])
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100 font-sans">

      {/* ━━━ SIDEBAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <nav className="flex w-16 flex-none flex-col items-center border-r border-zinc-700 bg-zinc-800 py-2 gap-0.5 z-10">
        <SidebarBtn icon={<IconMenu />} label="Menú" onClick={() => setShowMenuPanel(v => !v)} active={showMenuPanel} />

        <div className="my-1.5 w-8 h-px bg-zinc-700 shrink-0" />

        <SidebarBtn icon={<IconCart />} label="Venta" onClick={() => { setShowMenuPanel(false) }} active={!showMenuPanel} />
        <SidebarBtn icon={<IconBanknote />} label="Vales" onClick={() => setShowValesModal(true)} />
        <SidebarBtn icon={<IconReceipt />} label="Gastos" onClick={() => setShowExpenseModal(true)} />
        <SidebarBtn icon={<IconCashInject />} label="Ingreso" onClick={() => setShowCashInjectModal(true)} />
        <SidebarBtn icon={<IconSettle />} label="Saldar" onClick={() => setShowSettleDebtModal(true)} />
        <SidebarBtn icon={<IconClock />} label="Turno" onClick={() => setShowSalesModal(true)} />

        <div className="flex-1" />

        {/* Brand mark */}
        <div className="my-1.5 flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-700">
          <span className="text-sm">🥩</span>
        </div>
      </nav>

      {/* ━━━ MAIN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">

        {/* Status bar */}
        <header className="flex items-center gap-3 border-b border-zinc-700 bg-zinc-800 px-5 py-2 shrink-0">
          {storeName && (
            <span className="text-sm font-semibold text-zinc-100 truncate max-w-[12rem]" title={storeName}>
              {storeName}
            </span>
          )}
          <span className="text-xs text-zinc-500 shrink-0">{shiftLabel}</span>
          {cashInHand !== null && (
            <span className="font-mono text-xs text-emerald-400 shrink-0" title="Efectivo estimado en caja">
              {formatARS(cashInHand)} en caja
            </span>
          )}
          <div className="flex-1" />
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
              className="max-w-[11rem] truncate rounded-md border border-zinc-600 bg-zinc-700 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="">Precio de lista</option>
              {specialCustomers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => void handleRefreshRemote()}
            disabled={refreshing}
            title="Actualizar catálogo y datos remotos"
            className="rounded-md px-2 py-1 text-xs text-zinc-600 hover:text-zinc-300 transition-colors disabled:opacity-40"
          >
            {refreshing ? '…' : '↺'}
          </button>
          <button
            type="button"
            onClick={onCloseShift}
            className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-1.5 text-xs text-red-400 hover:border-red-700/70 hover:text-red-300 transition-colors"
          >
            Cerrar caja
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          <div className="flex h-full w-full gap-5 px-6 py-5">

            {/* ━━━ LEFT COLUMN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div className="flex flex-1 flex-col min-w-0 gap-4">

              {/* Page title */}
              <h1 className="text-base font-semibold text-zinc-100 shrink-0">Área de Venta</h1>

              {/* Hero scan input + manual toggle */}
              <div className="shrink-0 flex gap-2">
                <form onSubmit={handleHeroSubmit} className="flex-1 min-w-0">
                  <div className={`flex h-14 items-center gap-3 rounded-xl border bg-zinc-800 px-4 transition-colors focus-within:border-emerald-600 ${heroError ? 'border-red-900/70' : 'border-zinc-700'}`}>
                    <span className="shrink-0 text-zinc-600"><IconScan /></span>
                    <input
                      ref={heroInputRef}
                      type="text"
                      inputMode="numeric"
                      value={heroInput}
                      onChange={handleHeroChange}
                      placeholder="Escaneá el ticket de la balanza"
                      data-barcode-input="true"
                      autoFocus
                      className="min-w-0 flex-1 bg-transparent text-base text-zinc-100 placeholder-zinc-600 focus:outline-none"
                    />
                    {scanFlash ? (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-emerald-400 animate-pulse">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        <span className="max-w-[8rem] truncate">{scanFlash}</span>
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                        Lector listo
                      </span>
                    )}
                  </div>
                  {heroError && (
                    <p className="mt-1.5 px-1 text-xs text-red-400">{heroError}</p>
                  )}
                </form>

                {/* Manual PLU button — mismo alto que el hero input */}
                <button
                  type="button"
                  onClick={() => setShowManualPanel(v => !v)}
                  title="Ingresar producto manualmente por PLU y precio"
                  className={`h-14 shrink-0 rounded-xl border px-4 text-sm font-medium transition-all active:scale-95 ${
                    showManualPanel
                      ? 'border-emerald-700 bg-zinc-700 text-zinc-100'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5 3 12l3.75 4.5m6.75-9L17.25 12l-3.75 4.5M11.25 3l-1.5 18" />
                    </svg>
                    <span>Manual</span>
                  </span>
                </button>
              </div>

              {/* Manual PLU panel */}
              {showManualPanel && (
                <div className="shrink-0 rounded-xl border border-zinc-700 bg-zinc-800">
                  <ScanInput
                    onAddItem={addItem}
                    products={products}
                    specialPriceByProductId={specialPriceByProductId}
                  />
                </div>
              )}

              {/* Cart section header */}
              <div className="flex items-center justify-between shrink-0">
                <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                  {cart.length > 0
                    ? `${cart.length} producto${cart.length !== 1 ? 's' : ''} en la venta`
                    : 'Sin productos'}
                </span>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={clearCart}
                    className="text-[11px] text-zinc-600 hover:text-red-400 transition-colors"
                  >
                    Vaciar
                  </button>
                )}
              </div>

              {/* Cart items — panel elevado para no fundirse con el fondo */}
              <div className="flex-1 min-h-0 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-800">
                <div className="h-full overflow-y-auto space-y-0.5 p-1">
                {cart.length === 0 ? (
                  <div className="flex h-48 flex-col items-center justify-center gap-3 text-zinc-600">
                    <svg className="h-10 w-10 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                    </svg>
                    <div className="text-center space-y-1">
                      <p className="text-sm text-zinc-600">Escaneá un producto para empezar</p>
                      <p className="text-xs text-zinc-700">
                        Sin lector o balanza → usá el botón{' '}
                        <span className="font-medium text-zinc-500">Manual</span>{' '}
                        para ingresar PLU y precio
                      </p>
                    </div>
                  </div>
                ) : (
                  cart.map(item => (
                    <div
                      key={item.localId}
                      className="group flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-zinc-700 transition-colors"
                    >
                      {/* PLU badge */}
                      {item.pluNumber ? (
                        <span className="w-9 shrink-0 rounded bg-zinc-700 px-1.5 py-0.5 text-center font-mono text-[10px] font-bold text-zinc-400 tabular-nums">
                          {item.pluNumber}
                        </span>
                      ) : (
                        <span className="w-9 shrink-0" />
                      )}

                      {/* Product info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate text-sm text-zinc-200" title={item.productName}>
                            {item.productName}
                          </span>
                          {item.manualEntry && (
                            <span className="shrink-0 rounded bg-orange-900/50 px-1 py-0.5 text-[9px] text-orange-300">
                              manual
                            </span>
                          )}
                          {item.priceDiscrepancy && (
                            <span
                              className="shrink-0 rounded bg-red-900/60 px-1 py-0.5 text-[9px] text-red-300"
                              title="El precio del ticket no coincide con el catálogo. Verificar la balanza."
                            >
                              ⚠ precio
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] text-zinc-500 tabular-nums">
                          {item.unit === 'unit'
                            ? `${Math.round(item.weightKg)} u. × ${formatARS(item.unitPrice)}/u.`
                            : `${formatKg(item.weightKg)} @ ${formatARS(item.unitPrice)}/kg`}
                        </p>
                      </div>

                      {/* Subtotal */}
                      <span className="shrink-0 font-mono text-sm font-semibold text-zinc-100 tabular-nums">
                        {formatARS(item.subtotal)}
                      </span>

                      {/* Remove */}
                      <button
                        type="button"
                        onClick={() => removeItem(item.localId)}
                        className="shrink-0 flex items-center rounded px-1.5 py-1 text-zinc-400 hover:bg-red-950/40 hover:text-red-400 transition-colors"
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
              <div className="flex flex-col flex-1 rounded-xl border border-zinc-700 bg-zinc-800 overflow-hidden shadow-xl">

                {/* Panel header */}
                <div className="border-b border-zinc-700 bg-zinc-700/40 px-5 py-4 shrink-0">
                  <h2 className="text-sm font-semibold text-zinc-100">Total de la Venta</h2>
                </div>

                {/* Summary rows */}
                <div className="flex-1 space-y-2 px-5 py-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500">Subtotal</span>
                    <span className="font-mono text-sm text-zinc-300 tabular-nums">{formatARS(cartTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500">Descuento</span>
                    <span className="font-mono text-sm text-zinc-600 tabular-nums">$0</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400 font-medium">Total</span>
                    <span className="font-mono text-sm text-zinc-300 tabular-nums">{formatARS(cartTotal)}</span>
                  </div>
                </div>

                {/* Big total + cobrar */}
                <div className="shrink-0 space-y-4 border-t border-zinc-700 px-5 pb-5 pt-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-1.5">
                      TOTAL
                    </p>
                    <p className="font-mono text-5xl font-bold leading-none text-zinc-100 tabular-nums">
                      {formatARS(cartTotal)}
                    </p>
                  </div>

                  {error && (
                    <div className="rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2">
                      <p className="text-xs text-red-300">{error}</p>
                    </div>
                  )}
                  {lastSaleId && (
                    <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/30 px-3 py-2">
                      <p className="text-xs text-emerald-300">✓ Venta confirmada</p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={openPaymentModal}
                    disabled={loading || cart.length === 0}
                    className="flex h-14 w-full items-center justify-center rounded-xl bg-emerald-500 text-lg font-semibold text-white transition-all hover:bg-emerald-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    {loading ? (
                      'Procesando…'
                    ) : (
                      <span>Cobrar</span>
                    )}
                  </button>
                </div>
              </div>

              {/* DevTools — en modo dev queda abajo del panel */}
              <DevToolsPanel onDataChanged={refreshBalance} />
            </div>

          </div>
        </div>
      </div>

      {/* ━━━ MENU OVERLAY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {showMenuPanel && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={closeMenu}
          />
          {/* Panel */}
          <div className="fixed left-16 top-0 z-50 flex h-full w-64 flex-col border-r border-zinc-700 bg-zinc-800 shadow-2xl">
            <div className="shrink-0 border-b border-zinc-700 px-4 py-4">
              <p className="text-sm font-semibold text-zinc-100">Opciones</p>
              {storeName && (
                <p className="mt-0.5 text-xs text-zinc-500">
                  {storeName} · Turno {shiftLabel}
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto py-1.5">
              <MenuAction emoji="🏷️" label="Catálogo" onClick={() => { setShowProductsModal(true); closeMenu() }} />
              {onViewOrders && (
                <MenuAction emoji="📦" label="Pedidos" onClick={() => { onViewOrders(); closeMenu() }} />
              )}
              {onViewDebts && (
                <MenuAction emoji="📒" label="Fiados" onClick={() => { onViewDebts(); closeMenu() }} />
              )}
              {onViewSpecialCustomers && (
                <MenuAction emoji="👤" label="Clientes especiales" onClick={() => { onViewSpecialCustomers(); closeMenu() }} />
              )}
              <MenuAction emoji="⚖️" label="Conteo de stock" onClick={() => { setShowStockCountModal(true); closeMenu() }} />
              <MenuAction emoji="💰" label="Liquidación / pago de sueldo" onClick={() => { setShowSalaryModal(true); closeMenu() }} />
              <MenuAction emoji="📋" label="Ver gastos del turno" onClick={() => { setShowExpenseListModal(true); closeMenu() }} />
              <MenuAction emoji="↺" label={refreshing ? 'Actualizando…' : 'Actualizar datos'} onClick={() => { void handleRefreshRemote(); closeMenu() }} muted={refreshing} />
              {SHOW_ATTENDANCE_UI && (
                <MenuAction emoji="✓" label="Asistencia" onClick={() => { setShowAttendanceModal(true); closeMenu() }} />
              )}
            </div>

            <div className="shrink-0 border-t border-zinc-800 py-1.5">
              {onReturnToHub && (
                <MenuAction emoji="←" label="Volver al hub admin" onClick={() => { onReturnToHub(); closeMenu() }} />
              )}
              <MenuAction emoji="⏹" label="Cerrar caja" onClick={() => { onCloseShift(); closeMenu() }} danger />
              <MenuAction emoji="→" label="Cerrar sesión" onClick={() => { onLogout(); closeMenu() }} />
            </div>
          </div>
        </>
      )}

      {/* ━━━ MODALS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      {showPaymentModal && cart.length > 0 && (
        <PaymentModal
          total={cartTotal}
          onConfirm={handleConfirmSale}
          onFiado={handleOpenFiado}
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
          onRegistered={() => setShowExpenseModal(false)}
          onCancel={() => setShowExpenseModal(false)}
        />
      )}

      {showCashInjectModal && (
        <CashInjectModal
          onSaved={refreshBalance}
          onCancel={() => setShowCashInjectModal(false)}
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

    </div>
  )
}
