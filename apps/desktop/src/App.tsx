import { useEffect, useState, useCallback, useRef } from 'react'
import { DevBanner } from './components/SandboxBanner'
import LoginScreen from './routes/LoginScreen'
import StorePickerScreen from './routes/StorePickerScreen'
import ActivationScreen from './routes/ActivationScreen'
import LicenseErrorScreen from './routes/LicenseErrorScreen'
import OpenShiftScreen from './routes/OpenShiftScreen'
import CashierScreen from './routes/CashierScreen'
import CloseShiftScreen from './routes/CloseShiftScreen'
import AdminScreen from './routes/AdminScreen'
import AdminHubScreen from './routes/AdminHubScreen'
import StaffScreen from './routes/StaffScreen'
import StoreManagementScreen from './routes/StoreManagementScreen'
import DebtsScreen from './routes/DebtsScreen'
import SpecialCustomersScreen from './routes/SpecialCustomersScreen'
import OrdersScreen from './routes/OrdersScreen'
import HistoryScreen from './routes/HistoryScreen'
import ProvidersScreen from './routes/ProvidersScreen'
import StockCountHistoryScreen from './routes/StockCountHistoryScreen'
import ScreenErrorBoundary from './components/ScreenErrorBoundary'
import type { InitStatus, SessionInfo, ShiftInfo, StoreRow } from './types/hw-api'

const INACTIVITY_COUNTDOWN_SECONDS = 300 // 5 minutos

/** Wrapper que anima la entrada de cada pantalla con fade + slide sutil. */
function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-page-enter flex flex-col flex-1 min-h-0 overflow-hidden">
      {children}
    </div>
  )
}

type AppState =
  | { screen: 'loading' }
  | { screen: 'license-error'; reason: InitStatus['licenseReason'] & string; message: string }
  | { screen: 'activation'; licenseKey: string }
  | { screen: 'login'; initStatus: InitStatus }
  | { screen: 'store-picker'; partialSession: Pick<SessionInfo, 'role' | 'userId' | 'expiresAt'>; stores: StoreRow[]; initStatus: InitStatus; intent?: 'cashier' }
  | { screen: 'shift-required'; session: SessionInfo; initStatus: InitStatus }
  | { screen: 'cashier'; session: SessionInfo; shift: ShiftInfo; initStatus: InitStatus }
  | { screen: 'close-shift'; session: SessionInfo; initStatus: InitStatus }
  | { screen: 'admin-hub'; session: SessionInfo; initStatus: InitStatus }
  | { screen: 'admin'; session: SessionInfo; initStatus: InitStatus }
  | { screen: 'staff'; session: SessionInfo; initStatus: InitStatus }
  | { screen: 'store-management'; session: SessionInfo; initStatus: InitStatus }
  | { screen: 'debts'; session: SessionInfo; initStatus: InitStatus; fromCashier?: ShiftInfo }
  | { screen: 'special-customers'; session: SessionInfo; initStatus: InitStatus; fromCashier?: ShiftInfo }
  | { screen: 'orders'; session: SessionInfo; initStatus: InitStatus; fromCashier?: ShiftInfo }
  | { screen: 'history'; session: SessionInfo; initStatus: InitStatus }
  | { screen: 'providers'; session: SessionInfo; initStatus: InitStatus }
  | { screen: 'stock-counts'; session: SessionInfo; initStatus: InitStatus }

export default function App() {
  const [state, setState] = useState<AppState>({ screen: 'loading' })
  const [showInactivityWarning, setShowInactivityWarning] = useState(false)
  const [inactivityCountdown, setInactivityCountdown] = useState(INACTIVITY_COUNTDOWN_SECONDS)
  const prevScreenRef = useRef(state.screen)

  useEffect(() => {
    const prev = prevScreenRef.current
    prevScreenRef.current = state.screen
    const refreshScreens = new Set([
      'admin-hub', 'admin', 'staff', 'store-management', 'debts',
      'special-customers', 'orders', 'history', 'providers', 'stock-counts',
      'cashier',
    ])
    if ((refreshScreens.has(prev) || refreshScreens.has(state.screen)) && window.hw?.refreshRemoteData) {
      void window.hw.refreshRemoteData()
    }
  }, [state.screen])

  // Cuando la cajera navega a Fiados o Clientes especiales desde la caja,
  // CashierScreen permanece montado (oculto) para que el carrito no se pierda.
  // Aquí derivamos el state de cashier que corresponde al contexto actual.
  const bgCashierState: Extract<AppState, { screen: 'cashier' }> | null = (() => {
    if (state.screen === 'cashier') return state
    if (
      (state.screen === 'debts' || state.screen === 'special-customers' || state.screen === 'orders') &&
      state.fromCashier
    ) {
      return {
        screen: 'cashier',
        session: state.session,
        shift: state.fromCashier,
        initStatus: state.initStatus,
      }
    }
    return null
  })()

  // Suscribirse al aviso de inactividad del main process.
  // Se activa solo cuando hay un turno abierto (pantalla 'cashier' o 'close-shift').
  useEffect(() => {
    const hasShift = state.screen === 'cashier' || state.screen === 'close-shift'
    if (!hasShift) return

    const unsub = window.hw.onShiftInactivityWarning(() => {
      setInactivityCountdown(INACTIVITY_COUNTDOWN_SECONDS)
      setShowInactivityWarning(true)
    })
    return unsub
  }, [state.screen])

  // Countdown de 5 minutos cuando el aviso está activo.
  useEffect(() => {
    if (!showInactivityWarning) return

    const interval = setInterval(() => {
      setInactivityCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          void handleAutoClose()
          return 0
        }
        return prev - 1
      })
    }, 1_000)

    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactivityWarning])

  const handleAutoClose = useCallback(async () => {
    setShowInactivityWarning(false)
    await window.hw.closeShift({})
    await handleLogout()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  async function handleDismissInactivity() {
    setShowInactivityWarning(false)
    await window.hw.dismissInactivityWarning()
  }

  function handleGoToCloseShift() {
    setShowInactivityWarning(false)
    const session = 'session' in state ? state.session : null
    const initStatus = 'initStatus' in state ? state.initStatus : null
    if (session && initStatus) {
      setState({ screen: 'close-shift', session, initStatus })
    }
  }

  async function handleShiftClosed() {
    await handleLogout()
  }

  useEffect(() => {
    window.hw.getInitStatus().then(result => {
      if (!result.ok) {
        setState({ screen: 'license-error', reason: 'error', message: result.error ?? 'Error al inicializar la aplicación.' })
        return
      }

      const s = result.data
      if (!s.licenseValid) {
        setState({
          screen: 'license-error',
          reason: (s.licenseReason ?? 'error') as InitStatus['licenseReason'] & string,
          message: s.licenseMessage ?? 'Error de licencia.',
        })
        return
      }
      if (s.needsActivation) {
        setState({ screen: 'activation', licenseKey: s.licenseKey })
        return
      }
      setState({ screen: 'login', initStatus: s })
    }).catch(() => {
      setState({ screen: 'license-error', reason: 'error', message: 'No se pudo contactar al proceso principal. Reiniciar la aplicación.' })
    })
  }, [])

  async function handleLogin(email: string, password: string): Promise<void> {
    if (state.screen !== 'login') return
    const result = await window.hw.login({ email, password })
    if (!result.ok) throw new Error(result.error)

    const session = result.data

    // Admin: va directo al hub sin seleccionar local
    // (el selector de local aparece dentro de las secciones que lo necesiten)
    if (session.role === 'admin') {
      setState({ screen: 'admin-hub', session, initStatus: state.initStatus })
      return
    }

    // Cajera: verificar si tiene un turno abierto para reanudarla directamente
    // (evita mostrar el store picker cuando el turno ya está activo en algún local).
    const userShiftResult = await window.hw.getUserOpenShift()
    if (userShiftResult.ok && userShiftResult.data) {
      // Hay un turno sin cerrar — seleccionar ese local automáticamente y retomar.
      await handleSelectStore(session, userShiftResult.data.storeId, state.initStatus)
      return
    }

    // No hay turno abierto → flujo normal (selector de local o selección automática)
    const storesResult = await window.hw.getStores()
    const availableStores = storesResult.ok ? storesResult.data : []

    if (availableStores.length === 1) {
      await handleSelectStore(session, availableStores[0]!.id, state.initStatus)
    } else {
      setState({ screen: 'store-picker', partialSession: session, stores: availableStores, initStatus: state.initStatus })
    }
  }

  async function handleSelectStore(
    _partialSession: Pick<SessionInfo, 'role' | 'userId' | 'expiresAt'>,
    storeId: string,
    initStatus: InitStatus,
    intent?: 'cashier',
  ): Promise<void> {
    const r = await window.hw.selectStore({ storeId })
    if (!r.ok) throw new Error(r.error)

    const session = r.data
    // Si el admin llega sin intención de ir a la caja, vuelve al hub
    if (session.role === 'admin' && intent !== 'cashier') {
      setState({ screen: 'admin-hub', session, initStatus })
      return
    }
    const shiftResult = await window.hw.getActiveShift()
    if (shiftResult.ok && shiftResult.data) {
      setState({ screen: 'cashier', session, shift: shiftResult.data, initStatus })
    } else {
      setState({ screen: 'shift-required', session, initStatus })
    }
  }

  async function handleAdminGoToCashier(): Promise<void> {
    if (state.screen !== 'admin-hub') return

    const userShift = await window.hw.getUserOpenShift()
    if (userShift.ok && userShift.data) {
      await handleSelectStore(state.session, userShift.data.storeId, state.initStatus, 'cashier')
      return
    }

    const storesResult = await window.hw.getStores()
    const availableStores = storesResult.ok ? storesResult.data : []

    if (availableStores.length <= 1) {
      // Un solo local (o ninguno): seleccionar automáticamente
      const storeId = availableStores[0]?.id ?? state.session.storeId ?? ''
      await handleSelectStore(state.session, storeId, state.initStatus, 'cashier')
    } else {
      // Múltiples locales: pedir que elija en cuál va a trabajar
      setState({
        screen: 'store-picker',
        partialSession: state.session,
        stores: availableStores,
        initStatus: state.initStatus,
        intent: 'cashier',
      })
    }
  }

  function handleAdminGoToPanel(): void {
    if (state.screen !== 'admin-hub') return
    setState({ screen: 'admin', session: state.session, initStatus: state.initStatus })
  }

  function handleGoToStaff(): void {
    if (state.screen !== 'admin-hub') return
    setState({ screen: 'staff', session: state.session, initStatus: state.initStatus })
  }

  function handleGoToStoreManagement(): void {
    if (state.screen !== 'admin-hub') return
    setState({ screen: 'store-management', session: state.session, initStatus: state.initStatus })
  }

  function handleGoToStockCounts(): void {
    if (state.screen !== 'admin-hub') return
    setState({ screen: 'stock-counts', session: state.session, initStatus: state.initStatus })
  }

  function handleReturnToAdminHub(): void {
    const session = 'session' in state ? state.session : null
    const initStatus = 'initStatus' in state ? state.initStatus : null
    if (session && initStatus && session.role === 'admin') {
      setState({ screen: 'admin-hub', session, initStatus })
    }
  }

  function handleReturnToPosFromCloseShift(): void {
    if (state.screen !== 'close-shift') return
    const session = state.session
    const initStatus = state.initStatus
    void window.hw.getActiveShift().then(r => {
      if (r.ok && r.data) {
        setState({ screen: 'cashier', session, shift: r.data, initStatus })
      } else {
        setState({ screen: 'shift-required', session, initStatus })
      }
    })
  }

  function handleRecoverFromScreenError(): void {
    if (state.screen === 'close-shift') {
      handleReturnToPosFromCloseShift()
      return
    }
    if (
      (state.screen === 'debts' || state.screen === 'special-customers' || state.screen === 'orders')
      && 'fromCashier' in state
      && state.fromCashier
    ) {
      setState({
        screen: 'cashier',
        session: state.session,
        shift: state.fromCashier,
        initStatus: state.initStatus,
      })
      return
    }
    if (state.screen === 'cashier' || state.screen === 'shift-required') {
      void handleLogout()
      return
    }
    if ('session' in state && state.session.role === 'admin') {
      handleReturnToAdminHub()
    }
  }


  function handleActivated(): void {
    if (state.screen !== 'activation') return
    window.hw.getInitStatus().then(result => {
      if (result.ok) setState({ screen: 'login', initStatus: { ...result.data, needsActivation: false } })
    })
  }

  function handleShiftOpened(shift: ShiftInfo): void {
    if (state.screen !== 'shift-required') return
    setState({ screen: 'cashier', session: state.session, shift, initStatus: state.initStatus })
  }

  /** Permite a la cajera corregir la elección de local antes de abrir turno. */
  async function handleGoBackFromShiftRequired(): Promise<void> {
    if (state.screen !== 'shift-required') return
    const session = state.session
    const initStatus = state.initStatus

    const storesResult = await window.hw.getStores()
    const availableStores = storesResult.ok ? storesResult.data.filter(s => !s.archivedAt) : []

    if (availableStores.length > 1) {
      // Volver al selector de local (sin cerrar sesión)
      setState({ screen: 'store-picker', partialSession: session, stores: availableStores, initStatus })
    } else {
      // Un solo local disponible: no tiene sentido volver al picker, ir al login
      await window.hw.logout({ role: session.role, storeId: session.storeId })
      setState({ screen: 'login', initStatus })
    }
  }

  async function handleLogout(): Promise<void> {
    const session = 'session' in state ? state.session : null
    if (!session) return
    await window.hw.logout({ role: session.role, storeId: session.storeId })
    const initStatus = 'initStatus' in state ? state.initStatus : null
    if (initStatus) setState({ screen: 'login', initStatus })
  }

  const countdownMinutes = Math.floor(inactivityCountdown / 60)
  const countdownSeconds = inactivityCountdown % 60
  const countdownDisplay = `${String(countdownMinutes).padStart(2, '0')}:${String(countdownSeconds).padStart(2, '0')}`

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <DevBanner />

      <ScreenErrorBoundary resetKey={state.screen} onReset={handleRecoverFromScreenError}>

      {state.screen === 'loading' && (
        <div className="flex flex-1 items-center justify-center bg-zinc-950 animate-fade-in">
          <div className="text-center space-y-4">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" />
            <p className="text-zinc-500 text-sm">Iniciando…</p>
          </div>
        </div>
      )}

      {state.screen === 'license-error' && (
        <Page>
          <LicenseErrorScreen reason={state.reason} message={state.message} />
        </Page>
      )}

      {state.screen === 'activation' && (
        <Page>
          <ActivationScreen licenseKey={state.licenseKey} onActivated={handleActivated} />
        </Page>
      )}

      {state.screen === 'login' && (
        <Page>
          <LoginScreen
            businessName={state.initStatus.businessName}
            onLogin={handleLogin}
          />
        </Page>
      )}

      {state.screen === 'store-picker' && (
        <Page>
          <StorePickerScreen
            stores={state.stores}
            intent={state.intent}
            onSelect={async (storeId) => {
              await handleSelectStore(state.partialSession, storeId, state.initStatus, state.intent)
            }}
            onLogout={() => {
              if (state.intent === 'cashier') {
                const session = state.partialSession as SessionInfo
                setState({ screen: 'admin-hub', session, initStatus: state.initStatus })
              } else {
                setState({ screen: 'login', initStatus: state.initStatus })
              }
            }}
          />
        </Page>
      )}

      {state.screen === 'shift-required' && (
        <Page>
          <OpenShiftScreen
            onShiftOpened={handleShiftOpened}
            onCancel={
              state.session.role === 'admin'
                ? handleReturnToAdminHub
                : handleGoBackFromShiftRequired
            }
            cancelLabel={state.session.role === 'admin' ? '← Volver al hub' : '← Cambiar local'}
            canForceClose={state.session.role === 'admin'}
            storeId={state.session.storeId}
            userId={state.session.userId}
          />
        </Page>
      )}

      {/* CashierScreen permanece montado (oculto) para preservar el carrito */}
      {bgCashierState && (
        <div className={state.screen !== 'cashier' ? 'hidden' : 'contents'}>
          <CashierScreen
            session={bgCashierState.session}
            shift={bgCashierState.shift}
            isActive={state.screen === 'cashier'}
            onLogout={handleLogout}
            onCloseShift={handleGoToCloseShift}
            onReturnToHub={bgCashierState.session.role === 'admin' ? handleReturnToAdminHub : undefined}
            onViewDebts={() => setState({ screen: 'debts', session: bgCashierState.session, initStatus: bgCashierState.initStatus, fromCashier: bgCashierState.shift })}
            onViewSpecialCustomers={() => setState({ screen: 'special-customers', session: bgCashierState.session, initStatus: bgCashierState.initStatus, fromCashier: bgCashierState.shift })}
            onViewOrders={() => setState({ screen: 'orders', session: bgCashierState.session, initStatus: bgCashierState.initStatus, fromCashier: bgCashierState.shift })}
          />
        </div>
      )}

      {state.screen === 'close-shift' && (
        <Page>
          <CloseShiftScreen
            onConfirmed={() => void handleShiftClosed()}
            onCancel={handleReturnToPosFromCloseShift}
          />
        </Page>
      )}

      {state.screen === 'admin-hub' && (
        <Page>
          <AdminHubScreen
            session={state.session}
            initStatus={state.initStatus}
            onGoToAdminPanel={handleAdminGoToPanel}
            onGoToCashier={() => void handleAdminGoToCashier()}
            onGoToStaff={handleGoToStaff}
            onGoToStoreManagement={handleGoToStoreManagement}
            onGoToDebts={() => setState({ screen: 'debts', session: state.session, initStatus: state.initStatus })}
            onGoToSpecialCustomers={() => setState({ screen: 'special-customers', session: state.session, initStatus: state.initStatus })}
            onGoToOrders={() => setState({ screen: 'orders', session: state.session, initStatus: state.initStatus })}
            onGoToHistory={() => setState({ screen: 'history', session: state.session, initStatus: state.initStatus })}
            onGoToProviders={() => setState({ screen: 'providers', session: state.session, initStatus: state.initStatus })}
            onGoToStockCounts={handleGoToStockCounts}
            onLogout={handleLogout}
          />
        </Page>
      )}

      {state.screen === 'admin' && (
        <Page>
          <AdminScreen
            session={state.session}
            onLogout={handleLogout}
            onReturnToHub={handleReturnToAdminHub}
          />
        </Page>
      )}

      {state.screen === 'staff' && (
        <Page>
          <StaffScreen onBack={handleReturnToAdminHub} />
        </Page>
      )}

      {state.screen === 'store-management' && (
        <Page>
          <StoreManagementScreen onBack={handleReturnToAdminHub} />
        </Page>
      )}

      {state.screen === 'debts' && (
        <Page>
          <DebtsScreen
            isAdmin={state.session.role === 'admin'}
            onBack={() => {
              if (state.fromCashier) {
                setState({ screen: 'cashier', session: state.session, shift: state.fromCashier, initStatus: state.initStatus })
              } else {
                handleReturnToAdminHub()
              }
            }}
          />
        </Page>
      )}

      {state.screen === 'special-customers' && (
        <Page>
          <SpecialCustomersScreen
            isAdmin={state.session.role === 'admin'}
            onBack={() => {
              if (state.fromCashier) {
                setState({ screen: 'cashier', session: state.session, shift: state.fromCashier, initStatus: state.initStatus })
              } else {
                handleReturnToAdminHub()
              }
            }}
          />
        </Page>
      )}

      {state.screen === 'orders' && (
        <Page>
          <OrdersScreen
            isAdmin={state.session.role === 'admin'}
            currentShiftId={state.fromCashier?.id ?? null}
            onBack={() => {
              if (state.fromCashier) {
                setState({ screen: 'cashier', session: state.session, shift: state.fromCashier, initStatus: state.initStatus })
              } else {
                handleReturnToAdminHub()
              }
            }}
          />
        </Page>
      )}

      {state.screen === 'history' && (
        <Page>
          <HistoryScreen onBack={handleReturnToAdminHub} />
        </Page>
      )}

      {state.screen === 'providers' && (
        <Page>
          <ProvidersScreen onBack={handleReturnToAdminHub} />
        </Page>
      )}

      {state.screen === 'stock-counts' && (
        <Page>
          <StockCountHistoryScreen onBack={handleReturnToAdminHub} />
        </Page>
      )}

      </ScreenErrorBoundary>

      {/* Modal de aviso de inactividad — overlay global */}
      {showInactivityWarning && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-overlay-fade">
          <div className="bg-zinc-900 rounded-2xl border border-zinc-700 w-full max-w-sm p-6 shadow-2xl space-y-4 text-center animate-modal-enter">
            <div className="text-4xl">⏰</div>
            <h2 className="text-lg font-bold text-white">¿Seguís trabajando?</h2>
            <p className="text-sm text-zinc-400">
              No hubo actividad en la caja por un tiempo. Si no respondés, el turno se cerrará
              automáticamente para proteger los registros.
            </p>
            <div className="text-3xl font-mono font-bold text-zinc-200">{countdownDisplay}</div>
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => void handleDismissInactivity()}
                className="w-full py-3 rounded-xl bg-emerald-700 hover:bg-emerald-600 font-semibold text-white transition-colors"
              >
                Seguir trabajando
              </button>
              <button
                onClick={handleGoToCloseShift}
                className="w-full py-3 rounded-xl border border-zinc-700 hover:bg-zinc-800 font-semibold text-zinc-300 transition-colors"
              >
                Cerrar turno ahora
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
