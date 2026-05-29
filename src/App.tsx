import { useEffect, useState } from 'react'
import { SandboxBanner } from './components/SandboxBanner'
import LoginScreen from './routes/LoginScreen'
import ActivationScreen from './routes/ActivationScreen'
import LicenseErrorScreen from './routes/LicenseErrorScreen'
import type { InitStatus, SessionInfo } from './types/hw-api'

type AppState =
  | { screen: 'loading' }
  | { screen: 'license-error'; reason: InitStatus['licenseReason'] & string; message: string }
  | { screen: 'activation'; licenseKey: string }
  | { screen: 'login'; initStatus: InitStatus }
  | { screen: 'app'; session: SessionInfo; initStatus: InitStatus }

export default function App() {
  const [state, setState] = useState<AppState>({ screen: 'loading' })

  useEffect(() => {
    window.hw.getInitStatus().then(result => {
      if (!result.ok) {
        setState({
          screen: 'license-error',
          reason: 'error',
          message: result.error ?? 'Error al inicializar la aplicación.',
        })
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
      setState({
        screen: 'license-error',
        reason: 'error',
        message: 'No se pudo contactar al proceso principal. Reiniciar la aplicación.',
      })
    })
  }, [])

  async function handleCashierLogin(username: string, password: string): Promise<void> {
    if (state.screen !== 'login') return
    const result = await window.hw.loginCashier({
      username,
      password,
      storeId: state.initStatus.defaultStoreId,
    })
    if (!result.ok) throw new Error(result.error)
    setState({ screen: 'app', session: result.data, initStatus: state.initStatus })
  }

  async function handleAdminLogin(email: string, password: string): Promise<void> {
    if (state.screen !== 'login') return
    const result = await window.hw.loginAdmin({ email, password })
    if (!result.ok) throw new Error(result.error)
    setState({ screen: 'app', session: result.data, initStatus: state.initStatus })
  }

  function handleActivated(): void {
    if (state.screen !== 'activation') return
    // Volver a consultar initStatus para obtener defaultStoreId y businessName
    window.hw.getInitStatus().then(result => {
      if (result.ok) {
        setState({ screen: 'login', initStatus: { ...result.data, needsActivation: false } })
      }
    })
  }

  return (
    <div className="min-h-screen">
      <SandboxBanner />

      {state.screen === 'loading' && (
        <div className="flex min-h-screen items-center justify-center bg-gray-900">
          <div className="text-center space-y-4">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-white border-t-transparent" />
            <p className="text-gray-300 text-sm">Iniciando...</p>
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

      {state.screen === 'app' && (
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <div className="text-center space-y-2">
            <p className="text-lg font-semibold text-gray-800">
              Bienvenido — {state.session.role === 'cashier' ? 'Cajera' : 'Admin'}
            </p>
            <p className="text-sm text-gray-500">Punto de venta — Fase 2</p>
          </div>
        </div>
      )}
    </div>
  )
}
