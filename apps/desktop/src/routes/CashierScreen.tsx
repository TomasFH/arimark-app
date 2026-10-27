import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import DevToolsPanel from '../components/DevToolsPanel'
import ScanInput from '../components/ScanInput'
import OpenPriceModal from '../components/OpenPriceModal'
import PaymentModal, { paymentMethodFromFunctionKey, type PaymentMethod } from '../components/PaymentModal'
import CatalogAssignField from '../components/CatalogAssignField'
import BagsPanel from '../components/BagsPanel'
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
import OrderFormModal from '../components/OrderFormModal'
import { seedOrderCreateDraft } from '../lib/orderCreateDraft'
import { clearOrderChargeDraft } from '../lib/orderChargeDraft'
import DebtModal from '../components/DebtModal'
import ChangePasswordModal from '../components/ChangePasswordModal'
import { BrandMark, Button, ListRow, Modal, ScreenHeader, cx } from '../components/ui'
import type { SaleItemDraft, SalePaymentPayload, ShiftInfo, SessionInfo, ProductRow, SpecialCustomerRow } from '../types/hw-api'
import { formatARS, formatKg } from '../lib/datetime'
import { applyColorScheme, type ColorScheme } from '../lib/theme'
import { useBarcodeScanner } from '../lib/useBarcodeScanner'
import { parseKretzBarcode, centsToARS, normalizeCashDiscountRule, parseCashDiscountSchedule, resolveCashDiscountRule, weekdayInTimeZone, type CashDiscountBlock } from '@carniceria/shared'
import { applySpecialUnitPrice, assignCatalogProduct, buildItemFromBarcode, resolveScannedItem, type OpenPriceRequest } from '../lib/barcodeItem'
import { addBagToCart, collapseDuplicateBags, removeBagQuantity } from '../lib/bags'
import { useCatalogSyncReload } from '../lib/useCatalogSyncReload'
import CatalogQuickSearch from '../components/CatalogQuickSearch'

interface Props {
  session: SessionInfo
  shift: ShiftInfo
  onLogout: () => void
  onCloseShift: () => void
  onReturnToHub?: () => void
  onViewDebts?: () => void
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

/**
 * Selector de cliente especial en el header del POS (aplica precios acordados al escanear / Manual).
 * Oculto: el ticket se controla a mano. La ficha sigue en el hub de admin.
 * Para reactivar: `true`. Ver PLAN.md FEAT-SPECIAL-POS-SELECTOR-01.
 */
const SHOW_SPECIAL_CUSTOMER_POS_SELECTOR = false

/** Asistencia pausada: reactivar con `true`. No borrar AttendanceModal. */
const SHOW_ATTENDANCE_UI = false

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function altShortcutAction(event: KeyboardEvent): 'venta' | 'pedido' | 'vales' | 'gastos' | 'turno' | 'ingreso' | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  const key = event.key.toLowerCase()
  if (event.code === 'Digit1' || key === '1') return 'venta'
  if (event.code === 'Digit2' || key === '2') return 'pedido'
  if (event.code === 'Digit3' || key === '3') return 'vales'
  if (event.code === 'Digit4' || key === '4') return 'gastos'
  if (event.code === 'Digit5' || key === '5') return 'turno'
  if (event.code === 'KeyI' || key === 'i' || key === 'í') return 'ingreso'
  return null
}

interface CartItem extends SaleItemDraft {
  localId: string
}

// ---------------------------------------------------------------------------
// Inline SVG icons. Rail: stroke 1.5. Ítems del menú lateral: stroke 1.8.
// ---------------------------------------------------------------------------

const IconMenu = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
  </svg>
)

const IconOrder = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12m-12 5.25h12m-12 5.25h7.5M3.75 6.75h.008v.008H3.75V6.75Zm0 5.25h.008v.008H3.75v-.008Zm0 5.25h.008v.008H3.75v-.008Z" />
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
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75h19.5M4.5 15.75l4.5-7.5 3 4.5 3.75-6 3.75 9" />
  </svg>
)

const IconCashInject = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v9m0 0-3.75-3.75M12 13.5l3.75-3.75M3.75 19.5h16.5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 16.5h13.5v2.25a.75.75 0 0 1-.75.75H6a.75.75 0 0 1-.75-.75V16.5Z" />
  </svg>
)

const IconGear = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

const IconCebo = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M8.25 6.75h7.5M6 10.5h12M7.5 14.25h9M9 18h6" />
  </svg>
)

const IconX = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
  </svg>
)

const IconCatalog = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
  </svg>
)

const IconOrders = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 3h6m-6 3h3.75M9.75 3.75h4.5A1.5 1.5 0 0 1 15.75 5.25V6h1.5A1.5 1.5 0 0 1 18.75 7.5v12a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 6.75 6H8.25V5.25a1.5 1.5 0 0 1 1.5-1.5Z" />
  </svg>
)

const IconFiado = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
  </svg>
)

const IconStock = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
  </svg>
)

const IconPayroll = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" />
  </svg>
)

const IconCashDiscount = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m18.75 5.25-13.5 13.5" />
    <circle cx="7.5" cy="7.5" r="2.25" />
    <circle cx="16.5" cy="16.5" r="2.25" />
  </svg>
)

const IconShiftExpenses = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 14.25 15 8.25m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0c1.1.128 1.907 1.077 1.907 2.185Z" />
  </svg>
)

const IconAttendance = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
  </svg>
)

const IconHub = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
  </svg>
)

const IconLock = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
  </svg>
)

const IconKey = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
  </svg>
)

const IconLogout = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
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

const SHORTCUT_GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Venta',
    rows: [
      ['F1', 'Efectivo'],
      ['F2', 'Débito'],
      ['F3', 'Billetera virtual'],
      ['F9', 'Crédito'],
      ['F5', 'Dividir el pago'],
      ['F6', 'Carga manual'],
      ['F7', 'Bolsas'],
      ['Ctrl+F', 'Buscar en el catálogo'],
      ['Supr', 'Quitar la línea marcada'],
      ['Alt+1', 'Venta'],
      ['Alt+2', 'Pedido'],
      ['Alt+3', 'Vales'],
      ['Alt+4', 'Gastos'],
      ['Alt+5', 'Turno'],
      ['Alt+I', 'Ingreso'],
    ],
  },
  {
    title: 'Bolsas abiertas',
    rows: [
      ['Derecha', 'Sumar una'],
      ['Izquierda', 'Sacar una'],
      ['Escape', 'Cerrar la lista'],
    ],
  },
  {
    title: 'Pedido',
    rows: [
      ['Flechas', 'Elegir producto'],
      ['Enter', 'Agregar el producto'],
      ['Ctrl+Enter', 'Ir a buscar'],
      ['Supr', 'Quitar la línea'],
    ],
  },
]

function ShortcutList() {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-3">
      {SHORTCUT_GROUPS.map((group, index) => (
        <section
          key={group.title}
          className={cx(
            'min-w-0 space-y-1.5',
            index > 0 && 'sm:border-l sm:border-line sm:pl-3',
          )}
        >
          <h3 className="text-xs font-semibold text-muted">{group.title}</h3>
          <ul className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-1">
            {group.rows.map(([key, label]) => (
              <li key={key} className="col-span-2 grid grid-cols-subgrid items-center">
                <span className="w-fit justify-self-start whitespace-nowrap rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[10px] text-ink">{key}</span>
                <span className="min-w-0 text-sm text-ink">{label}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
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

function MenuSection({
  title,
  divided = false,
  children,
}: {
  title: string
  divided?: boolean
  children: ReactNode
}) {
  return (
    <section className={cx('min-w-0 pb-2', divided && 'border-t border-line')}>
      <h2
        className={cx(
          'min-w-0 truncate px-3 pb-2 text-sm font-normal text-muted',
          divided ? 'pt-3' : 'pt-2.5',
        )}
        title={title}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

function menuLeading(icon: ReactNode) {
  return <span className="text-muted">{icon}</span>
}

/** Dos columnas que miden su contenido. No empareja una sección alta con una corta. */
function MenuColumns({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid grid-cols-2 items-start divide-x divide-line">
      <div className="min-w-0">{left}</div>
      <div className="min-w-0">{right}</div>
    </div>
  )
}

function PosSettingsPage({
  zoomFactor,
  colorScheme,
  onBack,
  onZoom,
  onScheme,
  onPassword,
}: {
  zoomFactor: number
  colorScheme: ColorScheme
  onBack: () => void
  onZoom: (factor: number) => void
  onScheme: (scheme: ColorScheme) => void
  onPassword: () => void
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-muted transition-colors hover:bg-hover hover:text-ink"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Ajustes
      </button>

      <div className="space-y-4 px-4 py-3">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-ink">Tamaño</p>
            <span className="font-mono text-sm font-semibold tabular-nums text-ink">
              {Math.round(zoomFactor * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onZoom(zoomFactor - 0.1)}
              disabled={zoomFactor <= 0.6}
              title="Reducir tamaño"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink hover:bg-hover disabled:opacity-30"
            >
              −
            </button>
            <div className="relative h-1.5 flex-1 rounded-full bg-hover">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-accent"
                style={{ width: `${((zoomFactor - 0.6) / 1.4) * 100}%` }}
              />
            </div>
            <button
              type="button"
              onClick={() => onZoom(zoomFactor + 0.1)}
              disabled={zoomFactor >= 2}
              title="Aumentar tamaño"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink hover:bg-hover disabled:opacity-30"
            >
              +
            </button>
          </div>
          {zoomFactor !== 1 && (
            <button
              type="button"
              onClick={() => onZoom(1)}
              className="mt-2 text-[10px] text-muted hover:text-ink"
            >
              Restablecer al 100%
            </button>
          )}
        </div>

        <div className="border-t border-line pt-3">
          <p className="mb-2 text-xs font-medium text-ink">Apariencia</p>
          <div className="flex rounded-xl bg-hover p-1">
            <button
              type="button"
              onClick={() => onScheme('light')}
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
              onClick={() => onScheme('dark')}
              aria-pressed={colorScheme === 'dark'}
              className={cx(
                'flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors',
                colorScheme === 'dark' ? 'bg-panel text-ink shadow-[0_1px_2px_rgba(28,28,30,0.12)]' : 'text-muted hover:text-ink',
              )}
            >
              Oscuro
            </button>
          </div>
        </div>
      </div>

      <div className="border-t border-line">
        <ListRow
          dense
          title="Cambiar contraseña"
          leading={menuLeading(<IconKey />)}
          onClick={onPassword}
        />
      </div>
    </div>
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
  const [showOrderForm, setShowOrderForm] = useState(false)
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
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [debtLoading, setDebtLoading] = useState(false)
  const [debtError, setDebtError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastSaleId, setLastSaleId] = useState<string | null>(null)
  const [cashInHand, setCashInHand] = useState<number | null>(null)
  const [scanFlash, setScanFlash] = useState<string | null>(null)
  const [openPriceScan, setOpenPriceScan] = useState<OpenPriceRequest | null>(null)

  /** Pedido activo inyectado en el POS (para marcar entregado al confirmar la venta) */
  const [activeOrder, setActiveOrder] = useState<{
    orderId: string
    customerName: string
    depositAmount: number
    depositPayments: import('../types/hw-api').DepositPayment[]
  } | null>(null)
  const [storeName, setStoreName] = useState<string | null>(null)
  const [specialCustomers, setSpecialCustomers] = useState<SpecialCustomerRow[]>([])
  const [specialCustomerId, setSpecialCustomerId] = useState<string | null>(null)
  const [specialPriceByProductId, setSpecialPriceByProductId] = useState<Record<string, number>>({})
  const scanFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── New UI state ───────────────────────────────────────────────────────────
  const [showManualPanel, setShowManualPanel] = useState(false)
  const [manualFocusNonce, setManualFocusNonce] = useState(0)
  const [paymentInitialMethod, setPaymentInitialMethod] = useState<PaymentMethod | undefined>(undefined)
  const [paymentInitialSplit, setPaymentInitialSplit] = useState(false)
  const [selectedLine, setSelectedLine] = useState(0)
  const [showMenuPanel, setShowMenuPanel] = useState(false)
  const [menuPage, setMenuPage] = useState<'root' | 'settings'>('root')
  const [zoomFactor, setZoomFactor] = useState(1)
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
      setZoomFactor(r.data.zoomFactor)
      applyColorScheme(r.data.colorScheme)
    })
    return window.hw.onUiSettingsChanged(settings => {
      setColorScheme(settings.colorScheme)
      setZoomFactor(settings.zoomFactor)
      applyColorScheme(settings.colorScheme)
    })
  }, [])

  async function handleSetZoom(next: number): Promise<void> {
    const clamped = Math.max(0.6, Math.min(2, Math.round(next * 10) / 10))
    const r = await window.hw.setUiSettings({ zoomFactor: clamped })
    if (r.ok) setZoomFactor(r.data.zoomFactor)
  }

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
  const markedIndex = cart.length === 0 ? -1 : Math.min(Math.max(selectedLine, 0), cart.length - 1)
  const pendingCatalog = cart.some(item => !item.productId)
  /** Monto neto a cobrar ahora: descuenta la seña del pedido activo */
  const cartNetTotal = Math.max(0, cartTotal - (activeOrder?.depositAmount ?? 0))
  const hasManualItems = cart.some(item => item.manualEntry)

  const addItem = useCallback((item: SaleItemDraft) => {
    // Precio especial manual en kg: el ítem ya trae el kilo que escribió la cajera.
    const keepTypedKilo = item.manualEntry === true && item.priceDiscrepancy === true && item.unit === 'kg'
    const special = !keepTypedKilo && item.productId ? specialPriceByProductId[item.productId] : undefined
    const priced = applySpecialUnitPrice(item, special)
    setCart(prev => [...prev, { ...priced, localId: `tmp-${crypto.randomUUID()}` }])
    setError('')
    setLastSaleId(null)
  }, [specialPriceByProductId])

  const railPanelOpen = showValesModal || showExpenseModal || showSalesModal
  const anyModalOpen = showPaymentModal || showProductsModal || showOrderForm
    || showCashInjectModal || showCeboModal || showCashDiscountModal
    || railPanelOpen
    || openPriceScan != null
  const saleOverlayOpen = anyModalOpen
    || showSalaryModal || showStockCountModal || showSettleDebtModal
    || showExpenseListModal || showDebtModal || showChangePassword
    || showLogoutConfirm || showAttendanceModal || showShortcuts

  useEffect(() => {
    if (!isActive) setShowOrderForm(false)
  }, [isActive])

  const flashScannedName = useCallback((name: string) => {
    if (scanFlashTimerRef.current) clearTimeout(scanFlashTimerRef.current)
    setScanFlash(name)
    scanFlashTimerRef.current = setTimeout(() => setScanFlash(null), 2000)
  }, [])

  const handleGlobalScan = useCallback((digits: string) => {
    const parsed = parseKretzBarcode(digits)
    if (!parsed) return
    const plu = parseInt(parsed.pluNumber, 10)
    const product = products.find(p => p.pluNumber === plu)
    const totalARS = centsToARS(parsed.totalCents)
    const special = product?.id ? specialPriceByProductId[product.id] : undefined
    const resolved = resolveScannedItem(plu, totalARS, product, special)
    if (resolved.status === 'needsPrice') {
      setOpenPriceScan(resolved.request)
      return
    }
    addItem(resolved.item)
    flashScannedName(resolved.item.productName)
  }, [products, addItem, specialPriceByProductId, flashScannedName])

  function confirmOpenPrice(unitPrice: number): void {
    if (!openPriceScan) return
    const item = buildItemFromBarcode(
      openPriceScan.product.pluNumber,
      openPriceScan.totalARS,
      openPriceScan.product,
      unitPrice,
    )
    setOpenPriceScan(null)
    addItem(item)
    flashScannedName(item.productName)
  }

  useBarcodeScanner({ onScan: handleGlobalScan, disabled: anyModalOpen || !isActive })

  function removeItem(localId: string) {
    setCart(prev => prev.filter(i => i.localId !== localId))
  }

  function moveCartMark(delta: number) {
    setSelectedLine(current => {
      if (cart.length === 0) return 0
      const base = Math.min(Math.max(current, 0), cart.length - 1)
      return Math.min(cart.length - 1, Math.max(0, base + delta))
    })
  }

  function removeMarkedLine() {
    if (cart.length === 0) return
    const index = Math.min(Math.max(selectedLine, 0), cart.length - 1)
    const item = cart[index]
    if (!item) return
    removeItem(item.localId)
  }

  function assignItemProduct(localId: string, product: ProductRow) {
    setCart(prev => prev.map(item => (
      item.localId === localId
        ? { ...assignCatalogProduct(item, product), localId: item.localId }
        : item
    )))
  }

  useEffect(() => {
    const bagIds = new Set(products.filter(product => product.category === 'bags').map(product => product.id))
    setCart(prev => collapseDuplicateBags(prev, bagIds))
  }, [products, cart])

  function addBag(product: ProductRow, quantity: number) {
    setCart(prev => addBagToCart(prev, product, quantity, `tmp-${crypto.randomUUID()}`))
    setError('')
    setLastSaleId(null)
  }

  function removeBag(productId: string, quantity: number) {
    setCart(prev => removeBagQuantity(prev, productId, quantity))
  }

  function saleItemsFromCart() {
    const items: Array<{ productId: string; quantity: number; unitPrice: number; subtotal: number }> = []
    for (const item of cart) {
      if (!item.productId) return null
      items.push({
        productId: item.productId,
        quantity: item.unit === 'unit' ? Math.round(item.weightKg) : item.weightKg,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal,
      })
    }
    return items
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

  // ── Sale handlers ──────────────────────────────────────────────────────────

  async function handleConfirmSale(
    payments: SalePaymentPayload[],
    notes?: string,
    discountPercent?: number,
    discountException?: boolean,
  ) {
    if (cart.length === 0) {
      setError('Agregá al menos un producto antes de confirmar.')
      return
    }
    const items = saleItemsFromCart()
    if (!items) {
      setError('Asigná un producto del catálogo a cada ticket.')
      return
    }
    setLoading(true)
    setError('')
    setShowPaymentModal(false)
    try {
      const result = await window.hw.createSale({
        items,
        payments,
        manualEntry: hasManualItems,
        notes,
        orderId: activeOrder?.orderId,
        depositCredit: activeOrder?.depositAmount && activeOrder.depositAmount > 0 ? activeOrder.depositAmount : undefined,
        discountPercent,
        discountException,
      })
      if (!result.ok) {
        setError(result.error ?? 'Error al procesar la venta.')
        return
      }
      setLastSaleId(result.data.saleId)
      if (activeOrder?.orderId) clearOrderChargeDraft(activeOrder.orderId)
      setCart([])
      setActiveOrder(null)
      if (showManualPanel) setManualFocusNonce(nonce => nonce + 1)
      refreshBalance()
    } catch {
      setError('Error de comunicación. Reintentar.')
    } finally {
      setLoading(false)
    }
  }

  function openPaymentModal(method?: PaymentMethod | 'split') {
    if (cart.some(item => !item.productId)) {
      setError('Asigná un producto del catálogo a cada ticket.')
      return
    }
    setError('')
    setLastSaleId(null)
    setPaymentInitialMethod(method === 'split' ? undefined : method)
    setPaymentInitialSplit(method === 'split')
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
    newCustomer?: { name: string; phone?: string }
    initialPayment: number
    paymentMethods: SalePaymentPayload[]
    dueDate?: string
    notes?: string
  }) {
    if (cart.length === 0) return
    const items = saleItemsFromCart()
    if (!items) {
      setDebtError('Asigná un producto del catálogo a cada ticket.')
      return
    }
    setDebtLoading(true)
    setDebtError(null)
    try {
      const saleResult = await window.hw.createSale({
        items,
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

  function closeMenu() {
    setShowMenuPanel(false)
    setMenuPage('root')
  }

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

  const onSaleKeyRef = useRef<(event: KeyboardEvent) => void>(() => {})
  onSaleKeyRef.current = (event: KeyboardEvent) => {
    const method = paymentMethodFromFunctionKey(event.key)
    if (method) event.preventDefault()
    if (method) {
      if (event.repeat || saleOverlayOpen || showMenuPanel || cart.length === 0) return
      openPaymentModal(method)
      return
    }

    if (event.key === 'F5' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault()
      if (event.repeat || saleOverlayOpen || showMenuPanel || cart.length === 0) return
      openPaymentModal('split')
      return
    }

    if (event.key === 'F6' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault()
      if (event.repeat || saleOverlayOpen || showMenuPanel) return
      setShowManualPanel(open => !open)
      return
    }

    if (isTextEntryTarget(event.target)) return

    const alt = altShortcutAction(event)
    if (alt) {
      if (event.repeat || saleOverlayOpen) return
      event.preventDefault()
      if (alt === 'venta') {
        setShowMenuPanel(false)
        return
      }
      if (alt === 'pedido') {
        setShowMenuPanel(false)
        seedOrderCreateDraft(session.storeId ?? '')
        setShowOrderForm(true)
        return
      }
      if (alt === 'vales') {
        setShowMenuPanel(false)
        setShowValesModal(true)
        return
      }
      if (alt === 'gastos') {
        setShowMenuPanel(false)
        setShowExpenseModal(true)
        return
      }
      if (alt === 'turno') {
        setShowMenuPanel(false)
        setShowSalesModal(true)
        return
      }
      setShowCashInjectModal(true)
      closeMenu()
      return
    }

    const plain = !event.altKey && !event.ctrlKey && !event.metaKey
    if (!plain || saleOverlayOpen || showMenuPanel) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      moveCartMark(1)
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      moveCartMark(-1)
      return
    }
    if (event.key === 'Delete') {
      event.preventDefault()
      removeMarkedLine()
    }
  }

  useEffect(() => {
    if (!isActive) return
    function onKey(event: KeyboardEvent) {
      onSaleKeyRef.current(event)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isActive])

  const railActive: 'menu' | 'venta' | 'pedido' | 'vales' | 'gastos' | 'turno' = showMenuPanel
    ? 'menu'
    : showOrderForm
      ? 'pedido'
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
          icon={<IconOrder />}
          label="Pedido"
          onClick={() => {
            setShowMenuPanel(false)
            seedOrderCreateDraft(session.storeId ?? '')
            setShowOrderForm(true)
          }}
          active={railActive === 'pedido'}
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

        <button
          type="button"
          onClick={() => setShowShortcuts(true)}
          title="Atajos"
          aria-label="Atajos"
          className="mb-2 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-raised text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" d="M12 11v6" />
            <path strokeLinecap="round" d="M12 7.5h.01" />
          </svg>
        </button>
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

              <div className="flex shrink-0 items-center justify-between gap-3 min-w-0">
                <p className="text-base font-semibold text-ink">Área de Venta</p>
                <div className="flex min-w-0 items-center gap-3">
                  {scanFlash ? (
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-success">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                      <span className="truncate" title={scanFlash}>{scanFlash}</span>
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                      <span className="h-1.5 w-1.5 rounded-full bg-line" />
                      Lector listo
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowManualPanel(v => !v)}
                    title="Cargar un producto por nombre o PLU"
                    aria-keyshortcuts="F6"
                    className={cx(
                      'h-9 shrink-0 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors',
                      showManualPanel
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line bg-panel text-ink hover:bg-hover',
                    )}
                  >
                    Manual <span className="font-medium text-muted" aria-hidden>(F6)</span>
                  </button>
                </div>
              </div>

              {/* Manual PLU panel */}
              {showManualPanel && (
                <div className="shrink-0 rounded-xl border border-line bg-panel">
                  <ScanInput
                    onAddItem={addItem}
                    products={products}
                    specialPriceByProductId={specialPriceByProductId}
                    focusNonce={manualFocusNonce}
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
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_8px_24px_rgba(28,28,30,0.06)]">
                <div className="shrink-0 border-b border-line px-3 py-2">
                  <BagsPanel
                    products={products}
                    lines={cart}
                    onAdd={addBag}
                    onRemove={removeBag}
                    shortcuts={!saleOverlayOpen && !showMenuPanel}
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto space-y-0.5 p-1">
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
                  cart.map((item, index) => (
                    <div
                      key={item.localId}
                      data-cart-marked={index === markedIndex ? 'true' : undefined}
                      className={cx(
                        'group flex items-center gap-3 min-w-0 rounded-xl px-3 py-3 transition-colors',
                        index === markedIndex ? 'bg-accent-soft' : 'hover:bg-hover',
                      )}
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
                              title="El precio no coincide con la lista. La venta usa el precio del ticket."
                            >
                              precio
                            </span>
                          )}
                        </div>
                        {!item.productId && (
                          <CatalogAssignField
                            products={products}
                            onAssign={product => assignItemProduct(item.localId, product)}
                          />
                        )}
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

                  {pendingCatalog && (
                    <p className="text-xs text-danger">Asigná un producto del catálogo a cada ticket.</p>
                  )}
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
                    loading={loading}
                    disabled={cart.length === 0 || pendingCatalog}
                    onClick={openPaymentModal}
                    className="!h-14 w-full text-lg"
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
            className="fixed left-[calc(4rem+0.5rem)] top-2 z-50 h-auto max-h-[calc(100vh-1rem)] w-[min(28rem,calc(100vw-6rem))] overflow-y-auto rounded-xl border border-line bg-raised shadow-[0_8px_28px_rgba(28,28,30,0.16)]"
          >
            <div className="border-b border-line px-4 py-3">
              <p className="text-sm font-semibold text-ink">Opciones</p>
              {storeName && (
                <p className="mt-0.5 min-w-0 truncate text-xs text-muted" title={`${storeName} · Turno ${shiftLabel}`}>
                  {storeName} · Turno {shiftLabel}
                </p>
              )}
            </div>

            {menuPage === 'settings' ? (
              <PosSettingsPage
                zoomFactor={zoomFactor}
                colorScheme={colorScheme}
                onBack={() => setMenuPage('root')}
                onZoom={factor => { void handleSetZoom(factor) }}
                onScheme={scheme => { void handleColorScheme(scheme) }}
                onPassword={() => { setShowChangePassword(true); closeMenu() }}
              />
            ) : (
              <MenuColumns
                left={
                  <>
                    <MenuSection title="Caja">
                      <ListRow
                        dense
                        title="Ingreso"
                        leading={menuLeading(<IconCashInject />)}
                        onClick={() => { setShowCashInjectModal(true); closeMenu() }}
                      />
                      <ListRow
                        dense
                        title="Sebo"
                        leading={menuLeading(<IconCebo />)}
                        onClick={() => { setShowCeboModal(true); closeMenu() }}
                      />
                      <ListRow
                        dense
                        title="Saldar"
                        leading={menuLeading(<IconSettle />)}
                        onClick={() => { setShowSettleDebtModal(true); closeMenu() }}
                      />
                    </MenuSection>

                    <MenuSection title="Operación" divided>
                      <ListRow
                        dense
                        title="Stock"
                        leading={menuLeading(<IconStock />)}
                        onClick={() => { setShowStockCountModal(true); closeMenu() }}
                      />
                      <ListRow
                        dense
                        title="Liquidación"
                        leading={menuLeading(<IconPayroll />)}
                        onClick={() => { setShowSalaryModal(true); closeMenu() }}
                      />
                      <ListRow
                        dense
                        title="Desc. efectivo"
                        leading={menuLeading(<IconCashDiscount />)}
                        onClick={() => { setShowCashDiscountModal(true); closeMenu() }}
                      />
                      <ListRow
                        dense
                        title="Gastos del turno"
                        leading={menuLeading(<IconShiftExpenses />)}
                        onClick={() => { setShowExpenseListModal(true); closeMenu() }}
                      />
                      {SHOW_ATTENDANCE_UI && (
                        <ListRow
                          dense
                          title="Asistencia"
                          leading={menuLeading(<IconAttendance />)}
                          onClick={() => { setShowAttendanceModal(true); closeMenu() }}
                        />
                      )}
                    </MenuSection>
                  </>
                }
                right={
                  <>
                    <MenuSection title="Consultas">
                      <ListRow
                        dense
                        title="Catálogo"
                        leading={menuLeading(<IconCatalog />)}
                        onClick={() => { setShowProductsModal(true); closeMenu() }}
                      />
                      {onViewOrders && (
                        <ListRow
                          dense
                          title="Pedidos"
                          leading={menuLeading(<IconOrders />)}
                          onClick={() => { onViewOrders(); closeMenu() }}
                        />
                      )}
                      {onViewDebts && (
                        <ListRow
                          dense
                          title="Fiados"
                          leading={menuLeading(<IconFiado />)}
                          onClick={() => { onViewDebts(); closeMenu() }}
                        />
                      )}
                    </MenuSection>

                    <MenuSection title="Ajustes" divided>
                      <ListRow
                        dense
                        title="Ajustes"
                        leading={menuLeading(<IconGear />)}
                        onClick={() => setMenuPage('settings')}
                      />
                    </MenuSection>

                    <MenuSection title="Sesión" divided>
                      {onReturnToHub && (
                        <ListRow
                          dense
                          title="Hub"
                          leading={menuLeading(<IconHub />)}
                          onClick={() => { onReturnToHub(); closeMenu() }}
                        />
                      )}
                      <ListRow
                        dense
                        tone="danger"
                        title="Cerrar caja"
                        leading={<span className="text-danger"><IconLock /></span>}
                        onClick={() => { onCloseShift(); closeMenu() }}
                      />
                      <ListRow
                        dense
                        title="Cerrar sesión"
                        leading={menuLeading(<IconLogout />)}
                        onClick={() => { closeMenu(); setShowLogoutConfirm(true) }}
                      />
                    </MenuSection>
                  </>
                }
              />
            )}
          </div>
        </>
      )}

      {/* ━━━ MODALS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      {showPaymentModal && cart.length > 0 && (
        <PaymentModal
          itemTotal={cartTotal}
          initialMethod={paymentInitialMethod}
          initialSplit={paymentInitialSplit}
          depositAmount={activeOrder?.depositAmount ?? 0}
          depositDigitalAmount={
            activeOrder
              ? activeOrder.depositPayments
                .filter(p => p.method !== 'cash')
                .reduce((sum, p) => sum + p.amount, 0)
              : 0
          }
          cashDiscountRule={cashDiscountRule}
          products={products}
          cartLines={cart}
          onAddBag={addBag}
          onRemoveBag={removeBag}
          onConfirm={handleConfirmSale}
          onFiado={activeOrder ? undefined : handleOpenFiado}
          onClose={() => {
            setShowPaymentModal(false)
            setPaymentInitialMethod(undefined)
            setPaymentInitialSplit(false)
          }}
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
        <ExpenseListModal
          onClose={() => setShowExpenseListModal(false)}
          onChanged={refreshBalance}
        />
      )}

      {showSalesModal && (
        <ShiftSalesModal onClose={() => setShowSalesModal(false)} onCancelled={refreshBalance} />
      )}

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}

      {openPriceScan && (
        <OpenPriceModal
          product={openPriceScan.product}
          ticketTotal={openPriceScan.totalARS}
          onClose={() => setOpenPriceScan(null)}
          onConfirm={confirmOpenPrice}
        />
      )}

      <Modal
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        title="Atajos"
        size="lg"
      >
        <ShortcutList />
      </Modal>

      {isActive && showOrderForm && (
        <OrderFormModal
          open
          mode="create"
          onClose={() => setShowOrderForm(false)}
          onSaved={() => setShowOrderForm(false)}
          showStoreFilter={false}
          hoursStoreId={session.storeId ?? ''}
          defaultStoreId={session.storeId ?? ''}
        />
      )}

      <Modal
        open={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        title="Cerrar sesión"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowLogoutConfirm(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setShowLogoutConfirm(false)
                onLogout()
              }}
            >
              Cerrar sesión igual
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          Hay un turno abierto. La caja sigue abierta y quien sigue no va a poder abrir la suya hasta cerrar este turno.
        </p>
      </Modal>

      <CatalogQuickSearch storeId={session.storeId ?? null} />

    </div>
  )
}
