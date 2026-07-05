import {
  getAuth,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth'
import { getFirestore, doc, getDoc } from 'firebase/firestore'
import { firebaseApp, LICENSE_KEY } from '../firebase'

export type UserRole = 'cashier' | 'admin'

export interface UserProfile {
  uid: string
  displayName: string
  role: UserRole
  authorizedStores: string[]
}

const auth = getAuth(firebaseApp)
const db = getFirestore(firebaseApp)

/**
 * Inicia sesión y verifica que el usuario sea cashier o admin
 * en la licencia configurada.
 */
export async function signIn(
  email: string,
  password: string
): Promise<{ ok: true; profile: UserProfile } | { ok: false; error: string }> {
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password)
    const uid = credential.user.uid

    const profileRef = doc(db, 'licenses', LICENSE_KEY, 'users', uid)
    const snap = await getDoc(profileRef)

    if (!snap.exists()) {
      await firebaseSignOut(auth)
      return { ok: false, error: 'Usuario no registrado en este sistema.' }
    }

    const data = snap.data()
    const role: UserRole = data['role']
    const authorizedStores: string[] = data['authorizedStores'] ?? []
    const displayName: string = data['displayName'] ?? email

    if (role !== 'cashier' && role !== 'admin') {
      await firebaseSignOut(auth)
      return { ok: false, error: 'Rol de usuario no autorizado.' }
    }

    return { ok: true, profile: { uid, displayName, role, authorizedStores } }
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? ''
    if (
      code === 'auth/user-not-found' ||
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-credential'
    ) {
      return { ok: false, error: 'Credenciales incorrectas.' }
    }
    return { ok: false, error: 'Error al iniciar sesión. Verificá tu conexión.' }
  }
}

export function signOut(): Promise<void> {
  return firebaseSignOut(auth)
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback)
}
