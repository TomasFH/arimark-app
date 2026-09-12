/**
 * Restablecer y cambiar la contraseña de la cuenta Firebase Auth del usuario
 * que está operando. El admin no cambia ni ve la clave de nadie: cada uno
 * lo hace por su cuenta (FEAT-AUTH-PASSWORD-01).
 *
 * El HTML del mail no vive en el repo: se edita en Firebase Console.
 * Ver docs/AUTH_PASSWORD.md.
 */

import {
  getAuth,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth'
import log from 'electron-log'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'

export const MIN_AUTH_PASSWORD_LENGTH = 6

export type PasswordAuthCode =
  | 'WRONG_PASSWORD'
  | 'REQUIRES_REAUTH'
  | 'NO_SESSION'
  | 'NETWORK'
  | 'TOO_MANY'
  | 'WEAK_PASSWORD'

export type PasswordAuthResult =
  | { ok: true }
  | { ok: false; error: string; code?: PasswordAuthCode }

export const PASSWORD_RESET_SENT_MESSAGE =
  'Si hay una cuenta con ese email, vas a recibir un mail para restablecer la contraseña.'

function firebaseAuthCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  return ''
}

function mapFirebasePasswordError(err: unknown, context: 'reset' | 'change'): PasswordAuthResult {
  const code = firebaseAuthCode(err)
  const message = err instanceof Error ? err.message : String(err)
  log.error('[passwordAuth] Error de Firebase', { context, code, message })

  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return { ok: false, error: 'La contraseña actual no es correcta.', code: 'WRONG_PASSWORD' }
    case 'auth/requires-recent-login':
      return {
        ok: false,
        error: 'Por seguridad hay que confirmar la contraseña actual o restablecerla por mail.',
        code: 'REQUIRES_REAUTH',
      }
    case 'auth/weak-password':
      return {
        ok: false,
        error: 'La nueva contraseña es demasiado débil. Usá al menos 6 caracteres.',
        code: 'WEAK_PASSWORD',
      }
    case 'auth/too-many-requests':
      return { ok: false, error: 'Demasiados intentos. Esperá un rato e intentá de nuevo.', code: 'TOO_MANY' }
    case 'auth/network-request-failed':
    case 'auth/timeout':
      return { ok: false, error: 'Sin conexión. Intentá de nuevo cuando haya internet.', code: 'NETWORK' }
    case 'auth/user-disabled':
      return { ok: false, error: 'Usuario desactivado. Contactar al administrador.' }
    case 'auth/invalid-email':
    case 'auth/missing-email':
      return { ok: false, error: 'Ingresá un email válido.' }
    case 'auth/user-not-found':
      // No filtrar si el email existe: mismo mensaje de éxito que un envío real.
      if (context === 'reset') return { ok: true }
      return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    default:
      if (context === 'reset') {
        return { ok: false, error: 'No se pudo enviar el mail. Intentá de nuevo.' }
      }
      return { ok: false, error: 'No se pudo cambiar la contraseña. Intentá de nuevo.' }
  }
}

/**
 * Envía el mail de restablecer (mismo `sendPasswordResetEmail` que el alta).
 * Si no hay `email`, usa el de la sesión Firebase actual.
 */
export async function sendPasswordReset(email?: string): Promise<PasswordAuthResult> {
  if (!isFirebaseAvailable()) {
    log.info('[passwordAuth] sendPasswordReset omitido (modo pruebas)')
    return { ok: true }
  }

  try {
    const auth = getAuth(getFirebaseApp())
    const target = (email?.trim() || auth.currentUser?.email || '').trim()
    if (!target) {
      return { ok: false, error: 'Ingresá tu email.', code: 'NO_SESSION' }
    }
    await sendPasswordResetEmail(auth, target)
    log.info('[passwordAuth] Mail de restablecer solicitado')
    return { ok: true }
  } catch (err) {
    return mapFirebasePasswordError(err, 'reset')
  }
}

/**
 * Cambia la clave del usuario logueado. Reautentica con la actual y luego
 * `updatePassword`. Si Firebase pide login reciente, el UI ofrece el mail.
 */
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<PasswordAuthResult> {
  if (newPassword === currentPassword) {
    return { ok: false, error: 'La nueva contraseña tiene que ser distinta a la actual.' }
  }
  if (newPassword.length < MIN_AUTH_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `La nueva contraseña debe tener al menos ${MIN_AUTH_PASSWORD_LENGTH} caracteres.`,
      code: 'WEAK_PASSWORD',
    }
  }

  if (!isFirebaseAvailable()) {
    log.info('[passwordAuth] changeOwnPassword omitido (modo pruebas)')
    return { ok: true }
  }

  try {
    const auth = getAuth(getFirebaseApp())
    const user = auth.currentUser
    const email = user?.email?.trim() ?? ''
    if (!user || !email) {
      return { ok: false, error: 'No hay sesión activa. Cerrá sesión e ingresá de nuevo.', code: 'NO_SESSION' }
    }

    try {
      const credential = EmailAuthProvider.credential(email, currentPassword)
      await reauthenticateWithCredential(user, credential)
    } catch (reauthErr) {
      const mapped = mapFirebasePasswordError(reauthErr, 'change')
      if (!mapped.ok && mapped.code === 'REQUIRES_REAUTH') return mapped
      return mapped
    }

    await updatePassword(user, newPassword)
    log.info('[passwordAuth] Contraseña actualizada')
    return { ok: true }
  } catch (err) {
    return mapFirebasePasswordError(err, 'change')
  }
}
