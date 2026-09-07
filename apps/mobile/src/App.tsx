/**
 * Orquestador de flujo del POS móvil (app nativa Capacitor, offline-first).
 *
 * Flujo:
 *   [arranque] restaurar sesión persistida
 *     → admin: hub (puede entrar a POS con “Operar como cajera”)
 *     → cajera: si hay turno abierto de esa cuenta en este celu → POS de ese local
 *     → si no, selector de local (si hay >1) → abrir turno → POS
 *
 * No hay PIN ni claves offline: la sesión de Firebase queda guardada en el
 * dispositivo tras el primer login con internet. Al reconectar, se resincroniza
 * el catálogo y se suben los turnos/ventas pendientes automáticamente.
 */
import { useEffect, useRef, useState } from 'react'
import { StoreSelector } from './components/StoreSelector'
import { OpenShiftScreen } from './components/OpenShiftScreen'
import { PosScreen } from './components/PosScreen'
import { AdminDashboard } from './components/AdminDashboard'
import { ButcherApp } from './components/butcher/ButcherApp'
import { signIn, signOut, restoreSession, revalidateProfileAccess, subscribeUserAccess, ACCESS_REVOKED_MESSAGE } from './lib/auth'
import { syncCatalog, getCatalog, startCatalogLiveListener, stopCatalogLiveListener } from './lib/catalog'
import { db } from './lib/db'
import { triggerSync, registerOnlineListener } from './lib/sync'
import { useOnlineStatus, isOnline } from './lib/connectivity'
import { setEmptyBackHandler, exitApp, cancelPendingExit } from './lib/backStack'
import { v4 as uuidv4 } from 'uuid'
import { loadCashierStoreOptions, type CashierStoreOption } from './lib/cashierStores'
import { pickOpenShiftForUser } from './lib/sessionResume'
import type { LocalProfile, CatalogProduct, LocalShift, ShiftType } from './types/pos'

type Screen =
  | 'checking'
  | 'login'
  | 'admin'
  | 'butcher'
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
  const [cashierStores, setCashierStores] = useState<CashierStoreOption[]>([])
  const [exitConfirm, setExitConfirm] = useState(false)
  const exitConfirmRef = useRef(false)

  const online = useOnlineStatus()
  const prevOnline = useRef(online)
  const sessionRef = useRef(session)
  const kickingOutRef = useRef(false)
  sessionRef.current = session

  useEffect(() => {
    exitConfirmRef.current = exitConfirm
  }, [exitConfirm])

  useEffect(() => {
    setEmptyBackHandler(() => {
      if (exitConfirmRef.current) {
        void exitApp()
        return
      }
      setExitConfirm(true)
    })
    return () => setEmptyBackHandler(null)
  }, [])

  // Restaurar sesión persistida al arrancar.
  useEffect(() => {
    let cancelled = false
    restoreSession().then((result) => {
      if (cancelled) return
      if (result.ok) {
        afterAuthentication(result.profile, result.mode)
      } else {
        if (result.error) setLoginError(result.error)
        setScreen('login')
      }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Al recuperar conexión: revalidar acceso, resincronizar catálogo y subir pendientes.
  useEffect(() => {
    const reconnected = !prevOnline.current && online
    prevOnline.current = online
    if (!reconnected || !session) return

    ;(async () => {
      const access = await revalidateProfileAccess(session.profile.uid, session.profile.email)
      if (access === 'revoked') {
        await kickOutRevokedAccess()
        return
      }
      if (!session.storeId) return
      await syncCatalog(session.storeId)
      const cat = await getCatalog(session.storeId)
      setCatalog(cat)
      triggerSync().catch(() => { /* silencioso */ })
    })()
  }, [online, session])

  // Si el admin revoca el acceso con la app abierta, cerrar sesión al instante.
  useEffect(() => {
    const uid = session?.profile.uid
    if (!uid || screen === 'login' || screen === 'checking') return undefined
    return subscribeUserAccess(uid, () => {
      void kickOutRevokedAccess()
    })
  }, [session?.profile.uid, screen])

  // Catálogo en vivo mientras hay local de POS (cambio de local / logout → stop + start).
  useEffect(() => {
    const storeId = session?.storeId
    const live =
      Boolean(storeId)
      && (screen === 'pos' || screen === 'open-shift' || screen === 'loading')
    if (!storeId || !live) {
      stopCatalogLiveListener()
      return undefined
    }
    startCatalogLiveListener(storeId, () => {
      void getCatalog(storeId).then(setCatalog)
    })
    return () => {
      stopCatalogLiveListener()
    }
  }, [session?.storeId, screen])

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
    if (profile.role === 'admin') {
      setSession({ profile, storeId: '', loginMode: mode })
      setScreen('admin')
      return
    }

    if (profile.role === 'butcher') {
      setSession({ profile, storeId: '', loginMode: mode })
      setScreen('butcher')
      return
    }

    setScreen('loading')
    const options = await loadCashierStoreOptions(profile.authorizedStores)
    setCashierStores(options)

    const openShift = pickOpenShiftForUser(
      await db.shifts.toArray(),
      profile.uid,
    )
    if (openShift) {
      const sess: SessionState = { profile, storeId: openShift.storeId, loginMode: mode }
      setSession(sess)
      await loadStoreContext(sess)
      return
    }

    if (options.length === 1) {
      const sess: SessionState = { profile, storeId: options[0]!.id, loginMode: mode }
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
    if (session?.profile.role === 'admin') {
      setScreen('admin')
    } else {
      setScreen('open-shift')
    }
    triggerSync().catch(() => { /* silencioso */ })
  }

  async function startAdminPos() {
    if (!session) return
    setScreen('loading')
    const options = await loadCashierStoreOptions(session.profile.authorizedStores)
    setCashierStores(options)

    const openShift = pickOpenShiftForUser(
      await db.shifts.toArray(),
      session.profile.uid,
    )
    if (openShift) {
      const sess: SessionState = { ...session, storeId: openShift.storeId }
      setSession(sess)
      await loadStoreContext(sess)
      return
    }

    if (options.length === 1) {
      const sess: SessionState = { ...session, storeId: options[0]!.id }
      setSession(sess)
      await loadStoreContext(sess)
      return
    }

    setScreen('store-select')
  }

  function returnToAdminHub() {
    setActiveShift(null)
    setScreen('admin')
  }

  const storeName = cashierStores.find(s => s.id === session?.storeId)?.name ?? session?.storeId ?? ''

  async function handleLogout() {
    stopCatalogLiveListener()
    await signOut().catch(() => { /* silencioso en offline */ })
    setSession(null)
    setActiveShift(null)
    setCatalog([])
    setScreen('login')
    setLoginError(null)
  }

  async function kickOutRevokedAccess() {
    if (kickingOutRef.current) return
    kickingOutRef.current = true
    stopCatalogLiveListener()
    const uid = sessionRef.current?.profile.uid
    if (uid) await db.profile.delete(uid).catch(() => undefined)
    await signOut().catch(() => undefined)
    setSession(null)
    setActiveShift(null)
    setCatalog([])
    setLoginError(ACCESS_REVOKED_MESSAGE)
    setScreen('login')
    kickingOutRef.current = false
  }

  // ----- Render -----

  function renderScreen() {
    if (screen === 'checking') {
      return <FullScreenSpinner label="Abriendo..." />
    }

    if (screen === 'login') {
      return (
        <div className="h-full min-h-0 bg-gray-950 flex items-center justify-center p-4">
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

    if (screen === 'admin' && session) {
      return (
        <AdminDashboard
          profile={session.profile}
          onLogout={handleLogout}
          onOperateAsCashier={() => { void startAdminPos() }}
        />
      )
    }

    if (screen === 'butcher' && session) {
      return (
        <ButcherApp
          profile={session.profile}
          onLogout={handleLogout}
        />
      )
    }

    if (screen === 'store-select' && session) {
      return (
        <StoreSelector
          stores={cashierStores}
          onSelect={handleStoreSelect}
          onBack={session.profile.role === 'admin' ? () => setScreen('admin') : handleLogout}
        />
      )
    }

    if (screen === 'loading') {
      return <FullScreenSpinner label="Cargando..." />
    }

    if (screen === 'open-shift' && session) {
      const isAdmin = session.profile.role === 'admin'
      return (
        <OpenShiftScreen
          displayName={session.profile.displayName}
          storeName={storeName}
          onOpen={handleOpenShift}
          onLogout={isAdmin ? returnToAdminHub : handleLogout}
          logoutLabel={isAdmin ? 'Hub admin' : 'Salir'}
          onBack={
            isAdmin
              ? (cashierStores.length > 1 ? () => setScreen('store-select') : returnToAdminHub)
              : (cashierStores.length > 1 ? () => setScreen('store-select') : handleLogout)
          }
        />
      )
    }

    if (screen === 'pos' && session && activeShift) {
      return (
        <PosScreen
          shift={activeShift}
          catalog={catalog}
          storeName={storeName}
          viewerRole={session.profile.role as 'admin' | 'cashier'}
          viewerName={session.profile.displayName}
          onCloseShift={handleCloseShift}
          onReturnToAdmin={session.profile.role === 'admin' ? returnToAdminHub : undefined}
        />
      )
    }

    return null
  }

  return (
    <div className={`h-full min-h-0 ${!online ? 'pb-10' : ''}`}>
      {renderScreen()}
      {!online && <OfflineBanner />}
      {exitConfirm && (
        <ExitAppModal
          onCancel={() => {
            cancelPendingExit()
            setExitConfirm(false)
          }}
          onConfirm={() => { void exitApp() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

function ExitAppModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-lg font-bold text-white">¿Seguro querés salir de la app?</h2>
        <p className="text-sm text-zinc-400">
          Si hay un turno abierto, sigue en este celular. Atrás otra vez también sale.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-zinc-700 bg-zinc-800 py-3 text-sm font-semibold text-zinc-200"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-red-600 py-3 text-sm font-bold text-white"
          >
            Salir
          </button>
        </div>
      </div>
    </div>
  )
}

function FullScreenSpinner({ label }: { label: string }) {
  return (
    <div className="h-full min-h-0 bg-gray-950 flex items-center justify-center">
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
