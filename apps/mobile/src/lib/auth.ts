/**
 * Autenticación del POS móvil.
 *
 * Modelo: sesión persistente de Firebase Auth. No hay PIN ni claves offline.
 *
 *  1. Login online (email + contraseña): verifica credenciales, lee el perfil
 *     desde Firestore (servidor) y lo cachea en IndexedDB. Si `active === false`
 *     o el doc no autoriza, cierra Auth y no entra.
 *  2. Restauración: al reabrir, si hay internet revalida el perfil en Firestore
 *     (no alcanza el caché local). Sin internet usa el caché. Un listener en
 *     vivo cierra la sesión si el admin revoca el acceso con la app abierta.
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
import { getFirestore, doc, getDocFromServer, onSnapshot } from 'firebase/firestore'
import { firebaseApp, auth, LICENSE_KEY } from '../firebase'
import { db } from './db'
import type { LocalProfile } from '../types/pos'
import {
  accessDenialMessage,
  buildLocalProfile,
  denyUserAccess,
  type AccessDenial,
} from './userAccess'

export type { LocalProfile }
export { ACCESS_REVOKED_MESSAGE } from './userAccess'

export type SignInResult =
  | { ok: true; profile: LocalProfile; mode: 'online' }
  | { ok: false; error: string }

export type RestoreResult =
  | { ok: true; profile: LocalProfile; mode: 'online' | 'offline' }
  | { ok: false; error?: string }

const firestore = getFirestore(firebaseApp)

/** Errores de Firebase que indican falta de red (no credenciales inválidas). */
const NETWORK_ERRORS = new Set([
  'auth/network-request-failed',
  'auth/timeout',
  'auth/internal-error',
  'unavailable',
])

type FetchProfileResult =
  | { ok: true; profile: LocalProfile }
  | { ok: false; reason: AccessDenial }

function userDocRef(uid: string) {
  return doc(firestore, 'licenses', LICENSE_KEY, 'users', uid)
}

async function clearLocalProfileAndAuth(uid: string): Promise<void> {
  await db.profile.delete(uid).catch(() => undefined)
  await firebaseSignOut(auth).catch(() => undefined)
}

/**
 * Lee el perfil de Firestore para un uid, valida rol y `active`, y lo cachea.
 * Con internet pide el servidor (no el caché de Firestore) para no entrar
 * con un `active: true` viejo después de una revocación.
 */
async function fetchAndCacheProfile(
  uid: string,
  email: string,
): Promise<FetchProfileResult> {
  const profileRef = userDocRef(uid)
  const snap = await getDocFromServer(profileRef)
  if (!snap.exists()) return { ok: false, reason: 'unauthorized' }

  const data = snap.data() as Record<string, unknown>
  const denial = denyUserAccess(data)
  if (denial) return { ok: false, reason: denial }

  const profile = buildLocalProfile(uid, email, data)
  if (!profile) return { ok: false, reason: 'unauthorized' }

  await db.profile.put(profile)
  return { ok: true, profile }
}

/** Login online con Firebase Auth + perfil Firestore. */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password)
    const uid = credential.user.uid

    const profile = await fetchAndCacheProfile(uid, email)
    if (!profile.ok) {
      await clearLocalProfileAndAuth(uid)
      return { ok: false, error: accessDenialMessage(profile.reason) }
    }

    return { ok: true, profile: profile.profile, mode: 'online' }
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
 *  - Con internet: revalida el doc de Firestore. Si está desactivado o no hay
 *    perfil, cierra Auth, borra el caché y { ok: false }.
 *  - Sin internet (o si Firestore no responde): usa el perfil cacheado.
 *  - Sin sesión previa: { ok: false }.
 */
export function restoreSession(): Promise<RestoreResult> {
  return new Promise((resolve) => {
    let settled = false
    const unsub = onAuthStateChanged(auth, (user: User | null) => {
      if (settled) return
      settled = true
      void restoreFromAuthUser(user).then((result) => {
        unsub()
        resolve(result)
      })
    })
  })
}

async function restoreFromAuthUser(user: User | null): Promise<RestoreResult> {
  if (!user) return { ok: false }

  if (navigator.onLine) {
    try {
      const fetched = await fetchAndCacheProfile(user.uid, user.email ?? '')
      if (fetched.ok) {
        return { ok: true, profile: fetched.profile, mode: 'online' }
      }
      await clearLocalProfileAndAuth(user.uid)
      return { ok: false, error: accessDenialMessage(fetched.reason) }
    } catch {
      // Sin servidor: caer al caché local si existe.
    }
  }

  const cached = await db.profile.get(user.uid)
  if (cached) {
    return { ok: true, profile: cached, mode: navigator.onLine ? 'online' : 'offline' }
  }

  return { ok: false }
}

/**
 * Reconsulta el perfil al recuperar internet. `revoked` cierra Auth y borra caché.
 */
export async function revalidateProfileAccess(
  uid: string,
  email: string,
): Promise<'ok' | 'revoked' | 'unavailable'> {
  try {
    const fetched = await fetchAndCacheProfile(uid, email)
    if (fetched.ok) return 'ok'
    await clearLocalProfileAndAuth(uid)
    return 'revoked'
  } catch {
    return 'unavailable'
  }
}

/**
 * Cierra la sesión en cuanto Firestore marca el usuario como inactivo o borra el doc.
 */
export function subscribeUserAccess(uid: string, onRevoked: () => void): () => void {
  return onSnapshot(
    userDocRef(uid),
    snap => {
      if (!snap.exists()) {
        onRevoked()
        return
      }
      const denial = denyUserAccess(snap.data() as Record<string, unknown>)
      if (denial) onRevoked()
    },
    err => {
      console.error('[auth] Error en listener de acceso', err)
    },
  )
}

export function signOut(): Promise<void> {
  return firebaseSignOut(auth)
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback)
}
