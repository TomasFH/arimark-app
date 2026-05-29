import { useEffect, useState } from 'react'
import { SandboxBanner } from './components/SandboxBanner'
import LoginScreen from './routes/LoginScreen'
import ActivationScreen from './routes/ActivationScreen'
import LicenseErrorScreen from './routes/LicenseErrorScreen'
import OpenShiftScreen from './routes/OpenShiftScreen'
import CashierScreen from './routes/CashierScreen'
import type { InitStatus, SessionInfo, ShiftInfo } from './types/hw-api'

type AppState =
  | { screen: 'loading' }
  | { screen: 'license-error'; reason: InitStatus['licenseReason'] & string; message: string }
  | { screen: 'activation'; licenseKey: string }
  | { screen: 'login'; initStatus: InitStatus }
  | { screen: 'shift-required'; session: SessionInfo; initStatus: InitStatus }
  | { screen: 'cashier'; session: SessionInfo; shift: ShiftInfo; initStatus: InitStatus }
  | { screen: 'admin'; session: SessionInfo; initStatus: InitStatus }

export default function App() {
  const [state, setState] = useState<AppState>({ screen: 'loading' })

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

  async function handleCashierLogin(username: string, password: string): Promise<void> {
    if (state.screen !== 'login') return
    const result = await window.hw.loginCashier({ username, password, storeId: state.initStatus.defaultStoreId })
    if (!result.ok) throw new Error(result.error)

    const session = result.data
    // Verificar si hay un turno activo antes de mostrar el POS
    const shiftResult = await window.hw.getActiveShift()
    if (shiftResult.ok && shiftResult.data) {
      setState({ screen: 'cashier', session, shift: shiftResult.data, initStatus: state.initStatus })
    } else {
      setState({ screen: 'shift-required', session, initStatus: state.initStatus })
    }
  }

  async function handleAdminLogin(email: string, password: string): Promise<void> {
    if (state.screen !== 'login') return
    const result = await window.hw.loginAdmin({ email, password })
    if (!result.ok) throw new Error(result.error)
    setState({ screen: 'admin', session: result.data, initStatus: state.initStatus })
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

  return (
    <div className="min-h-screen">
      <SandboxBanner />

      {state.screen === 'loading' && (
        <div className="flex min-h-screen items-center justify-center bg-gray-900">
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
          onCashierLogin={handleCashierLogin}
          onAdminLogin={handleAdminLogin}
        />
      )}

      {state.screen === 'shift-required' && (
        <OpenShiftScreen onShiftOpened={handleShiftOpened} />
      )}

      {state.screen === 'cashier' && (
        <CashierScreen
          session={state.session}
          shift={state.shift}
          onLogout={handleLogout}
        />
      )}

      {state.screen === 'admin' && (
        <div className="flex min-h-screen items-center justify-center bg-gray-900">
          <div className="text-center space-y-3">
            <p className="text-lg font-semibold text-white">Panel de administrador</p>
            <p className="text-sm text-gray-400">Disponible en Fase 5</p>
            <button
              onClick={handleLogout}
              className="mt-4 rounded-lg bg-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
