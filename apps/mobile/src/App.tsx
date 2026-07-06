/**
 * Orquestador de flujo del POS móvil (app nativa Capacitor, offline-first).
 *
 * Flujo:
 *   [arranque] restaurar sesión persistida (funciona sin internet)
 *     → si hay sesión → selector de local (si hay >1) → cargar contexto → POS
 *     → si no hay sesión → login (email + contraseña, requiere internet la 1ª vez)
 *
 * No hay PIN ni claves offline: la sesión de Firebase queda guardada en el
 * dispositivo tras el primer login con internet. Al reconectar, se resincroniza
 * el catálogo y se suben los turnos/ventas pendientes automáticamente.
 */
import { useEffect, useRef, useState } from 'react'
import { StoreSelector } from './components/StoreSelector'
import { OpenShiftScreen } from './components/OpenShiftScreen'
import { PosScreen } from './components/PosScreen'
import { signIn, signOut, restoreSession } from './lib/auth'
import { syncCatalog, getCatalog } from './lib/catalog'
import { db } from './lib/db'
import { triggerSync, registerOnlineListener } from './lib/sync'
import { useOnlineStatus, isOnline } from './lib/connectivity'
import { v4 as uuidv4 } from 'uuid'
import type { LocalProfile, CatalogProduct, LocalShift, ShiftType } from './types/pos'

type Screen =
  | 'checking'
  | 'login'
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
  const [screen, setScreen] = useState<Screen>('checking')
  const [session, setSession] = useState<SessionState | null>(null)
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [activeShift, setActiveShift] = useState<LocalShift | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)

  const online = useOnlineStatus()
  const prevOnline = useRef(online)

  // Restaurar sesión persistida al arrancar.
  useEffect(() => {
    let cancelled = false
    restoreSession().then((result) => {
      if (cancelled) return
      if (result.ok) {
        afterAuthentication(result.profile, result.mode)
      } else {
        setScreen('login')
      }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Al recuperar conexión: resincronizar catálogo y subir pendientes.
  useEffect(() => {
    const reconnected = !prevOnline.current && online
    prevOnline.current = online
    if (!reconnected || !session?.storeId) return

    ;(async () => {
      await syncCatalog(session.storeId)
      const cat = await getCatalog(session.storeId)
      setCatalog(cat)
      triggerSync().catch(() => { /* silencioso */ })
    })()
  }, [online, session])

  async function handleLogin(email: string, password: string) {
    setLoginError(null)
    const result = await signIn(email, password)
    if (!result.ok) {
      setLoginError(result.error)
      return
    }
    await afterAuthentication(result.profile, result.mode)
  }

  async function afterAuthentication(profile: LocalProfile, mode: 'online' | 'offline') {
    const { authorizedStores } = profile

    if (authorizedStores.length === 1) {
      const sess: SessionState = { profile, storeId: authorizedStores[0]!, loginMode: mode }
      setSession(sess)
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
    await loadStoreContext(sess)
  }

  async function loadStoreContext(sess: SessionState) {
    setScreen('loading')

    // Descargar catálogo si hay internet (no bloquea si falla).
    if (await isOnline()) {
      await syncCatalog(sess.storeId)
    }

    const cat = await getCatalog(sess.storeId)
    setCatalog(cat)

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
    setLoginError(null)
  }

  // ----- Render -----

  function renderScreen() {
    if (screen === 'checking') {
      return <FullScreenSpinner label="Abriendo..." />
    }

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
            <LoginFormFields error={loginError} online={online} onSubmit={handleLogin} />
          </div>
        </div>
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
      return <FullScreenSpinner label="Cargando..." />
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

  return (
    <div className={!online ? 'pb-10' : undefined}>
      {renderScreen()}
      {!online && <OfflineBanner />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

function FullScreenSpinner({ label }: { label: string }) {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400 text-sm">{label}</p>
      </div>
    </div>
  )
}

function OfflineBanner() {
  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-amber-500 text-black text-center text-sm font-medium py-2 px-4 shadow-lg">
      Sin conexión — trabajando offline. Se sincronizará al recuperar internet.
    </div>
  )
}

interface LoginFormFieldsProps {
  error: string | null
  online: boolean
  onSubmit: (email: string, password: string) => void
}

function LoginFormFields({ error, online, onSubmit }: LoginFormFieldsProps) {
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
      {!online && (
        <div className="bg-amber-900/40 border border-amber-700 text-amber-200 rounded-lg px-4 py-3 text-sm">
          El primer ingreso en este celular necesita internet. Después vas a poder
          usar la app sin conexión.
        </div>
      )}
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

      {error && (
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
    </form>
  )
}
