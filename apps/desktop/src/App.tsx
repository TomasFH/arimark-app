import { useEffect, useState, useCallback } from 'react'
import { DevBanner } from './components/SandboxBanner'
import LoginScreen from './routes/LoginScreen'
import ActivationScreen from './routes/ActivationScreen'
import LicenseErrorScreen from './routes/LicenseErrorScreen'
import OpenShiftScreen from './routes/OpenShiftScreen'
import CashierScreen from './routes/CashierScreen'
import CloseShiftScreen from './routes/CloseShiftScreen'
import AdminScreen from './routes/AdminScreen'
import AdminHubScreen from './routes/AdminHubScreen'
import CashierManagementScreen from './routes/CashierManagementScreen'
import DebtsScreen from './routes/DebtsScreen'
import SpecialCustomersScreen from './routes/SpecialCustomersScreen'
import type { InitStatus, SessionInfo, ShiftInfo } from './types/hw-api'

const INACTIVITY_COUNTDOWN_SECONDS = 300 // 5 minutos

type AppState =
  | { screen: 'loading' }
  | { screen: 'license-error'; reason: InitStatus['licenseReason'] & string; message: string }
  | { screen: 'activation'; licenseKey: string }
  | { screen: 'login'; initStatus: InitStatus }
  | { screen: 'shift-required'; session: SessionInfo; initStatus: InitStatus }
  | { screen: 'cashier'; session: SessionInfo; shift: ShiftInfo; initStatus: InitStatus }
  | { screen: 'close-shift'; session: SessionInfo; initStatus: InitStatus }
  | { screen: 'admin-hub'; session: SessionInfo; initStatus: InitStatus }
  | { screen: 'admin'; session: SessionInfo; initStatus: InitStatus }
  | { screen: 'cashier-management'; session: SessionInfo; initStatus: InitStatus }
  | { screen: 'debts'; session: SessionInfo; initStatus: InitStatus; fromCashier?: ShiftInfo }
  | { screen: 'special-customers'; session: SessionInfo; initStatus: InitStatus; fromCashier?: ShiftInfo }

export default function App() {
  const [state, setState] = useState<AppState>({ screen: 'loading' })
  const [showInactivityWarning, setShowInactivityWarning] = useState(false)
  const [inactivityCountdown, setInactivityCountdown] = useState(INACTIVITY_COUNTDOWN_SECONDS)

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
    if (session.role === 'admin') {
      setState({ screen: 'admin-hub', session, initStatus: state.initStatus })
      return
    }
    // cajera
    const shiftResult = await window.hw.getActiveShift()
    if (shiftResult.ok && shiftResult.data) {
      setState({ screen: 'cashier', session, shift: shiftResult.data, initStatus: state.initStatus })
    } else {
      setState({ screen: 'shift-required', session, initStatus: state.initStatus })
    }
  }

  async function handleAdminGoToCashier(): Promise<void> {
    if (state.screen !== 'admin-hub') return
    const shiftResult = await window.hw.getActiveShift()
    if (shiftResult.ok && shiftResult.data) {
      setState({ screen: 'cashier', session: state.session, shift: shiftResult.data, initStatus: state.initStatus })
    } else {
      setState({ screen: 'shift-required', session: state.session, initStatus: state.initStatus })
    }
  }

  function handleAdminGoToPanel(): void {
    if (state.screen !== 'admin-hub') return
    setState({ screen: 'admin', session: state.session, initStatus: state.initStatus })
  }

  function handleGoToCashierManagement(): void {
    if (state.screen !== 'admin-hub') return
    setState({ screen: 'cashier-management', session: state.session, initStatus: state.initStatus })
  }

  function handleReturnToAdminHub(): void {
    const session = 'session' in state ? state.session : null
    const initStatus = 'initStatus' in state ? state.initStatus : null
    if (session && initStatus && session.role === 'admin') {
      setState({ screen: 'admin-hub', session, initStatus })
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
    <div className="flex min-h-screen flex-col">
      <DevBanner />

      {state.screen === 'loading' && (
        <div className="flex flex-1 items-center justify-center bg-gray-900">
          <div className="text-center space-y-4">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-white border-t-transparent" />
            <p className="text-gray-300 text-sm">Iniciando…</p>
          </div>
        </div>
      )}

      {state.screen === 'license-error' && (
        <LicenseErrorScreen reason={state.reason} message={state.message} />
      )}

      {state.screen === 'activation' && (
        <ActivationScreen licenseKey={state.licenseKey} onActivated={handleActivated} />
      )}

      {state.screen === 'login' && (
        <LoginScreen
          businessName={state.initStatus.businessName}
          onLogin={handleLogin}
        />
      )}

      {state.screen === 'shift-required' && (
        <OpenShiftScreen
          onShiftOpened={handleShiftOpened}
          onCancel={state.session.role === 'admin' ? handleReturnToAdminHub : undefined}
        />
      )}

      {state.screen === 'cashier' && (
        <CashierScreen
          session={state.session}
          shift={state.shift}
          onLogout={handleLogout}
          onCloseShift={handleGoToCloseShift}
          onReturnToHub={state.session.role === 'admin' ? handleReturnToAdminHub : undefined}
          onViewDebts={() => setState({ screen: 'debts', session: state.session, initStatus: state.initStatus, fromCashier: state.shift })}
          onViewSpecialCustomers={() => setState({ screen: 'special-customers', session: state.session, initStatus: state.initStatus, fromCashier: state.shift })}
        />
      )}

      {state.screen === 'close-shift' && (
        <CloseShiftScreen
          onConfirmed={() => void handleShiftClosed()}
          onCancel={() => {
            const session = state.session
            const initStatus = state.initStatus
            // Para volver a caja necesitamos el ShiftInfo; lo recuperamos del main.
            void window.hw.getActiveShift().then(r => {
              if (r.ok && r.data) {
                setState({ screen: 'cashier', session, shift: r.data, initStatus })
              } else {
                setState({ screen: 'shift-required', session, initStatus })
              }
            })
          }}
        />
      )}

      {state.screen === 'admin-hub' && (
        <AdminHubScreen
          session={state.session}
          initStatus={state.initStatus}
          onGoToAdminPanel={handleAdminGoToPanel}
          onGoToCashier={() => void handleAdminGoToCashier()}
          onGoToCashierManagement={handleGoToCashierManagement}
          onGoToDebts={() => setState({ screen: 'debts', session: state.session, initStatus: state.initStatus })}
          onGoToSpecialCustomers={() => setState({ screen: 'special-customers', session: state.session, initStatus: state.initStatus })}
          onLogout={handleLogout}
        />
      )}

      {state.screen === 'admin' && (
        <AdminScreen
          session={state.session}
          onLogout={handleLogout}
          onReturnToHub={handleReturnToAdminHub}
        />
      )}

      {state.screen === 'cashier-management' && (
        <CashierManagementScreen
          onBack={handleReturnToAdminHub}
        />
      )}

      {state.screen === 'debts' && (
        <DebtsScreen
          onBack={() => {
            if (state.fromCashier) {
              setState({ screen: 'cashier', session: state.session, shift: state.fromCashier, initStatus: state.initStatus })
            } else {
              handleReturnToAdminHub()
            }
          }}
        />
      )}

      {state.screen === 'special-customers' && (
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
      )}

      {/* Modal de aviso de inactividad — overlay global */}
      {showInactivityWarning && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl border border-amber-500/40 w-full max-w-sm p-6 shadow-2xl space-y-4 text-center">
            <div className="text-4xl">⏰</div>
            <h2 className="text-lg font-bold text-white">¿Seguís trabajando?</h2>
            <p className="text-sm text-gray-400">
              No hubo actividad en la caja por un tiempo. Si no respondés, el turno se cerrará
              automáticamente para proteger los registros.
            </p>
            <div className="text-3xl font-mono font-bold text-amber-400">{countdownDisplay}</div>
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => void handleDismissInactivity()}
                className="w-full py-3 rounded-xl bg-green-700 hover:bg-green-600 font-semibold text-white transition-colors"
              >
                Seguir trabajando
              </button>
              <button
                onClick={handleGoToCloseShift}
                className="w-full py-3 rounded-xl bg-red-700 hover:bg-red-600 font-semibold text-white transition-colors"
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
