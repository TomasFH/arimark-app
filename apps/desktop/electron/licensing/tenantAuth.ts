/**
 * Helper compartido para crear cuentas Firebase Auth + perfil Firestore
 * para cajeras y carniceros (cualquier cuenta de acceso a la app).
 *
 * Evita duplicar la lógica de creación entre cashiers.handler y employees.handler.
 */
import log from 'electron-log'
import { getFirebaseApp } from './firebase'
import type { IpcResult } from '../../src/types/hw-api'

export interface TenantAuthUserOptions {
  licenseKey: string
  email: string
  displayName: string
  role: 'cashier' | 'butcher'
  authorizedStores: string[]
  /** Solo para carniceros: FK estable que no cambia si el nombre del empleado cambia. */
  employeeId?: string
}

/**
 * Crea un usuario en Firebase Auth (cuenta secundaria) + documento en Firestore.
 * Envía email de configuración de contraseña.
 * Si el write de Firestore falla, hace rollback del Auth user.
 */
export async function createTenantAuthUser(
  opts: TenantAuthUserOptions
): Promise<IpcResult<{ uid: string }>> {
  const { licenseKey, email, displayName, role, authorizedStores, employeeId } = opts

  const { getAuth, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } = await import('firebase/auth')
  const { getFirestore, doc, setDoc } = await import('firebase/firestore')
  const { initializeApp, getApps } = await import('firebase/app')

  const mainApp = getFirebaseApp()
  const secondaryName = 'tenant-user-creation'
  const secondaryApp =
    getApps().find(a => a.name === secondaryName) ??
    initializeApp((mainApp as { options: object }).options, secondaryName)

  const secondaryAuth = getAuth(secondaryApp)
  const tempPassword = `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).toUpperCase().slice(2, 6)}!`

  let uid: string
  let authUserCreated = false

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword)
    uid = credential.user.uid
    authUserCreated = true

    const db = getFirestore(mainApp)
    const profileData: Record<string, unknown> = {
      role,
      displayName,
      email,
      authorizedStores,
      active: true,
      deleted: false,
    }
    if (employeeId) profileData['employeeId'] = employeeId

    try {
      await setDoc(doc(db, 'licenses', licenseKey, 'users', uid), profileData)
    } catch (firestoreErr) {
      try {
        await credential.user.delete()
        log.info('[tenantAuth] Rollback: Auth user eliminado tras fallo de Firestore', { email })
      } catch (rollbackErr) {
        log.error('[tenantAuth] No se pudo hacer rollback del Auth user', rollbackErr)
      }
      await signOut(secondaryAuth)
      throw firestoreErr
    }

    try {
      await sendPasswordResetEmail(secondaryAuth, email)
      log.info('[tenantAuth] Email de configuración enviado a', email)
    } catch (emailErr) {
      log.warn('[tenantAuth] No se pudo enviar email de contraseña (no bloqueante)', emailErr)
    }

    await signOut(secondaryAuth)
    return { ok: true, data: { uid } }

  } catch (err) {
    if (!authUserCreated) {
      const code = (err as { code?: string }).code
      if (code === 'auth/email-already-in-use') {
        try {
          const { getFirestore: fs, collection, query, where, getDocs } = await import('firebase/firestore')
          const db = fs(mainApp)
          const snap = await getDocs(
            query(collection(db, 'licenses', licenseKey, 'users'), where('email', '==', email))
          )
          if (snap.empty) {
            return {
              ok: false,
              error: `El email "${email}" existe en autenticación pero no tiene perfil (cuenta incompleta). Eliminala desde Firebase Console y volvé a intentarlo.`,
              code: 'ORPHANED_AUTH_USER',
            }
          }
        } catch {
          // Si falla la verificación, mostrar mensaje genérico
        }
        return { ok: false, error: 'Ya existe una cuenta con ese email.', code: 'ALREADY_EXISTS' }
      }
    }
    const msg = err instanceof Error ? err.message : String(err)
    log.error('[tenantAuth] Error al crear cuenta', { email, msg })
    return { ok: false, error: 'Error al crear la cuenta. Intentar nuevamente.' }
  }
}
