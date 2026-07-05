/**
 * Autenticación del POS móvil.
 *
 * Modos de login:
 *  1. Online (Firebase): verifica credenciales + perfil Firestore. Cachea perfil
 *     en IndexedDB para habilitar el login por PIN offline posteriormente.
 *  2. Offline por PIN: si Firebase falla por error de red, permite acceder usando
 *     el PIN configurado en este dispositivo. La sesión se marca como "offline"
 *     y se revalida automáticamente al recuperar conexión.
 *
 * El PIN se configura en el primer login exitoso (si el dispositivo no tiene uno).
 */
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth'
import { getFirestore, doc, getDoc } from 'firebase/firestore'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import { db } from './db'
import { verifyPin, getPinUid } from './pin'
import type { LocalProfile } from '../types/pos'

export type { LocalProfile }

export type SignInResult =
  | { ok: true; profile: LocalProfile; mode: 'online' | 'offline' }
  | { ok: false; error: string; canUsePan?: boolean }

const auth = getAuth(firebaseApp)
const firestore = getFirestore(firebaseApp)

/** Errores de Firebase que indican falta de red (no credenciales inválidas). */
const NETWORK_ERRORS = new Set([
  'auth/network-request-failed',
  'auth/timeout',
  'auth/internal-error',
])

/**
 * Login online con Firebase Auth + perfil Firestore.
 * Cachea el perfil en IndexedDB al completarse con éxito.
 */
async function signInOnline(
  email: string,
  password: string
): Promise<{ ok: true; profile: LocalProfile } | { ok: false; error: string; isNetworkError: boolean }> {
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password)
    const uid = credential.user.uid

    const profileRef = doc(firestore, 'licenses', LICENSE_KEY, 'users', uid)
    const snap = await getDoc(profileRef)

    if (!snap.exists()) {
      await firebaseSignOut(auth)
      return { ok: false, error: 'Usuario no registrado en este sistema.', isNetworkError: false }
    }

    const data = snap.data()
    const role = data['role'] as 'cashier' | 'admin'
    if (role !== 'cashier' && role !== 'admin') {
      await firebaseSignOut(auth)
      return { ok: false, error: 'Rol de usuario no autorizado.', isNetworkError: false }
    }

    const profile: LocalProfile = {
      uid,
      displayName: data['displayName'] ?? email,
      role,
      authorizedStores: data['authorizedStores'] ?? [],
      email,
    }

    // Cachear perfil para habilitar el login offline posterior.
    await db.profile.put(profile)

    return { ok: true, profile }
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? ''
    if (
      code === 'auth/user-not-found' ||
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-credential'
    ) {
      return { ok: false, error: 'Credenciales incorrectas.', isNetworkError: false }
    }
    if (NETWORK_ERRORS.has(code) || !navigator.onLine) {
      return { ok: false, error: 'Sin conexión.', isNetworkError: true }
    }
    return { ok: false, error: 'Error al iniciar sesión.', isNetworkError: false }
  }
}

/**
 * Login offline por PIN.
 * Solo posible si el dispositivo tiene PIN configurado y perfil cacheado.
 */
async function signInOfflineWithPin(pin: string): Promise<SignInResult> {
  const valid = await verifyPin(pin)
  if (!valid) {
    return { ok: false, error: 'PIN incorrecto.' }
  }

  const uid = await getPinUid()
  if (!uid) {
    return { ok: false, error: 'No hay sesión guardada para este PIN.' }
  }

  const profile = await db.profile.get(uid)
  if (!profile) {
    return { ok: false, error: 'No hay perfil local disponible. Iniciá sesión con internet primero.' }
  }

  return { ok: true, profile, mode: 'offline' }
}

/**
 * Intenta login online. Si hay error de red y el dispositivo tiene PIN,
 * retorna { canUsePan: true } para que la UI ofrezca el login por PIN.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const result = await signInOnline(email, password)
  if (result.ok) {
    return { ok: true, profile: result.profile, mode: 'online' }
  }

  if (result.isNetworkError) {
    const { hasPinConfigured } = await import('./pin')
    const hasPin = await hasPinConfigured()
    return { ok: false, error: result.error, canUsePan: hasPin }
  }

  return { ok: false, error: result.error }
}

/** Login solo con PIN (cuando el usuario elige explícitamente esa opción). */
export async function signInWithPin(pin: string): Promise<SignInResult> {
  return signInOfflineWithPin(pin)
}

export function signOut(): Promise<void> {
  return firebaseSignOut(auth)
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback)
}
