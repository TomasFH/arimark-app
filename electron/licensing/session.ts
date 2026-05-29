/**
 * Sistema de sesiones por rol.
 *
 * Cajeras:
 *   - Token en Firestore licenses/{key}/sessions/{storeId}
 *   - Solo una cajera por local a la vez
 *   - Renovación automática cada 30min mientras la app está en uso
 *   - Expiración automática si la app se cierra inesperadamente
 *
 * Admins:
 *   - Autenticación via Firebase Auth (email/contraseña) — no viven en users
 *   - Sesión local efímera via safeStorage
 *   - Sesiones simultáneas ilimitadas desde cualquier dispositivo
 */

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore'
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { getFirebaseApp } from './firebase'
import { getSecret, setSecret, deleteSecret, SECRET_KEYS } from '../secureStorage'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'

const SESSION_DURATION_MINUTES = 30
const SESSION_DURATION_MS = SESSION_DURATION_MINUTES * 60 * 1000

export interface CashierSession {
  token: string
  userId: string
  storeId: string
  expiresAt: Date
}

export interface AdminSession {
  uid: string
  email: string
  expiresAt: Date
}

// ---------------------------------------------------------------------------
// Cajeras
// ---------------------------------------------------------------------------

/**
 * Inicia sesión de cajera en un local específico.
 * Verifica que no haya otra cajera activa en ese local.
 */
export async function startCashierSession(
  licenseKey: string,
  storeId: string,
  userId: string
): Promise<{ ok: true; session: CashierSession } | { ok: false; error: string }> {
  const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'

  if (APP_ENV === 'sandbox') {
    const session: CashierSession = {
      token: uuidv4(),
      userId,
      storeId,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    }
    await setSecret(SECRET_KEYS.CASHIER_SESSION_TOKEN, JSON.stringify(session))
    return { ok: true, session }
  }

  try {
    const app = getFirebaseApp()
    const db = getFirestore(app)
    const sessionRef = doc(db, 'licenses', licenseKey, 'sessions', storeId)
    const snap = await getDoc(sessionRef)

    if (snap.exists()) {
      const data = snap.data() as { cashier_session_expires: Timestamp | null }
      if (data.cashier_session_expires) {
        const expiry = data.cashier_session_expires.toDate()
        if (expiry > new Date()) {
          return {
            ok: false,
            error: `Ya hay una cajera con sesión activa en este local hasta las ${expiry.toLocaleTimeString('es-AR')}.`,
          }
        }
      }
    }

    const token = uuidv4()
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)

    await setDoc(sessionRef, {
      cashier_session_token: token,
      cashier_session_expires: Timestamp.fromDate(expiresAt),
    })

    const session: CashierSession = { token, userId, storeId, expiresAt }
    await setSecret(SECRET_KEYS.CASHIER_SESSION_TOKEN, JSON.stringify(session))

    log.info('[session] Sesión de cajera iniciada', { storeId, userId })
    return { ok: true, session }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('[session] Error al iniciar sesión de cajera', message)
    return { ok: false, error: message }
  }
}

/**
 * Renueva el token de sesión de cajera (llamar cada 30min).
 */
export async function renewCashierSession(
  licenseKey: string,
  storeId: string,
  session: CashierSession
): Promise<boolean> {
  const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'
  const newExpiry = new Date(Date.now() + SESSION_DURATION_MS)

  if (APP_ENV === 'sandbox') {
    const updated = { ...session, expiresAt: newExpiry }
    await setSecret(SECRET_KEYS.CASHIER_SESSION_TOKEN, JSON.stringify(updated))
    return true
  }

  try {
    const app = getFirebaseApp()
    const db = getFirestore(app)
    const sessionRef = doc(db, 'licenses', licenseKey, 'sessions', storeId)
    await setDoc(sessionRef, {
      cashier_session_token: session.token,
      cashier_session_expires: Timestamp.fromDate(newExpiry),
    })
    return true
  } catch (err) {
    log.error('[session] Error al renovar sesión de cajera', err)
    return false
  }
}

/**
 * Cierra la sesión de cajera.
 */
export async function endCashierSession(licenseKey: string, storeId: string): Promise<void> {
  const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'
  deleteSecret(SECRET_KEYS.CASHIER_SESSION_TOKEN)

  if (APP_ENV === 'sandbox') return

  try {
    const app = getFirebaseApp()
    const db = getFirestore(app)
    const sessionRef = doc(db, 'licenses', licenseKey, 'sessions', storeId)
    await deleteDoc(sessionRef)
    log.info('[session] Sesión de cajera cerrada', { storeId })
  } catch (err) {
    log.warn('[session] Error al cerrar sesión en Firestore (no crítico)', err)
  }
}

// ---------------------------------------------------------------------------
// Admins (Firebase Auth email/contraseña)
// ---------------------------------------------------------------------------

/**
 * Login de admin via Firebase Auth.
 * Crea sesión local efímera para no repetir el login en cada apertura.
 */
export async function loginAdmin(
  email: string,
  password: string
): Promise<{ ok: true; session: AdminSession; user: User } | { ok: false; error: string }> {
  const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'

  if (APP_ENV === 'sandbox') {
    const session: AdminSession = {
      uid: 'sandbox-admin-uid',
      email,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }
    await setSecret(SECRET_KEYS.ADMIN_SESSION_TOKEN, JSON.stringify(session))
    return { ok: true, session, user: { uid: session.uid, email } as User }
  }

  try {
    const app = getFirebaseApp()
    const auth = getAuth(app)
    const credential = await signInWithEmailAndPassword(auth, email, password)

    const session: AdminSession = {
      uid: credential.user.uid,
      email: credential.user.email ?? email,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }

    await setSecret(SECRET_KEYS.ADMIN_SESSION_TOKEN, JSON.stringify(session))
    log.info('[session] Admin autenticado', { uid: session.uid })
    return { ok: true, session, user: credential.user }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('[session] Error en login admin', message)
    return { ok: false, error: 'Credenciales incorrectas o sin conexión.' }
  }
}

export async function logoutAdmin(): Promise<void> {
  deleteSecret(SECRET_KEYS.ADMIN_SESSION_TOKEN)
  const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'
  if (APP_ENV === 'sandbox') return

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

export function getStoredCashierSession(): CashierSession | null {
  const raw = getSecret(SECRET_KEYS.CASHIER_SESSION_TOKEN)
  if (!raw) return null
  try {
    const session = JSON.parse(raw) as CashierSession
    if (new Date(session.expiresAt) < new Date()) {
      deleteSecret(SECRET_KEYS.CASHIER_SESSION_TOKEN)
      return null
    }
    return session
  } catch {
    return null
  }
}
