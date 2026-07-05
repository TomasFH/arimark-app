/**
 * Orquestador de flujo del POS móvil.
 *
 * Flujo:
 *   login (online o PIN offline)
 *     → [primer login] configurar PIN
 *     → selector de local (si hay más de uno)
 *     → descargar catálogo
 *     → (si no hay turno activo) abrir turno
 *     → POS (escanear, armar, cobrar)
 *     → al cerrar turno → volver al paso de abrir turno
 */
import { useState } from 'react'
import { SetupPinScreen } from './components/SetupPinScreen'
import { StoreSelector } from './components/StoreSelector'
import { OpenShiftScreen } from './components/OpenShiftScreen'
import { PosScreen } from './components/PosScreen'
import { signIn, signInWithPin, signOut } from './lib/auth'
import { hasPinConfigured } from './lib/pin'
import { syncCatalog, getCatalog } from './lib/catalog'
import { db } from './lib/db'
import { triggerSync, registerOnlineListener } from './lib/sync'
import { v4 as uuidv4 } from 'uuid'
import type { LocalProfile, CatalogProduct, LocalShift, ShiftType } from './types/pos'

type Screen =
  | 'login'
  | 'setup-pin'
  | 'store-select'
  | 'loading'
  | 'open-shift'
  | 'pos'

interface SessionState {
  profile: LocalProfile
  storeId: string
  loginMode: 'online' | 'offline'
}

registerOnlineListener()

export default function App() {
  const [screen, setScreen] = useState<Screen>('login')
  const [session, setSession] = useState<SessionState | null>(null)
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [activeShift, setActiveShift] = useState<LocalShift | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [showPinLogin, setShowPinLogin] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)

  async function handleLogin(email: string, password: string) {
    setLoginError(null)
    const result = await signIn(email, password)

    if (!result.ok) {
      if (result.canUsePan) {
        setShowPinLogin(true)
        setLoginError('Sin conexión. Podés ingresar con tu PIN de emergencia.')
      } else {
        setLoginError(result.error)
      }
      return
    }

    await afterAuthentication(result.profile, result.mode)
  }

  async function handlePinLogin() {
    setPinError(null)
    const result = await signInWithPin(pinInput)
    if (!result.ok) {
      setPinError(result.error)
      setPinInput('')
      return
    }
    setShowPinLogin(false)
    await afterAuthentication(result.profile, result.mode)
  }

  async function afterAuthentication(profile: LocalProfile, mode: 'online' | 'offline') {
    const { authorizedStores } = profile

    if (authorizedStores.length === 1) {
      const storeId = authorizedStores[0]!
      const sess: SessionState = { profile, storeId, loginMode: mode }
      setSession(sess)

      // Solo necesita PIN setup si fue login online y aún no tiene PIN.
      if (mode === 'online') {
        const hasPin = await hasPinConfigured()
        if (!hasPin) {
          setScreen('setup-pin')
          return
        }
      }
      await loadStoreContext(sess)
    } else {
      setSession({ profile, storeId: '', loginMode: mode })
      setScreen('store-select')
    }
  }

  async function handleStoreSelect(storeId: string) {
    if (!session) return
    const sess: SessionState = { ...session, storeId }
    setSession(sess)

    if (session.loginMode === 'online') {
      const hasPin = await hasPinConfigured()
      if (!hasPin) {
        setScreen('setup-pin')
        return
      }
    }
    await loadStoreContext(sess)
  }

  async function loadStoreContext(sess: SessionState) {
    setScreen('loading')

    // Descargar catálogo si hay internet (no bloquea si falla).
    if (navigator.onLine) {
      await syncCatalog(sess.storeId)
    }

    const cat = await getCatalog(sess.storeId)
    setCatalog(cat)

    // Buscar turno activo para este usuario en este local.
    const existing = await db.shifts
      .where('storeId').equals(sess.storeId)
      .filter(s => s.closedAt === null && s.userId === sess.profile.uid)
      .first()

    if (existing) {
      setActiveShift(existing)
      setScreen('pos')
    } else {
      setScreen('open-shift')
    }

    // Disparar sync en background.
    triggerSync().catch(() => { /* silencioso */ })
  }

  async function handleOpenShift(shiftType: ShiftType, openingCash: number) {
    if (!session) return

    const shift: LocalShift = {
      id: uuidv4(),
      storeId: session.storeId,
      userId: session.profile.uid,
      displayName: session.profile.displayName,
      shiftType,
      startedAt: new Date().toISOString(),
      closedAt: null,
      openingCash,
      closingCash: null,
      syncStatus: 'pending',
      syncedAt: null,
    }

    await db.shifts.add(shift)
    setActiveShift(shift)
    setScreen('pos')

    triggerSync().catch(() => { /* silencioso */ })
  }

  async function handleCloseShift() {
    setActiveShift(null)
    setScreen('open-shift')
    triggerSync().catch(() => { /* silencioso */ })
  }

  async function handleLogout() {
    await signOut().catch(() => { /* silencioso en offline */ })
    setSession(null)
    setActiveShift(null)
    setCatalog([])
    setScreen('login')
    setShowPinLogin(false)
    setPinInput('')
    setLoginError(null)
  }

  // ----- Render -----

  if (screen === 'login') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-600 rounded-2xl mb-4">
              <span className="text-white text-2xl">🥩</span>
            </div>
            <h1 className="text-white text-2xl font-bold">POS Móvil</h1>
            <p className="text-gray-400 text-sm mt-1">Iniciá sesión para continuar</p>
          </div>

          {!showPinLogin ? (
            <LoginFormFields
              error={loginError}
              onSubmit={handleLogin}
              onSwitchToPin={() => setShowPinLogin(true)}
            />
          ) : (
            <div className="space-y-4">
              <p className="text-orange-400 text-sm text-center">{loginError}</p>
              <div>
                <label className="block text-sm text-gray-300 mb-1">PIN de emergencia</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pinInput}
                  onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-xl tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="• • • •"
                />
              </div>
              {pinError && (
                <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
                  {pinError}
                </div>
              )}
              <button
                onClick={handlePinLogin}
                disabled={pinInput.length < 4}
                className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 text-white font-semibold rounded-lg px-4 py-3 transition-colors"
              >
                Ingresar con PIN
              </button>
              <button
                onClick={() => { setShowPinLogin(false); setLoginError(null) }}
                className="w-full text-gray-500 hover:text-gray-300 text-sm py-2 transition-colors"
              >
                ← Volver
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (screen === 'setup-pin' && session) {
    return (
      <SetupPinScreen
        uid={session.profile.uid}
        onDone={() => loadStoreContext(session)}
      />
    )
  }

  if (screen === 'store-select' && session) {
    return (
      <StoreSelector
        stores={session.profile.authorizedStores}
        onSelect={handleStoreSelect}
      />
    )
  }

  if (screen === 'loading') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Cargando...</p>
        </div>
      </div>
    )
  }

  if (screen === 'open-shift' && session) {
    return (
      <OpenShiftScreen
        displayName={session.profile.displayName}
        storeId={session.storeId}
        onOpen={handleOpenShift}
        onLogout={handleLogout}
      />
    )
  }

  if (screen === 'pos' && session && activeShift) {
    return (
      <PosScreen
        shift={activeShift}
        catalog={catalog}
        onCloseShift={handleCloseShift}
      />
    )
  }

  return null
}

// ---------------------------------------------------------------------------
// Sub-componente de formulario de login (email + contraseña)
// ---------------------------------------------------------------------------

interface LoginFormFieldsProps {
  error: string | null
  onSubmit: (email: string, password: string) => void
  onSwitchToPin: () => void
}

function LoginFormFields({ error, onSubmit, onSwitchToPin }: LoginFormFieldsProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await onSubmit(email.trim(), password)
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm text-gray-300 mb-1">Email</label>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-red-500"
          placeholder="cajera@local.com"
          required
        />
      </div>
      <div>
        <label className="block text-sm text-gray-300 mb-1">Contraseña</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-red-500"
          placeholder="••••••••"
          required
        />
      </div>

      {error && !error.includes('PIN') && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white font-semibold rounded-lg px-4 py-3 transition-colors"
      >
        {loading ? 'Iniciando sesión...' : 'Ingresar'}
      </button>

      <button
        type="button"
        onClick={onSwitchToPin}
        className="w-full text-gray-500 hover:text-gray-300 text-xs py-2 transition-colors"
      >
        ¿Sin internet? Ingresar con PIN
      </button>
    </form>
  )
}
