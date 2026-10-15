/**
 * Hub de administración — punto de entrada del rol admin.
 * Grid de 2 columnas con accesos directos a cada módulo.
 */
import { useState, useEffect, useRef, type ReactNode } from 'react'
import type { SessionInfo, InitStatus } from '../types/hw-api'
import AttendanceModal from './AttendanceModal'
import StockCountModal from './StockCountModal'
import { AdminAccountMenu, GearIcon } from '../components/AdminSectionHeader'
import { BrandMark, SectionLabel } from '../components/ui'

/** Asistencia pausada: reactivar con `true`. No borrar AttendanceModal. */
const SHOW_ATTENDANCE_UI = false

interface Props {
  session: SessionInfo
  initStatus: InitStatus
  onGoToAdminPanel: () => void
  onGoToCashier: () => void
  onGoToStaff: () => void
  onGoToStoreManagement: () => void
  onGoToDebts: () => void
  onGoToSpecialCustomers: () => void
  onGoToOrders: () => void
  onGoToHistory: () => void
  onGoToProviders: () => void
  onGoToStockCounts: () => void
  onLogout: () => void
}

function IconWell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
      {children}
    </div>
  )
}

const ICONS = {
  gear: <GearIcon />,
  store: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 10.5 5.5 5h13L20 10.5M5 10.5V19h14v-8.5M9 19v-5h6v5" />
    </svg>
  ),
  people: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 19v-1a3.5 3.5 0 0 0-2.5-3.3M16.5 7.2a2.5 2.5 0 0 1 0 4.6" />
    </svg>
  ),
  ledger: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V4Z" />
      <path strokeLinecap="round" d="M9 8h7M9 12h7M9 16h4" />
    </svg>
  ),
  person: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 19v-1a4 4 0 0 0-4-4h-4a4 4 0 0 0-4 4v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    </svg>
  ),
  package: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 7.5 12 4l7.5 3.5v9L12 20l-7.5-3.5v-9Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16M4.5 7.5 12 11l7.5-3.5" />
    </svg>
  ),
  truck: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h11v10H3V7Zm11 3h4l3 3v4h-7V10Z" />
      <circle cx="7.5" cy="18.5" r="1.5" />
      <circle cx="17.5" cy="18.5" r="1.5" />
    </svg>
  ),
  chart: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-8" />
    </svg>
  ),
  scale: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16M7 20h10M12 7l-6 3 2.2 4.5A3.2 3.2 0 0 0 12 16M12 7l6 3-2.2 4.5A3.2 3.2 0 0 1 12 16" />
    </svg>
  ),
  clipboard: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5h6M8 5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2M9 5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5" />
    </svg>
  ),
  check: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5 9.5 17 19 7" />
    </svg>
  ),
  cart: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h2l1.4 9.2A2 2 0 0 0 9.4 16H17a2 2 0 0 0 2-1.6L20 8H7" />
      <circle cx="9" cy="19" r="1.4" />
      <circle cx="17" cy="19" r="1.4" />
    </svg>
  ),
} as const

interface TileProps {
  icon: ReactNode
  label: string
  description: string
  onClick: () => void
  muted?: boolean
}

function Tile({ icon, label, description, onClick, muted }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-3 rounded-2xl border border-line bg-panel p-3.5 text-left transition-colors hover:bg-hover ${
        muted ? 'opacity-60 hover:opacity-90' : ''
      }`}
    >
      <IconWell>{icon}</IconWell>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink" title={label}>{label}</p>
        <p className="mt-0.5 truncate text-xs text-muted" title={description}>{description}</p>
      </div>
      <svg
        className="h-3.5 w-3.5 shrink-0 text-subtle transition-colors group-hover:text-muted"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
      </svg>
    </button>
  )
}

interface SubOption {
  icon: ReactNode
  label: string
  description: string
  onClick: () => void
}

interface GroupTileProps {
  icon: ReactNode
  label: string
  description: string
  options: SubOption[]
  expanded: boolean
  onToggle: () => void
}

function GroupTile({ icon, label, description, options, expanded, onToggle }: GroupTileProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (expanded) boxRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [expanded])
  return (
    <div ref={boxRef} className="rounded-2xl border border-line bg-panel transition-colors">
      <button
        type="button"
        onClick={onToggle}
        className={`group flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-hover ${
          expanded ? 'rounded-t-2xl' : 'rounded-2xl'
        }`}
        aria-expanded={expanded}
      >
        <IconWell>{icon}</IconWell>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink" title={label}>{label}</p>
          <p className="mt-0.5 truncate text-xs text-muted" title={description}>{description}</p>
        </div>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-subtle transition-transform duration-150 group-hover:text-muted ${
            expanded ? 'rotate-90' : ''
          }`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="flex flex-col gap-1.5 border-t border-line px-3 pb-3 pt-2">
          {options.map(opt => (
            <button
              key={opt.label}
              type="button"
              onClick={opt.onClick}
              className="group flex items-center gap-3 rounded-xl border border-line bg-raised p-2.5 text-left transition-colors hover:bg-hover"
            >
              <span className="shrink-0 text-accent">{opt.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-ink" title={opt.label}>{opt.label}</p>
                <p className="truncate text-[10px] text-muted" title={opt.description}>{opt.description}</p>
              </div>
              <svg
                className="ml-auto h-3 w-3 shrink-0 text-subtle transition-colors group-hover:text-muted"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AdminHubScreen({
  initStatus,
  onGoToAdminPanel,
  onGoToCashier,
  onGoToStaff,
  onGoToStoreManagement,
  onGoToDebts,
  onGoToSpecialCustomers,
  onGoToOrders,
  onGoToHistory,
  onGoToProviders,
  onGoToStockCounts,
  onLogout,
}: Props) {
  const [showAttendance, setShowAttendance] = useState(false)
  const [showStockCount, setShowStockCount] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<'stock' | null>(null)

  function toggleGroup(g: 'stock') {
    setExpandedGroup(v => (v === g ? null : g))
  }

  return (
    <div className="flex h-screen flex-col bg-app text-ink">
      <header className="relative flex items-center justify-between gap-3 border-b border-line bg-panel px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark size={32} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink" title={initStatus.businessName}>
              {initStatus.businessName}
            </p>
            <p className="truncate text-xs text-muted">Administrador</p>
          </div>
        </div>
        <AdminAccountMenu onLogout={onLogout} />
      </header>

      <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto w-full max-w-5xl space-y-5 px-8 py-5">
          <button
            type="button"
            onClick={onGoToCashier}
            className="group flex w-full items-center gap-4 rounded-2xl bg-accent p-4 text-left text-accent-fg shadow-[0_1px_2px_rgba(28,28,30,0.18)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_86%,black)]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-fg/15">
              {ICONS.cart}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Operar como cajera</p>
              <p className="mt-0.5 text-xs text-accent-fg/80">Acceder al punto de venta</p>
            </div>
            <svg className="h-4 w-4 shrink-0 opacity-80 transition-opacity group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
            </svg>
          </button>

          <div>
            <SectionLabel>Configuración</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <Tile icon={ICONS.gear} label="Panel de administración" description="Productos, precios y disponibilidad" onClick={onGoToAdminPanel} />
              <Tile icon={ICONS.store} label="Gestión de locales" description="Locales registrados en el sistema" onClick={onGoToStoreManagement} />
              <Tile icon={ICONS.people} label="Empleados" description="Cajeras y carniceros — cuentas, sueldos y liquidación" onClick={onGoToStaff} />
            </div>
          </div>

          <div>
            <SectionLabel>Operación</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <Tile icon={ICONS.ledger} label="Fiados" description="Deudas, cobros y cuentas corrientes" onClick={onGoToDebts} />
              <Tile icon={ICONS.person} label="Clientes especiales" description="Precios acordados por cliente" onClick={onGoToSpecialCustomers} />
              <Tile icon={ICONS.package} label="Pedidos" description="Gestionar pedidos del local" onClick={onGoToOrders} />
              <Tile icon={ICONS.truck} label="Proveedores" description="Deuda combinada entre locales" onClick={onGoToProviders} />
            </div>
          </div>

          <div>
            <SectionLabel>Análisis</SectionLabel>
            <div className="grid grid-cols-2 items-start gap-2">
              <Tile icon={ICONS.chart} label="Historial completo" description="Ventas, gastos y fiados por turno" onClick={onGoToHistory} />
              {SHOW_ATTENDANCE_UI && (
                <Tile icon={ICONS.check} label="Asistencia" description="Registro de presencia del personal" onClick={() => setShowAttendance(true)} />
              )}
              <GroupTile
                icon={ICONS.scale}
                label="Stock"
                description="Conteos de inventario e historial"
                expanded={expandedGroup === 'stock'}
                onToggle={() => toggleGroup('stock')}
                options={[
                  { icon: ICONS.clipboard, label: 'Nuevo conteo', description: 'Registrar inventario del día', onClick: () => setShowStockCount(true) },
                  { icon: ICONS.package, label: 'Historial de conteos', description: 'Conteos de stock pasados', onClick: onGoToStockCounts },
                ]}
              />
            </div>
          </div>
        </div>
      </div>

      {SHOW_ATTENDANCE_UI && showAttendance && (
        <AttendanceModal onClose={() => setShowAttendance(false)} />
      )}
      {showStockCount && (
        <StockCountModal onClose={() => setShowStockCount(false)} />
      )}
    </div>
  )
}
