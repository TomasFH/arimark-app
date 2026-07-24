/**
 * Handlers IPC para ABM de cajeras (solo admins).
 *
 * Operaciones:
 *  - LIST_CASHIERS   — lista usuarios con role='cashier' y deleted != true
 *  - CREATE_CASHIER  — crea Auth user + perfil Firestore. Genera contraseña
 *                      temporal internamente y envía email de configuración
 *                      de contraseña para que la cajera la defina ella misma.
 *                      Si el Firestore write falla, hace rollback del Auth user.
 *  - TOGGLE_CASHIER  — activa/desactiva (active: boolean) en Firestore
 *  - DELETE_CASHIER  — soft-delete: marca deleted:true + active:false en
 *                      Firestore. El Auth user persiste hasta que una Cloud
 *                      Function lo limpie (client SDK no puede borrar usuarios
 *                      ajenos). Los datos históricos en SQLite quedan intactos.
 *
 * === REGLAS DE FIRESTORE REQUERIDAS (copiar en Firebase Console) ===
 *
 *   match /licenses/{licenseKey}/users/{userId} {
 *     // Cualquier usuario autenticado puede leer su propio perfil (para login)
 *     allow read: if request.auth != null && request.auth.uid == userId;
 *     // Admins pueden leer y escribir todos los perfiles de su licencia
 *     allow read, write: if request.auth != null
 *       && get(/databases/$(database)/documents/licenses/$(licenseKey)/users/$(request.auth.uid)).data.role == 'admin';
 *   }
 *
 * En dev: todo funciona con mocks en memoria — no se toca Firebase.
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC } from './channels'
import { getFirebaseApp, isFirebaseAvailable } from '../licensing/firebase'
import { getBusinessConfig } from '../businessConfig'
import type { IpcResult, CashierRow } from '../../src/types/hw-api'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createCashierSchema = z.object({
  displayName: z.string().min(2).max(80),
  email: z.string().email(),
  authorizedStores: z.array(z.string().min(1)).optional(), // ya no es requerido — cualquier cajera puede operar en cualquier local
})

const toggleCashierSchema = z.object({
  uid: z.string().min(1),
  active: z.boolean(),
})

const deleteCashierSchema = z.object({
  uid: z.string().min(1),
})

// ---------------------------------------------------------------------------
// Dev mocks — datos sintéticos en memoria
// ---------------------------------------------------------------------------

const _devCashiers: CashierRow[] = [
  { uid: 'dev-cashier-cajera1@dev.local', displayName: 'Cajera Uno (dev)', email: 'cajera1@dev.local', authorizedStores: ['local1'], active: true },
  { uid: 'dev-cashier-cajera2@dev.local', displayName: 'Cajera Dos (dev)', email: 'cajera2@dev.local', authorizedStores: ['local1'], active: false },
]

function devListCashiers(): IpcResult<CashierRow[]> {
  return { ok: true, data: [..._devCashiers] }
}

function devCreateCashier(displayName: string, email: string, authorizedStores: string[]): IpcResult<{ uid: string }> {
  const uid = `dev-cashier-${email.trim().toLowerCase()}`
  if (_devCashiers.find(c => c.uid === uid)) {
    return { ok: false, error: 'Ya existe una cajera con ese email.', code: 'ALREADY_EXISTS' }
  }
  _devCashiers.push({ uid, displayName, email, authorizedStores, active: true })
  log.info('[ipc:create-cashier] dev — cajera creada, email de configuración se enviaría:', email)
  return { ok: true, data: { uid } }
}

function devToggleCashier(uid: string, active: boolean): IpcResult {
  const cashier = _devCashiers.find(c => c.uid === uid)
  if (!cashier) return { ok: false, error: 'Cajera no encontrada.', code: 'NOT_FOUND' }
  cashier.active = active
  return { ok: true, data: undefined }
}

function devDeleteCashier(uid: string): IpcResult {
  const idx = _devCashiers.findIndex(c => c.uid === uid)
  if (idx === -1) return { ok: false, error: 'Cajera no encontrada.', code: 'NOT_FOUND' }
  _devCashiers.splice(idx, 1)
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// Firebase helpers — cargados on-demand
// ---------------------------------------------------------------------------

function generateTempPassword(): string {
  const a = Math.random().toString(36).slice(2, 10)
  const b = Math.random().toString(36).toUpperCase().slice(2, 6)
  return `${a}${b}!`
}

async function firebaseListCashiers(licenseKey: string): Promise<IpcResult<CashierRow[]>> {
  const { getFirestore, collection, getDocs, query, where } = await import('firebase/firestore')
  const app = getFirebaseApp()
  const db = getFirestore(app)
  // Solo filtramos por 'role' para evitar necesitar un índice compuesto.
  // El filtro de deleted se aplica en memoria.
  const q = query(collection(db, 'licenses', licenseKey, 'users'), where('role', '==', 'cashier'))
  const snap = await getDocs(q)
  const rows: CashierRow[] = snap.docs
    .filter(d => d.data()['deleted'] !== true)
    .map(d => {
      const data = d.data() as {
        displayName?: string
        email?: string
        authorizedStores?: string[]
        active?: boolean
      }
      return {
        uid: d.id,
        displayName: data.displayName ?? '',
        email: data.email ?? '',
        authorizedStores: data.authorizedStores ?? [],
        active: data.active !== false,
      }
    })
  return { ok: true, data: rows }
}

async function firebaseCreateCashier(
  licenseKey: string,
  displayName: string,
  email: string,
  authorizedStores: string[],
): Promise<IpcResult<{ uid: string }>> {
  const { getAuth, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } = await import('firebase/auth')
  const { getFirestore, doc, setDoc } = await import('firebase/firestore')
  const { initializeApp, getApps } = await import('firebase/app')

  const mainApp = getFirebaseApp()
  const secondaryName = 'cashier-creation'
  const secondaryApp =
    getApps().find(a => a.name === secondaryName) ??
    initializeApp((mainApp as { options: object }).options, secondaryName)

  const secondaryAuth = getAuth(secondaryApp)
  const tempPassword = generateTempPassword()

  let uid: string
  let authUserCreated = false
  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword)
    uid = credential.user.uid
    authUserCreated = true

    // Escribir perfil en Firestore
    const db = getFirestore(mainApp)
    try {
      await setDoc(doc(db, 'licenses', licenseKey, 'users', uid), {
        role: 'cashier',
        displayName,
        email,
        authorizedStores,
        active: true,
        deleted: false,
      })
    } catch (firestoreErr) {
      // Rollback: borrar el Auth user recién creado para no dejar un huérfano.
      // Solo es posible porque tenemos la credencial del usuario antes de firmar out.
      try {
        await credential.user.delete()
        log.info('[ipc:create-cashier] Rollback: Auth user eliminado tras fallo de Firestore', { email })
      } catch (rollbackErr) {
        log.error('[ipc:create-cashier] No se pudo hacer rollback del Auth user', rollbackErr)
      }
      await signOut(secondaryAuth)
      throw firestoreErr
    }

    // Enviar email para que la cajera defina su propia contraseña.
    // No es bloqueante: si falla, el admin puede reenviarla desde Firebase Console.
    try {
      await sendPasswordResetEmail(secondaryAuth, email)
      log.info('[ipc:create-cashier] Email de configuración de contraseña enviado a', email)
    } catch (emailErr) {
      log.warn('[ipc:create-cashier] No se pudo enviar email de contraseña, continuar de todas formas', emailErr)
    }

    await signOut(secondaryAuth)
    return { ok: true, data: { uid } }

  } catch (err) {
    if (!authUserCreated) {
      // El error ocurrió en createUserWithEmailAndPassword
      const code = (err as { code?: string }).code
      if (code === 'auth/email-already-in-use') {
        // Verificar si el email tiene un perfil en Firestore.
        // Si no tiene perfil → cuenta huérfana (Auth existe pero no el documento).
        // Si tiene perfil → ya está registrada normalmente.
        try {
          const { getFirestore, collection, query, where, getDocs } = await import('firebase/firestore')
          const db = getFirestore(mainApp)
          const snap = await getDocs(
            query(collection(db, 'licenses', licenseKey, 'users'), where('email', '==', email))
          )
          if (snap.empty) {
            return {
              ok: false,
              error: `El email "${email}" existe en el sistema de autenticación pero no tiene perfil en la app (cuenta incompleta). Eliminala desde Firebase Console → Authentication → Users y volvé a intentarlo.`,
              code: 'ORPHANED_AUTH_USER',
            }
          }
        } catch {
          // Si falla la verificación, mostrar mensaje genérico
        }
        return { ok: false, error: 'Ya existe una cuenta con ese email.', code: 'ALREADY_EXISTS' }
      }
    }
    throw err
  }
}

async function firebaseToggleCashier(licenseKey: string, uid: string, active: boolean): Promise<IpcResult> {
  const { getFirestore, doc, updateDoc } = await import('firebase/firestore')
  const db = getFirestore(getFirebaseApp())
  await updateDoc(doc(db, 'licenses', licenseKey, 'users', uid), { active })
  return { ok: true, data: undefined }
}

async function firebaseDeleteCashier(licenseKey: string, uid: string): Promise<IpcResult> {
  const { getFirestore, doc, updateDoc } = await import('firebase/firestore')
  const db = getFirestore(getFirebaseApp())
  // Soft-delete: el Auth user persiste (requiere Cloud Function para eliminación física).
  // El perfil queda marcado como deleted:true + active:false para excluirlo del listado
  // sin romper referencias históricas en SQLite.
  await updateDoc(doc(db, 'licenses', licenseKey, 'users', uid), {
    deleted: true,
    active: false,
  })
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// Registro de handlers
// ---------------------------------------------------------------------------

export function registerCashiersHandlers(): void {

  ipcMain.handle(IPC.LIST_CASHIERS, async (): Promise<IpcResult<CashierRow[]>> => {
    if (!isFirebaseAvailable()) return devListCashiers()
    try {
      const { license_key } = getBusinessConfig()
      return await firebaseListCashiers(license_key)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:list-cashiers] Error', msg)
      // PERMISSION_DENIED implica que las reglas de Firestore no están configuradas.
      if (msg.includes('PERMISSION_DENIED') || msg.includes('Missing or insufficient permissions')) {
        return {
          ok: false,
          error: 'Sin permiso para leer las cajeras. Verificar reglas de Firestore (ver AGENTS.md).',
          code: 'PERMISSION_DENIED',
        }
      }
      return { ok: false, error: 'Error al listar cajeras.' }
    }
  })

  ipcMain.handle(IPC.CREATE_CASHIER, async (_event, payload: unknown): Promise<IpcResult<{ uid: string }>> => {
    const parsed = createCashierSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('[ipc:create-cashier] Payload inválido', parsed.error.flatten())
      return { ok: false, error: parsed.error.errors[0]?.message ?? 'Datos inválidos.', code: 'VALIDATION_ERROR' }
    }

    const { displayName, email, authorizedStores } = parsed.data

    if (!isFirebaseAvailable()) return devCreateCashier(displayName, email, authorizedStores ?? [])

    try {
      const { license_key } = getBusinessConfig()
      const result = await firebaseCreateCashier(license_key, displayName, email, authorizedStores ?? [])
      if (result.ok) log.info('[ipc:create-cashier] Cajera creada', { email })
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:create-cashier] Error', msg)
      if (msg.includes('PERMISSION_DENIED') || msg.includes('Missing or insufficient permissions')) {
        return {
          ok: false,
          error: 'Sin permiso para crear la cajera. Verificar reglas de Firestore (ver AGENTS.md).',
          code: 'PERMISSION_DENIED',
        }
      }
      return { ok: false, error: 'Error al crear la cajera.' }
    }
  })

  ipcMain.handle(IPC.TOGGLE_CASHIER, async (_event, payload: unknown): Promise<IpcResult> => {
    const parsed = toggleCashierSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Payload inválido.', code: 'VALIDATION_ERROR' }
    }

    const { uid, active } = parsed.data

    if (!isFirebaseAvailable()) return devToggleCashier(uid, active)

    try {
      const { license_key } = getBusinessConfig()
      const result = await firebaseToggleCashier(license_key, uid, active)
      log.info('[ipc:toggle-cashier]', { uid, active })
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:toggle-cashier] Error', msg)
      return { ok: false, error: 'Error al actualizar la cajera.' }
    }
  })

  ipcMain.handle(IPC.DELETE_CASHIER, async (_event, payload: unknown): Promise<IpcResult> => {
    const parsed = deleteCashierSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Payload inválido.', code: 'VALIDATION_ERROR' }
    }

    const { uid } = parsed.data

    if (!isFirebaseAvailable()) return devDeleteCashier(uid)

    try {
      const { license_key } = getBusinessConfig()
      const result = await firebaseDeleteCashier(license_key, uid)
      log.info('[ipc:delete-cashier] Cajera eliminada (soft)', { uid })
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:delete-cashier] Error', msg)
      return { ok: false, error: 'Error al eliminar la cajera.' }
    }
  })
}
