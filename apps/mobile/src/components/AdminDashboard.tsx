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
import { EmployeesScreen } from './admin/EmployeesScreen'
import { CashiersScreen } from './admin/CashiersScreen'
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
  | { kind: 'employees' }
  | { kind: 'cashiers' }
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
    return <OrdersScreen onBack={toHub} stores={activeStores} />
  }
  if (screen.kind === 'debts') {
    return <DebtsScreen onBack={toHub} stores={activeStores} profile={profile} />
  }
  if (screen.kind === 'providers') {
    return <ProvidersScreen onBack={toHub} stores={activeStores} />
  }
  if (screen.kind === 'special-customers') {
    return <SpecialCustomersScreen onBack={toHub} />
  }
  if (screen.kind === 'employees') {
    return <EmployeesScreen onBack={toHub} stores={activeStores} />
  }
  if (screen.kind === 'cashiers') {
    return <CashiersScreen onBack={toHub} stores={stores} />
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
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
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

      {/* Content */}
      <main className="flex-1 space-y-6 px-4 py-5">
        {/* Operación */}
        <HubSection title="Operación">
          <div className="grid grid-cols-2 gap-3">
            <HubTile
              label="Pedidos"
              subtitle="Encargos de clientes"
              onClick={() => setScreen({ kind: 'orders' })}
            />
            <HubTile
              label="Fiados"
              subtitle="Deudas de clientes"
              onClick={() => setScreen({ kind: 'debts' })}
            />
            <HubTile
              label="Proveedores"
              subtitle="Deudas y pagos"
              onClick={() => setScreen({ kind: 'providers' })}
            />
            <HubTile
              label="Clientes especiales"
              subtitle="Precios diferenciados"
              onClick={() => setScreen({ kind: 'special-customers' })}
            />
          </div>
        </HubSection>

        {/* Empleados */}
        <HubSection title="Empleados">
          <div className="grid grid-cols-2 gap-3">
            <HubTile
              label="Carniceros"
              subtitle="Personal operativo"
              onClick={() => setScreen({ kind: 'employees' })}
            />
            <HubTile
              label="Cajeras"
              subtitle="Acceso y locales"
              onClick={() => setScreen({ kind: 'cashiers' })}
            />
          </div>
        </HubSection>

        {/* Análisis */}
        <HubSection title="Análisis">
          <div className="grid grid-cols-1 gap-3">
            <HubTile
              label="Historial"
              subtitle="Turnos, ventas y gastos"
              onClick={() => setScreen({ kind: 'history' })}
            />
          </div>
        </HubSection>

        {/* Configuración */}
        <HubSection title="Configuración">
          <div className="grid grid-cols-1 gap-3">
            <HubTile
              label="Locales"
              subtitle={
                loadingStores
                  ? 'Cargando...'
                  : `${activeStores.length} local${activeStores.length !== 1 ? 'es' : ''} activo${activeStores.length !== 1 ? 's' : ''}`
              }
              onClick={() => setScreen({ kind: 'stores' })}
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
  label: string
  subtitle?: string
  onClick: () => void
}

function HubTile({ label, subtitle, onClick }: HubTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-4 text-left transition-all hover:border-zinc-700 hover:bg-zinc-800/60 active:scale-[0.98]"
    >
      <span className="text-sm font-semibold text-zinc-100">{label}</span>
      {subtitle && (
        <span className="truncate text-xs text-zinc-500" title={subtitle}>
          {subtitle}
        </span>
      )}
    </button>
  )
}
