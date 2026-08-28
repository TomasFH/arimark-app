/**
 * Panel admin móvil — hub de navegación.
 *
 * Reemplaza el antiguo AdminDashboard de 2 tabs (Turnos + Vales) con un hub
 * de tiles que da acceso a todas las funciones del administrador.
 * Los datos de cada sección se cargan en la pantalla correspondiente.
 */
import { useCallback, useEffect, useState } from 'react'
import { useOnlineStatus } from '../lib/connectivity'
import { fetchAllStores, type StoreDoc } from '../lib/adminFirestore'
import { OrdersScreen } from './admin/OrdersScreen'
import { DebtsScreen } from './admin/DebtsScreen'
import { ProvidersScreen } from './admin/ProvidersScreen'
import { SpecialCustomersScreen } from './admin/SpecialCustomersScreen'
import { StaffScreen } from './admin/StaffScreen'
import { StoresScreen } from './admin/StoresScreen'
import { HistoryScreen } from './admin/HistoryScreen'
import type { LocalProfile } from '../types/pos'

interface Props {
  profile: LocalProfile
  onLogout: () => void
}

type AdminScreen =
  | { kind: 'hub' }
  | { kind: 'orders' }
  | { kind: 'debts' }
  | { kind: 'providers' }
  | { kind: 'special-customers' }
  | { kind: 'staff' }
  | { kind: 'stores' }
  | { kind: 'history' }

export function AdminDashboard({ profile, onLogout }: Props) {
  const online = useOnlineStatus()
  const [screen, setScreen] = useState<AdminScreen>({ kind: 'hub' })
  const [stores, setStores] = useState<StoreDoc[]>([])
  const [loadingStores, setLoadingStores] = useState(true)

  const loadStores = useCallback(async () => {
    setLoadingStores(true)
    try {
      const list = await fetchAllStores()
      setStores(list)
    } catch {
      // No bloqueamos la UI si falla — cada pantalla maneja sus propios errores
    } finally {
      setLoadingStores(false)
    }
  }, [])

  useEffect(() => {
    void loadStores()
  }, [loadStores])

  const activeStores = stores.filter(s => !s.archivedAt)

  // Volver al hub y refrescar locales (en caso de que StoresScreen los haya modificado)
  const toHub = () => {
    setScreen({ kind: 'hub' })
    void loadStores()
  }

  // ---------------------------------------------------------------------------
  // Routing a pantallas
  // ---------------------------------------------------------------------------

  if (screen.kind === 'orders') {
    return <OrdersScreen onBack={toHub} stores={activeStores} createdBy={profile.uid} />
  }
  if (screen.kind === 'debts') {
    return <DebtsScreen onBack={toHub} stores={activeStores} profile={profile} />
  }
  if (screen.kind === 'providers') {
    return <ProvidersScreen onBack={toHub} stores={activeStores} profile={profile} />
  }
  if (screen.kind === 'special-customers') {
    return <SpecialCustomersScreen onBack={toHub} profile={profile} />
  }
  if (screen.kind === 'staff') {
    return <StaffScreen onBack={toHub} profile={profile} />
  }
  if (screen.kind === 'stores') {
    return <StoresScreen onBack={toHub} />
  }
  if (screen.kind === 'history') {
    return <HistoryScreen onBack={toHub} stores={activeStores} />
  }

  // ---------------------------------------------------------------------------
  // Hub
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Administrador</p>
          <h1
            className="truncate text-lg font-bold text-zinc-100"
            title={profile.displayName}
          >
            {profile.displayName}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void loadStores()}
          disabled={loadingStores}
          aria-label="Actualizar"
          title="Actualizar locales. Recargar el resto de datos (con lecturas mínimas a Firebase) queda para el final de la sesión de pruebas."
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition-colors disabled:opacity-40"
        >
          ↻
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
        >
          Salir
        </button>
      </header>

      {!online && (
        <div className="border-b border-amber-900/40 bg-amber-950/50 px-4 py-2 text-sm text-amber-400/80">
          Sin conexión — los datos del admin requieren internet.
        </div>
      )}

      {/* Content — mismo orden e iconos que el hub de escritorio */}
      <main className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
        <HubSection title="Configuración">
          <div className="grid grid-cols-2 gap-3">
            <HubTile
              icon="🏪"
              accent="bg-teal-600/15"
              label="Gestión de locales"
              subtitle={
                loadingStores
                  ? 'Cargando...'
                  : `${activeStores.length} local${activeStores.length !== 1 ? 'es' : ''} activo${activeStores.length !== 1 ? 's' : ''}`
              }
              onClick={() => setScreen({ kind: 'stores' })}
            />
            <HubTile
              icon="👥"
              accent="bg-blue-600/15"
              label="Empleados"
              subtitle="Cajeras y carniceros"
              onClick={() => setScreen({ kind: 'staff' })}
            />
          </div>
        </HubSection>

        <HubSection title="Operación">
          <div className="grid grid-cols-2 gap-3">
            <HubTile
              icon="📒"
              accent="bg-amber-600/15"
              label="Fiados"
              subtitle="Deudas, cobros y cuentas corrientes"
              onClick={() => setScreen({ kind: 'debts' })}
            />
            <HubTile
              icon="👤"
              accent="bg-purple-600/15"
              label="Clientes especiales"
              subtitle="Precios acordados por cliente"
              onClick={() => setScreen({ kind: 'special-customers' })}
            />
            <HubTile
              icon="📦"
              accent="bg-emerald-600/15"
              label="Pedidos"
              subtitle="Gestionar pedidos del local"
              onClick={() => setScreen({ kind: 'orders' })}
            />
            <HubTile
              icon="🚚"
              accent="bg-orange-600/15"
              label="Proveedores"
              subtitle="Deuda combinada entre locales"
              onClick={() => setScreen({ kind: 'providers' })}
            />
          </div>
        </HubSection>

        <HubSection title="Análisis">
          <div className="grid grid-cols-1 gap-3">
            <HubTile
              icon="📊"
              accent="bg-sky-600/15"
              label="Historial completo"
              subtitle="Ventas, gastos y fiados por turno"
              onClick={() => setScreen({ kind: 'history' })}
            />
          </div>
        </HubSection>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hub building blocks
// ---------------------------------------------------------------------------

function HubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h2>
      {children}
    </section>
  )
}

interface HubTileProps {
  icon: string
  accent: string
  label: string
  subtitle?: string
  onClick: () => void
}

function HubTile({ icon, accent, label, subtitle, onClick }: HubTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-3.5 text-left transition-all hover:border-zinc-600 hover:bg-zinc-700/60 active:scale-[0.98]"
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl ${accent}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-zinc-100" title={label}>
          {label}
        </span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-xs text-zinc-500" title={subtitle}>
            {subtitle}
          </span>
        )}
      </div>
    </button>
  )
}
