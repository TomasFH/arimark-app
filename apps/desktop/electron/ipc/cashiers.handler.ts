/**
 * Handlers IPC para ABM de cajeras (solo admins).
 *
 * Operaciones:
 *  - LIST_CASHIERS   — lista todos los usuarios con role='cashier' del sistema
 *  - CREATE_CASHIER  — crea una cuenta en Firebase Auth + perfil en Firestore
 *  - TOGGLE_CASHIER  — activa o desactiva una cajera en Firestore (el perfil en
 *                      SQLite se actualiza en el próximo login de la cajera)
 *
 * Estrategia de creación de usuarios:
 *  Para crear una cuenta sin cerrar la sesión del admin, se usa una segunda
 *  instancia de Firebase App ('cashier-creation'). Esta instancia se inicializa
 *  con la misma configuración que la principal y se usa exclusivamente para
 *  createUserWithEmailAndPassword, cerrando su sesión inmediatamente después.
 *
 * En dev: todo funciona con mocks en memoria — no se toca Firebase.
 *
 * Validación: todos los payloads pasan por zod antes de llegar a Firebase.
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
  password: z.string().min(6),
  authorizedStores: z.array(z.string().min(1)).min(1),
})

const toggleCashierSchema = z.object({
  uid: z.string().min(1),
  active: z.boolean(),
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

function devCreateCashier(
  displayName: string, email: string, authorizedStores: string[]
): IpcResult<{ uid: string }> {
  const uid = `dev-cashier-${email.trim().toLowerCase()}`
  const existing = _devCashiers.find(c => c.uid === uid)
  if (existing) return { ok: false, error: 'Ya existe una cajera con ese email.', code: 'ALREADY_EXISTS' }
  _devCashiers.push({ uid, displayName, email, authorizedStores, active: true })
  return { ok: true, data: { uid } }
}

function devToggleCashier(uid: string, active: boolean): IpcResult {
  const cashier = _devCashiers.find(c => c.uid === uid)
  if (!cashier) return { ok: false, error: 'Cajera no encontrada.', code: 'NOT_FOUND' }
  cashier.active = active
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// Firebase helpers — cargados on-demand para no romper dev
// ---------------------------------------------------------------------------

async function firebaseListCashiers(licenseKey: string): Promise<IpcResult<CashierRow[]>> {
  const { getFirestore, collection, getDocs, query, where } = await import('firebase/firestore')
  const app = getFirebaseApp()
  const db = getFirestore(app)
  const q = query(collection(db, 'licenses', licenseKey, 'users'), where('role', '==', 'cashier'))
  const snap = await getDocs(q)
  const rows: CashierRow[] = snap.docs.map(d => {
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
  password: string,
  authorizedStores: string[],
): Promise<IpcResult<{ uid: string }>> {
  const { getAuth, createUserWithEmailAndPassword, signOut } = await import('firebase/auth')
  const { getFirestore, doc, setDoc } = await import('firebase/firestore')
  const { initializeApp, getApps } = await import('firebase/app')

  const mainApp = getFirebaseApp()
  // Reusar o crear la app secundaria para no afectar la sesión del admin
  const secondaryName = 'cashier-creation'
  const secondaryApp =
    getApps().find(a => a.name === secondaryName) ??
    initializeApp((mainApp as { options: object }).options, secondaryName)

  const secondaryAuth = getAuth(secondaryApp)

  let uid: string
  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password)
    uid = credential.user.uid
    await signOut(secondaryAuth)
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'auth/email-already-in-use') {
      return { ok: false, error: 'Ya existe una cuenta con ese email.', code: 'ALREADY_EXISTS' }
    }
    throw err
  }

  const db = getFirestore(mainApp)
  await setDoc(doc(db, 'licenses', licenseKey, 'users', uid), {
    role: 'cashier',
    displayName,
    email,
    authorizedStores,
    active: true,
  })

  return { ok: true, data: { uid } }
}

async function firebaseToggleCashier(licenseKey: string, uid: string, active: boolean): Promise<IpcResult> {
  const { getFirestore, doc, updateDoc } = await import('firebase/firestore')
  const db = getFirestore(getFirebaseApp())
  await updateDoc(doc(db, 'licenses', licenseKey, 'users', uid), { active })
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
      return { ok: false, error: 'Error al listar cajeras.' }
    }
  })

  ipcMain.handle(IPC.CREATE_CASHIER, async (_event, payload: unknown): Promise<IpcResult<{ uid: string }>> => {
    const parsed = createCashierSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('[ipc:create-cashier] Payload inválido', parsed.error.flatten())
      return { ok: false, error: parsed.error.errors[0]?.message ?? 'Datos inválidos.', code: 'VALIDATION_ERROR' }
    }

    const { displayName, email, password, authorizedStores } = parsed.data

    if (!isFirebaseAvailable()) return devCreateCashier(displayName, email, authorizedStores)

    try {
      const { license_key } = getBusinessConfig()
      const result = await firebaseCreateCashier(license_key, displayName, email, password, authorizedStores)
      if (result.ok) log.info('[ipc:create-cashier] Cajera creada', { email })
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:create-cashier] Error', msg)
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
}
