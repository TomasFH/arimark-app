/**
 * Hub de administración — punto de entrada del rol admin.
 * Grid de 2 columnas con accesos directos a cada módulo.
 */
import { useState, useEffect, useRef } from 'react'
import type { SessionInfo, InitStatus, UiSettings } from '../types/hw-api'
import AttendanceModal from './AttendanceModal'
import StockCountModal from './StockCountModal'

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

interface TileProps {
  icon: string
  accent: string
  label: string
  description: string
  onClick: () => void
  muted?: boolean
}

function Tile({ icon, accent, label, description, onClick, muted }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all active:scale-[0.98] ${
        muted
          ? 'border-zinc-800/60 bg-zinc-800/40 opacity-60 hover:opacity-80 hover:bg-zinc-800 hover:border-zinc-700'
          : 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700/80 hover:border-zinc-600'
      }`}
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl ${accent}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-100 truncate">{label}</p>
        <p className="mt-0.5 text-xs text-zinc-500 truncate">{description}</p>
      </div>
      <svg
        className="h-3.5 w-3.5 shrink-0 text-zinc-700 transition-colors group-hover:text-zinc-400"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
      </svg>
    </button>
  )
}

interface SubOption {
  icon: string
  label: string
  description: string
  onClick: () => void
}

interface GroupTileProps {
  icon: string
  accent: string
  label: string
  description: string
  options: SubOption[]
  expanded: boolean
  onToggle: () => void
}

function GroupTile({ icon, accent, label, description, options, expanded, onToggle }: GroupTileProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (expanded) boxRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [expanded])
  return (
    <div ref={boxRef} className={`rounded-xl border transition-all duration-150 ${
      expanded ? 'border-zinc-600 bg-zinc-800' : 'border-zinc-700 bg-zinc-800'
    }`}>
      <button
        type="button"
        onClick={onToggle}
        className="group flex w-full items-center gap-3 rounded-xl p-3.5 text-left transition-all active:scale-[0.98] hover:bg-zinc-800/40"
      >
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl ${accent}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-100 truncate">{label}</p>
          <p className="mt-0.5 text-xs text-zinc-500 truncate">{description}</p>
        </div>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-zinc-600 transition-transform duration-150 group-hover:text-zinc-400 ${
            expanded ? 'rotate-90' : ''
          }`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800 px-3 pb-3 pt-2 flex flex-col gap-1.5">
          {options.map(opt => (
            <button
              key={opt.label}
              type="button"
              onClick={opt.onClick}
              className="group flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-left transition-all hover:bg-zinc-800 hover:border-zinc-700 active:scale-[0.98]"
            >
              <span className="text-base shrink-0">{opt.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-200 truncate">{opt.label}</p>
                <p className="text-[10px] text-zinc-500 truncate">{opt.description}</p>
              </div>
              <svg
                className="ml-auto h-3 w-3 shrink-0 text-zinc-700 group-hover:text-zinc-400 transition-colors"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
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
  const [refreshing, setRefreshing] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<'stock' | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [uiSettings, setUiSettings] = useState<UiSettings>({ zoomFactor: 1.0 })
  const settingsBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void window.hw.getUiSettings().then(r => {
      if (r.ok) setUiSettings(r.data)
    })
    return window.hw.onUiSettingsChanged(settings => setUiSettings(settings))
  }, [])

  async function handleSetZoom(factor: number): Promise<void> {
    const clamped = Math.max(0.6, Math.min(2.0, Math.round(factor * 100) / 100))
    const r = await window.hw.setUiSettings({ zoomFactor: clamped })
    if (r.ok) setUiSettings(r.data)
  }

  function toggleGroup(g: 'stock') {
    setExpandedGroup(v => (v === g ? null : g))
  }

  async function handleRefreshRemote(): Promise<void> {
    if (refreshing) return
    setRefreshing(true)
    try {
      await window.hw.refreshRemoteData()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">

      {/* Header */}
      <header className="relative flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-base">
            🥩
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate">{initStatus.businessName}</p>
            <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Administrador</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => void handleRefreshRemote()}
            disabled={refreshing}
            className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors disabled:opacity-40"
            title="Actualizar datos remotos"
          >
            {refreshing ? '…' : '↺'}
          </button>

          {/* Ajustes de la aplicación */}
          <button
            ref={settingsBtnRef}
            type="button"
            onClick={() => setShowSettings(v => !v)}
            title="Ajustes de la aplicación"
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
              showSettings
                ? 'border-zinc-600 bg-zinc-800 text-zinc-200'
                : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            }`}
          >
            Ajustes
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
          >
            Cerrar sesión
          </button>
        </div>

        {/* Panel de ajustes flotante */}
        {showSettings && (
          <>
            {/* Backdrop invisible para cerrar al hacer clic afuera */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowSettings(false)}
            />
            <div className="absolute right-4 top-full z-50 mt-1.5 w-72 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
              <div className="border-b border-zinc-800 px-4 py-3">
                <p className="text-sm font-semibold text-zinc-100">Ajustes de la aplicación</p>
                <p className="mt-0.5 text-[10px] text-zinc-500">Las preferencias se guardan automáticamente</p>
              </div>

              <div className="p-4 space-y-4">
                {/* Zoom */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-xs font-medium text-zinc-300">Tamaño de pantalla</p>
                      <p className="text-[10px] text-zinc-600 mt-0.5">También: Ctrl+= / Ctrl+−</p>
                    </div>
                    <span className="font-mono text-sm font-semibold text-zinc-100 tabular-nums">
                      {Math.round(uiSettings.zoomFactor * 100)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSetZoom(uiSettings.zoomFactor - 0.1)}
                      disabled={uiSettings.zoomFactor <= 0.6}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed text-base font-bold"
                      title="Reducir tamaño"
                    >
                      −
                    </button>
                    {/* Barra de progreso visual */}
                    <div className="relative flex-1 h-1.5 rounded-full bg-zinc-800">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-zinc-400 transition-all duration-150"
                        style={{ width: `${((uiSettings.zoomFactor - 0.6) / (2.0 - 0.6)) * 100}%` }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSetZoom(uiSettings.zoomFactor + 0.1)}
                      disabled={uiSettings.zoomFactor >= 2.0}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed text-base font-bold"
                      title="Aumentar tamaño"
                    >
                      +
                    </button>
                  </div>
                  {uiSettings.zoomFactor !== 1.0 && (
                    <button
                      type="button"
                      onClick={() => void handleSetZoom(1.0)}
                      className="mt-2 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                      Restablecer al 100% (Ctrl+0)
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </header>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto w-full max-w-5xl px-8 py-5 space-y-4">

          {/* Primary action */}
          <button
            type="button"
            onClick={onGoToCashier}
            className="group flex w-full items-center gap-4 rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-4 text-left transition-all hover:border-emerald-700/50 hover:bg-emerald-950/30 active:scale-[0.98]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600/20 text-xl">
              🛒
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-emerald-300">Operar como cajera</p>
              <p className="mt-0.5 text-xs text-emerald-600">Acceder al punto de venta</p>
            </div>
            <svg className="h-4 w-4 shrink-0 text-emerald-700 group-hover:text-emerald-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
            </svg>
          </button>

          {/* Section: Configuración */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              Configuración
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Tile icon="⚙️" accent="bg-red-600/15" label="Panel de administración" description="Productos, precios y disponibilidad" onClick={onGoToAdminPanel} />
              <Tile icon="🏪" accent="bg-teal-600/15" label="Gestión de locales" description="Locales registrados en el sistema" onClick={onGoToStoreManagement} />
              <Tile icon="👥" accent="bg-blue-600/15" label="Empleados" description="Cajeras y carniceros — cuentas, sueldos y liquidación" onClick={onGoToStaff} />
            </div>
          </div>

          {/* Section: Operación */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              Operación
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Tile icon="📒" accent="bg-amber-600/15" label="Fiados" description="Deudas, cobros y cuentas corrientes" onClick={onGoToDebts} />
              <Tile icon="👤" accent="bg-purple-600/15" label="Clientes especiales" description="Precios acordados por cliente" onClick={onGoToSpecialCustomers} />
              <Tile icon="📦" accent="bg-emerald-600/15" label="Pedidos" description="Gestionar pedidos del local" onClick={onGoToOrders} />
              <Tile icon="🚚" accent="bg-orange-600/15" label="Proveedores" description="Deuda combinada entre locales" onClick={onGoToProviders} />
            </div>
          </div>

          {/* Section: Análisis */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              Análisis
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Tile icon="📊" accent="bg-sky-600/15" label="Historial completo" description="Ventas, gastos y fiados por turno" onClick={onGoToHistory} />
              {SHOW_ATTENDANCE_UI && (
                <Tile icon="✓" accent="bg-teal-600/15" label="Asistencia" description="Registro de presencia del personal" onClick={() => setShowAttendance(true)} />
              )}
              <GroupTile
                icon="⚖️"
                accent="bg-cyan-600/15"
                label="Stock"
                description="Conteos de inventario e historial"
                expanded={expandedGroup === 'stock'}
                onToggle={() => toggleGroup('stock')}
                options={[
                  { icon: '📋', label: 'Nuevo conteo', description: 'Registrar inventario del día', onClick: () => setShowStockCount(true) },
                  { icon: '📦', label: 'Historial de conteos', description: 'Conteos de stock pasados', onClick: onGoToStockCounts },
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
