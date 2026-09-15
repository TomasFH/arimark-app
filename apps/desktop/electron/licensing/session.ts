/**
 * Sistema de autenticación por rol — Firebase Auth para cajeras y admins.
 *
 * Ambos roles se autentican con email + contraseña contra Firebase Auth.
 * El rol y los locales autorizados se resuelven leyendo el perfil en
 * Firestore: `licenses/{key}/users/{uid}`. Firebase Auth es la única
 * fuente de identidad — no hay control de concurrencia adicional (una
 * cajera puede estar logueada en la PC y en su celular al mismo tiempo,
 * caso de uso central de la app móvil companion).
 *
 * En modo dev (APP_ENV=dev) Firebase está desactivado por completo: se
 * acepta cualquier email/contraseña y se fabrica un perfil determinístico
 * a partir del email, sin verificar rol ni locales autorizados.
 *
 * Los datos operativos (turnos, ventas, stock) son 100% locales en SQLite
 * y no dependen de Firebase — solo el acto de login lo requiere.
 */

import { getFirestore, doc, getDoc } from 'firebase/firestore'
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { getFirebaseApp } from './firebase'
import { getSecret, setSecret, deleteSecret, SECRET_KEYS } from '../secureStorage'
import { cacheCredentials, validateOffline } from '../offlineAuth'
import log from 'electron-log'

export const GENERIC_LOGIN_ERROR = 'Credenciales incorrectas o sin conexión.'

export type UserRole = 'cashier' | 'admin'

/** Nombre de Firestore; si viene vacío, el local-part del email (nunca string vacío). */
export function resolveProfileDisplayName(raw: string | undefined, email: string): string {
  const fromProfile = raw?.trim() ?? ''
  if (fromProfile) return fromProfile
  const fromEmail = email.split('@')[0]?.trim() ?? ''
  return fromEmail || email
}

export interface UserProfile {
  uid: string
  email: string
  role: UserRole
  authorizedStores: string[]
  displayName: string
  active: boolean
}

export interface AdminSession {
  uid: string
  email: string
  expiresAt: Date
}

export type SignInResult =
  | { ok: true; profile: UserProfile; offlineSession?: boolean }
  | { ok: false; error: string }

export type OnlineReverifyResult = 'upgraded' | 'disabled' | 'still_offline' | 'invalid'

function firebaseAuthCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  return ''
}

export function isNetworkAuthError(err: unknown): boolean {
  const code = firebaseAuthCode(err)
  if (code === 'auth/network-request-failed' || code === 'auth/timeout') return true
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('auth/network-request-failed') || message.includes('auth/timeout')
}

function tryCacheCredentials(email: string, password: string, profile: UserProfile): void {
  try {
    cacheCredentials(email, password, profile)
  } catch (err) {
    log.warn('[session] No se pudo cachear credenciales offline', err)
  }
}

function tryOfflineSignIn(email: string, password: string, expectedRole?: UserRole): SignInResult {
  const offline = validateOffline(email, password)
  if (!offline) return { ok: false, error: GENERIC_LOGIN_ERROR }
  if (expectedRole && offline.role !== expectedRole) {
    return { ok: false, error: 'Esta cuenta no tiene el permiso necesario.' }
  }
  return {
    ok: true,
    offlineSession: true,
    profile: {
      uid: offline.userId,
      email: offline.email,
      role: offline.role,
      authorizedStores: offline.authorizedStores,
      displayName: offline.name,
      active: true,
    },
  }
}

function handleAuthCatch(err: unknown, email: string, password: string, expectedRole?: UserRole): SignInResult {
  if (isNetworkAuthError(err)) {
    return tryOfflineSignIn(email, password, expectedRole)
  }
  const message = err instanceof Error ? err.message : String(err)
  log.error('[session] Error de autenticación', message)
  return { ok: false, error: GENERIC_LOGIN_ERROR }
}

// ---------------------------------------------------------------------------
// Autenticación — común a cajeras y admins
// ---------------------------------------------------------------------------

/**
 * Autentica contra Firebase Auth y resuelve el perfil de rol en Firestore.
 * Rechaza si el perfil no existe, está inactivo, o el rol no coincide con
 * `expectedRole`. No verifica `authorizedStores` — eso es responsabilidad
 * del llamador (solo aplica a cajeras, que operan un local específico).
 */
export async function signInWithRole(
  licenseKey: string,
  email: string,
  password: string,
  expectedRole: UserRole
): Promise<SignInResult> {
  const APP_ENV = process.env['APP_ENV'] ?? 'dev'

  if (APP_ENV === 'dev') {
    const uid = `dev-${expectedRole}-${email.trim().toLowerCase()}`
    return {
      ok: true,
      profile: {
        uid,
        email,
        role: expectedRole,
        authorizedStores: [],
        displayName: email.split('@')[0] || email,
        active: true,
      },
    }
  }

  try {
    const app = getFirebaseApp()
    const auth = getAuth(app)
    const credential = await signInWithEmailAndPassword(auth, email, password)
    const uid = credential.user.uid

    // Fuerza un refresh del ID token para que Firestore use el token del usuario
    // email/password y no el token anónimo cacheado de signInAnon() previo.
    await credential.user.getIdToken(true)

    const db = getFirestore(app)
    const profileRef = doc(db, 'licenses', licenseKey, 'users', uid)
    const snap = await getDoc(profileRef)

    if (!snap.exists()) {
      log.warn('[session] Login sin perfil en Firestore', { uid, expectedRole })
      return { ok: false, error: 'Usuario no autorizado.' }
    }

    const data = snap.data() as {
      role: UserRole
      authorizedStores?: string[]
      displayName?: string
      active?: boolean
    }

    if (data.active === false) {
      return { ok: false, error: 'Usuario desactivado. Contactar al administrador.' }
    }
    if (data.role !== expectedRole) {
      log.warn('[session] Rol no coincide', { uid, expected: expectedRole, actual: data.role })
      return { ok: false, error: 'Esta cuenta no tiene el permiso necesario.' }
    }

    const profile: UserProfile = {
      uid,
      email: credential.user.email ?? email,
      role: data.role,
      authorizedStores: data.authorizedStores ?? [],
      displayName: resolveProfileDisplayName(data.displayName, credential.user.email ?? email),
      active: true,
    }

    tryCacheCredentials(email, password, profile)
    log.info('[session] Login exitoso', { uid, role: expectedRole })
    return { ok: true, profile }
  } catch (err) {
    return handleAuthCatch(err, email, password, expectedRole)
  }
}

/**
 * Igual que signInWithRole pero detecta el rol automáticamente desde Firestore,
 * sin que el llamador lo especifique. Usado por el login unificado.
 *
 * En dev: infiere el rol del email (contiene "admin" → admin, resto → cashier).
 */
export async function signInAutoDetect(
  licenseKey: string,
  email: string,
  password: string,
): Promise<SignInResult> {
  const APP_ENV = process.env['APP_ENV'] ?? 'dev'

  if (APP_ENV === 'dev') {
    const role: UserRole = email.toLowerCase().includes('admin') ? 'admin' : 'cashier'
    const uid = `dev-${role}-${email.trim().toLowerCase()}`
    return {
      ok: true,
      profile: {
        uid,
        email,
        role,
        authorizedStores: [],
        displayName: email.split('@')[0] || email,
        active: true,
      },
    }
  }

  try {
    const app = getFirebaseApp()
    const auth = getAuth(app)
    const credential = await signInWithEmailAndPassword(auth, email, password)
    const uid = credential.user.uid
    await credential.user.getIdToken(true)

    const db = getFirestore(app)
    const profileRef = doc(db, 'licenses', licenseKey, 'users', uid)
    const snap = await getDoc(profileRef)

    if (!snap.exists()) {
      log.warn('[session] Login sin perfil en Firestore', { uid })
      return { ok: false, error: 'Usuario no autorizado.' }
    }

    const data = snap.data() as {
      role?: string
      authorizedStores?: string[]
      displayName?: string
      active?: boolean
    }

    if (data.active === false) {
      return { ok: false, error: 'Usuario desactivado. Contactar al administrador.' }
    }
    if (data.role === 'butcher') {
      log.warn('[session] Carnicero intentó iniciar sesión en desktop', { uid })
      return { ok: false, error: 'Esta cuenta es solo para el celular. Iniciá sesión desde la app del carnicero.' }
    }
    if (data.role !== 'cashier' && data.role !== 'admin') {
      log.warn('[session] Rol desconocido en Firestore', { uid, role: data.role })
      return { ok: false, error: 'Rol no reconocido. Contactar al administrador.' }
    }

    const profile: UserProfile = {
      uid,
      email: credential.user.email ?? email,
      role: data.role,
      authorizedStores: data.authorizedStores ?? [],
      displayName: resolveProfileDisplayName(data.displayName, credential.user.email ?? email),
      active: true,
    }

    tryCacheCredentials(email, password, profile)
    log.info('[session] Login autodetect exitoso', { uid, role: data.role })
    return { ok: true, profile }
  } catch (err) {
    return handleAuthCatch(err, email, password)
  }
}

// ---------------------------------------------------------------------------
// Admins — sesión local efímera (24h) via safeStorage
// ---------------------------------------------------------------------------

export async function loginAdmin(
  licenseKey: string,
  email: string,
  password: string
): Promise<{ ok: true; session: AdminSession; offlineSession?: boolean } | { ok: false; error: string }> {
  const result = await signInWithRole(licenseKey, email, password, 'admin')
  if (!result.ok) return result

  const session: AdminSession = {
    uid: result.profile.uid,
    email: result.profile.email,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }
  await setSecret(SECRET_KEYS.ADMIN_SESSION_TOKEN, JSON.stringify(session))
  return { ok: true, session, offlineSession: result.offlineSession }
}

export async function logoutAdmin(): Promise<void> {
  deleteSecret(SECRET_KEYS.ADMIN_SESSION_TOKEN)
  const APP_ENV = process.env['APP_ENV'] ?? 'dev'
  if (APP_ENV === 'dev') return

  try {
    const app = getFirebaseApp()
    const auth = getAuth(app)
    await firebaseSignOut(auth)
  } catch (err) {
    log.warn('[session] Error al cerrar sesión admin', err)
  }
}

export function getStoredAdminSession(): AdminSession | null {
  const raw = getSecret(SECRET_KEYS.ADMIN_SESSION_TOKEN)
  if (!raw) return null
  try {
    const session = JSON.parse(raw) as AdminSession
    if (new Date(session.expiresAt) < new Date()) {
      deleteSecret(SECRET_KEYS.ADMIN_SESSION_TOKEN)
      return null
    }
    return session
  } catch {
    return null
  }
}

/**
 * Re-verifica contra Firebase sin caer al hash local.
 * Usado cuando una sesión offline recupera internet.
 */
export async function reverifyOnlineOnly(
  licenseKey: string,
  email: string,
  password: string,
): Promise<OnlineReverifyResult> {
  const APP_ENV = process.env['APP_ENV'] ?? 'dev'
  if (APP_ENV === 'dev') return 'upgraded'

  try {
    const app = getFirebaseApp()
    const auth = getAuth(app)
    const credential = await signInWithEmailAndPassword(auth, email, password)
    await credential.user.getIdToken(true)

    const db = getFirestore(app)
    const profileRef = doc(db, 'licenses', licenseKey, 'users', credential.user.uid)
    const snap = await getDoc(profileRef)

    if (!snap.exists()) return 'invalid'
    const data = snap.data() as {
      role?: string
      authorizedStores?: string[]
      displayName?: string
      active?: boolean
    }
    if (data.active === false) return 'disabled'
    if (data.role !== 'cashier' && data.role !== 'admin') return 'invalid'

    const profile: UserProfile = {
      uid: credential.user.uid,
      email: credential.user.email ?? email,
      role: data.role,
      authorizedStores: data.authorizedStores ?? [],
      displayName: resolveProfileDisplayName(data.displayName, credential.user.email ?? email),
      active: true,
    }
    tryCacheCredentials(email, password, profile)
    return 'upgraded'
  } catch (err) {
    if (firebaseAuthCode(err) === 'auth/user-disabled') return 'disabled'
    if (isNetworkAuthError(err)) return 'still_offline'
    return 'invalid'
  }
}
