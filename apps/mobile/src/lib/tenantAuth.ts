/**
 * Alta de cuentas Firebase Auth + perfil Firestore desde el celu.
 *
 * Replica el patrón de `apps/desktop/electron/licensing/tenantAuth.ts`:
 * una app Firebase secundaria para `createUserWithEmailAndPassword`, así
 * la sesión del admin en la app principal no se pisa. El write de
 * `users/{uid}` va por Firestore de la app principal (reglas: el admin).
 */
import {
  initializeApp,
  getApps,
} from 'firebase/app'
import {
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  type Auth,
} from 'firebase/auth'
import {
  getFirestore,
  doc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import { isOnline } from './connectivity'
import {
  CREATE_ACCOUNT_ERROR_MESSAGE,
  EMAIL_REQUIRED_MESSAGE,
  OFFLINE_ACCOUNT_MESSAGE,
  RESTORE_ACCESS_ERROR_MESSAGE,
  REVOKE_ACCESS_ERROR_MESSAGE,
  authorizedStoreIdsForGrant,
  buildTenantUserProfile,
  decideGrantButcherAccess,
  mapAuthCreateError,
  mapTenantUserDoc,
  pickButcherProfile,
  resolveCreateAuthFailure,
  type TenantUserRef,
} from './tenantAuthLogic'

const SECONDARY_APP_NAME = 'tenant-user-creation'

export type TenantResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string }

export interface CreateTenantAuthUserOptions {
  email: string
  displayName: string
  role: 'cashier' | 'butcher'
  authorizedStores: string[]
  employeeId?: string
}

function firestoreDb() {
  return getFirestore(firebaseApp)
}

function userDoc(uid: string) {
  return doc(firestoreDb(), 'licenses', LICENSE_KEY, 'users', uid)
}

function employeeDoc(employeeId: string) {
  return doc(firestoreDb(), 'licenses', LICENSE_KEY, 'employees', employeeId)
}

function generateTempPassword(): string {
  const a = Math.random().toString(36).slice(2, 10)
  const b = Math.random().toString(36).toUpperCase().slice(2, 6)
  return `${a}${b}!`
}

function getSecondaryAuth(): Auth {
  const existing = getApps().find(a => a.name === SECONDARY_APP_NAME)
  const secondaryApp =
    existing ?? initializeApp((firebaseApp as { options: object }).options, SECONDARY_APP_NAME)
  try {
    return initializeAuth(secondaryApp, { persistence: inMemoryPersistence })
  } catch {
    return getAuth(secondaryApp)
  }
}

async function queryTenantUsers(
  field: 'employeeId' | 'email',
  value: string,
): Promise<TenantUserRef[]> {
  const snap = await getDocs(
    query(collection(firestoreDb(), 'licenses', LICENSE_KEY, 'users'), where(field, '==', value)),
  )
  return snap.docs.map(d => mapTenantUserDoc(d.id, d.data() as Record<string, unknown>))
}

export async function findTenantUserByEmployeeId(employeeId: string): Promise<TenantUserRef | null> {
  return pickButcherProfile(await queryTenantUsers('employeeId', employeeId))
}

export async function findTenantUserByEmail(email: string): Promise<TenantUserRef | null> {
  return pickButcherProfile(await queryTenantUsers('email', email))
}

export async function createTenantAuthUser(
  opts: CreateTenantAuthUserOptions,
): Promise<TenantResult<{ uid: string }>> {
  if (!(await isOnline())) {
    return { ok: false, error: OFFLINE_ACCOUNT_MESSAGE, code: 'UNAVAILABLE' }
  }

  const secondaryAuth = getSecondaryAuth()
  const tempPassword = generateTempPassword()
  let authUserCreated = false
  let uid = ''

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      opts.email,
      tempPassword,
    )
    uid = credential.user.uid
    authUserCreated = true

    const profile = buildTenantUserProfile({
      role: opts.role,
      displayName: opts.displayName,
      email: opts.email,
      authorizedStores: opts.authorizedStores,
      employeeId: opts.employeeId,
    })

    try {
      await setDoc(userDoc(uid), profile)
    } catch (firestoreErr) {
      try {
        await credential.user.delete()
        console.info('[tenantAuth] Rollback: Auth user eliminado tras fallo de Firestore', { email: opts.email })
      } catch (rollbackErr) {
        console.error('[tenantAuth] No se pudo hacer rollback del Auth user', rollbackErr)
      }
      await signOut(secondaryAuth)
      throw firestoreErr
    }

    try {
      await sendPasswordResetEmail(secondaryAuth, opts.email)
    } catch (emailErr) {
      console.warn('[tenantAuth] No se pudo enviar email de contraseña (no bloqueante)', emailErr)
    }

    await signOut(secondaryAuth)
    return { ok: true, data: { uid } }
  } catch (err) {
    const mapped = mapAuthCreateError(err, authUserCreated)
    if (!authUserCreated && mapped.code === 'ALREADY_EXISTS') {
      let hasProfile: boolean | null = null
      try {
        const snap = await getDocs(
          query(
            collection(firestoreDb(), 'licenses', LICENSE_KEY, 'users'),
            where('email', '==', opts.email),
          ),
        )
        hasProfile = !snap.empty
      } catch {
        hasProfile = null
      }
      const resolved = resolveCreateAuthFailure({ email: opts.email, hasFirestoreProfile: hasProfile })
      return { ok: false, error: resolved.error, code: resolved.code }
    }
    if (mapped.code === 'UNAVAILABLE') {
      return { ok: false, error: OFFLINE_ACCOUNT_MESSAGE, code: 'UNAVAILABLE' }
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[tenantAuth] Error al crear cuenta', { email: opts.email, msg })
    return { ok: false, error: CREATE_ACCOUNT_ERROR_MESSAGE }
  }
}

export async function reactivateTenantUser(opts: {
  uid: string
  displayName: string
  employeeId: string
}): Promise<TenantResult<undefined>> {
  try {
    await updateDoc(userDoc(opts.uid), {
      active: true,
      deleted: false,
      role: 'butcher',
      displayName: opts.displayName,
      employeeId: opts.employeeId,
    })
    return { ok: true, data: undefined }
  } catch (err) {
    console.error('[tenantAuth] No se pudo reactivar el acceso', err)
    return { ok: false, error: RESTORE_ACCESS_ERROR_MESSAGE, code: 'FIRESTORE_ERROR' }
  }
}

async function persistEmployeeUid(employeeId: string, firebaseUid: string | null): Promise<void> {
  await updateDoc(employeeDoc(employeeId), { firebaseUid })
}

export async function grantButcherAccess(opts: {
  employeeId: string
  displayName: string
  kind: string
  firebaseUid: string | null
  homeStoreId: string | null
  authorizedStores: string[]
  email?: string
}): Promise<TenantResult<{ uid: string }>> {
  if (!(await isOnline())) {
    return { ok: false, error: OFFLINE_ACCOUNT_MESSAGE, code: 'UNAVAILABLE' }
  }

  const email = opts.email ? opts.email.trim() : null
  let byEmployeeId: TenantUserRef | null = null
  let byEmail: TenantUserRef | null = null
  try {
    byEmployeeId = await findTenantUserByEmployeeId(opts.employeeId)
    if (email) byEmail = await findTenantUserByEmail(email)
  } catch (err) {
    console.error('[tenantAuth] No se pudo buscar el perfil del carnicero', err)
    return { ok: false, error: CREATE_ACCOUNT_ERROR_MESSAGE, code: 'FIRESTORE_ERROR' }
  }

  const decision = decideGrantButcherAccess({
    employee: {
      id: opts.employeeId,
      kind: opts.kind,
      firebaseUid: opts.firebaseUid,
    },
    byEmployeeId,
    email,
    byEmail,
  })

  if (decision.action === 'reject') {
    return { ok: false, error: decision.error, code: decision.code }
  }
  if (decision.action === 'email_required') {
    return { ok: false, error: EMAIL_REQUIRED_MESSAGE, code: 'EMAIL_REQUIRED' }
  }

  if (decision.action === 'restore') {
    const restored = await reactivateTenantUser({
      uid: decision.uid,
      displayName: opts.displayName,
      employeeId: opts.employeeId,
    })
    if (!restored.ok) return restored
    try {
      await persistEmployeeUid(opts.employeeId, decision.uid)
    } catch (err) {
      console.error('[tenantAuth] Acceso reactivado pero no se pudo guardar firebaseUid', err)
      return { ok: false, error: RESTORE_ACCESS_ERROR_MESSAGE, code: 'FIRESTORE_ERROR' }
    }
    return { ok: true, data: { uid: decision.uid } }
  }

  const stores = authorizedStoreIdsForGrant(opts.authorizedStores, opts.homeStoreId)
  const created = await createTenantAuthUser({
    email: decision.email,
    displayName: opts.displayName,
    role: 'butcher',
    authorizedStores: stores,
    employeeId: opts.employeeId,
  })
  if (!created.ok) {
    if (created.code === 'ALREADY_EXISTS') {
      try {
        const retry = await findTenantUserByEmail(decision.email)
        if (retry) {
          const restored = await reactivateTenantUser({
            uid: retry.uid,
            displayName: opts.displayName,
            employeeId: opts.employeeId,
          })
          if (!restored.ok) return restored
          await persistEmployeeUid(opts.employeeId, retry.uid)
          return { ok: true, data: { uid: retry.uid } }
        }
      } catch (err) {
        console.error('[tenantAuth] Reintento de restablecer por email falló', err)
      }
    }
    return created
  }

  try {
    await persistEmployeeUid(opts.employeeId, created.data.uid)
  } catch (err) {
    console.error('[tenantAuth] Cuenta creada pero no se pudo guardar firebaseUid', err)
    return { ok: false, error: CREATE_ACCOUNT_ERROR_MESSAGE, code: 'FIRESTORE_ERROR' }
  }
  return { ok: true, data: { uid: created.data.uid } }
}

export async function revokeButcherAccess(opts: {
  employeeId: string
  firebaseUid: string
}): Promise<TenantResult<undefined>> {
  if (!(await isOnline())) {
    return { ok: false, error: OFFLINE_ACCOUNT_MESSAGE, code: 'UNAVAILABLE' }
  }

  try {
    await updateDoc(userDoc(opts.firebaseUid), { active: false })
  } catch (err) {
    console.error('[tenantAuth] No se pudo desactivar en Firestore', err)
    return { ok: false, error: REVOKE_ACCESS_ERROR_MESSAGE, code: 'FIRESTORE_ERROR' }
  }

  try {
    await persistEmployeeUid(opts.employeeId, null)
  } catch (err) {
    console.error('[tenantAuth] Usuario desactivado pero no se pudo limpiar firebaseUid', err)
    return { ok: false, error: REVOKE_ACCESS_ERROR_MESSAGE, code: 'FIRESTORE_ERROR' }
  }

  return { ok: true, data: undefined }
}
