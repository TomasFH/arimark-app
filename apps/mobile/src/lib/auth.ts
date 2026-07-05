/**
 * Autenticación del POS móvil.
 *
 * Modelo: sesión persistente de Firebase Auth. No hay PIN ni claves offline.
 *
 *  1. Login online (email + contraseña): verifica credenciales, lee el perfil
 *     desde Firestore y lo cachea en IndexedDB. Firebase guarda el refresh
 *     token localmente (ver `firebase.ts`).
 *  2. Restauración de sesión: al reabrir la app, `restoreSession()` recupera al
 *     usuario ya autenticado desde la persistencia local — con o SIN internet —
 *     y devuelve el perfil cacheado. La cajera nunca vuelve a ingresar
 *     credenciales mientras no cierre sesión explícitamente.
 *
 * Requisito para operar offline: haber iniciado sesión al menos una vez con
 * internet en ese dispositivo (durante la configuración inicial).
 */
import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth'
import { getFirestore, doc, getDoc } from 'firebase/firestore'
import { firebaseApp, auth, LICENSE_KEY } from '../firebase'
import { db } from './db'
import type { LocalProfile } from '../types/pos'

export type { LocalProfile }

export type SignInResult =
  | { ok: true; profile: LocalProfile; mode: 'online' }
  | { ok: false; error: string }

export type RestoreResult =
  | { ok: true; profile: LocalProfile; mode: 'online' | 'offline' }
  | { ok: false }

const firestore = getFirestore(firebaseApp)

/** Errores de Firebase que indican falta de red (no credenciales inválidas). */
const NETWORK_ERRORS = new Set([
  'auth/network-request-failed',
  'auth/timeout',
  'auth/internal-error',
])

/**
 * Lee el perfil de Firestore para un uid, valida el rol y lo cachea localmente.
 * Devuelve null si el usuario no está registrado o su rol no está autorizado.
 */
async function fetchAndCacheProfile(
  uid: string,
  email: string
): Promise<LocalProfile | null> {
  const profileRef = doc(firestore, 'licenses', LICENSE_KEY, 'users', uid)
  const snap = await getDoc(profileRef)
  if (!snap.exists()) return null

  const data = snap.data()
  const role = data['role'] as 'cashier' | 'admin'
  if (role !== 'cashier' && role !== 'admin') return null

  const profile: LocalProfile = {
    uid,
    displayName: data['displayName'] ?? email,
    role,
    authorizedStores: data['authorizedStores'] ?? [],
    email,
  }

  await db.profile.put(profile)
  return profile
}

/** Login online con Firebase Auth + perfil Firestore. */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password)
    const uid = credential.user.uid

    const profile = await fetchAndCacheProfile(uid, email)
    if (!profile) {
      await firebaseSignOut(auth)
      return { ok: false, error: 'Usuario no registrado o sin rol autorizado.' }
    }

    return { ok: true, profile, mode: 'online' }
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? ''
    if (
      code === 'auth/user-not-found' ||
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-credential'
    ) {
      return { ok: false, error: 'Credenciales incorrectas.' }
    }
    if (NETWORK_ERRORS.has(code) || !navigator.onLine) {
      return {
        ok: false,
        error: 'Sin conexión. Para el primer ingreso en este celular necesitás internet.',
      }
    }
    return { ok: false, error: 'Error al iniciar sesión.' }
  }
}

/**
 * Restaura la sesión persistida al abrir la app.
 *
 * Espera a que Firebase resuelva el estado de auth desde la persistencia local
 * (funciona offline) y devuelve el perfil correspondiente:
 *  - Perfil cacheado en IndexedDB → uso inmediato (con o sin internet).
 *  - Sin caché pero con internet → lo baja de Firestore y lo cachea.
 *  - Sin sesión previa → { ok: false } (hay que loguearse).
 */
export function restoreSession(): Promise<RestoreResult> {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user: User | null) => {
      unsub()
      if (!user) {
        resolve({ ok: false })
        return
      }

      const cached = await db.profile.get(user.uid)
      if (cached) {
        resolve({ ok: true, profile: cached, mode: navigator.onLine ? 'online' : 'offline' })
        return
      }

      if (navigator.onLine) {
        const profile = await fetchAndCacheProfile(user.uid, user.email ?? '')
        if (profile) {
          resolve({ ok: true, profile, mode: 'online' })
          return
        }
      }

      // Sesión válida pero sin perfil accesible (offline y sin caché).
      resolve({ ok: false })
    })
  })
}

export function signOut(): Promise<void> {
  return firebaseSignOut(auth)
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback)
}
