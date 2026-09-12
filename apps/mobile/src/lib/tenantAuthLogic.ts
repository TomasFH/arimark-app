/**
 * Lógica pura del alta de cuentas (cajera / carnicero) en el celu.
 * Sin Firebase: las decisiones y el mapeo se testean sin red.
 */
export const OFFLINE_ACCOUNT_MESSAGE = 'Hace falta internet para crear la cuenta.'
export const ALREADY_EXISTS_MESSAGE = 'Ya existe una cuenta con ese email.'
export const CREATE_ACCOUNT_ERROR_MESSAGE = 'Error al crear la cuenta. Intentar nuevamente.'
export const EMAIL_REQUIRED_MESSAGE = 'Ingresá el email para crear la cuenta.'
export const REVOKE_ACCESS_ERROR_MESSAGE =
  'No se pudo revocar el acceso. Verificá la conexión e intentá de nuevo.'
export const RESTORE_ACCESS_ERROR_MESSAGE =
  'No se pudo restablecer el acceso. Verificá la conexión e intentá de nuevo.'

export interface TenantUserRef {
  uid: string
  email: string | null
  role: string
  employeeId: string | null
  active: boolean
}

export type TenantAuthFailCode =
  | 'ALREADY_EXISTS'
  | 'ORPHANED_AUTH_USER'
  | 'EMAIL_REQUIRED'
  | 'UNAVAILABLE'
  | 'FIRESTORE_ERROR'
  | 'INVALID_PAYLOAD'
  | 'NOT_FOUND'

export type GrantButcherDecision =
  | { action: 'reject'; error: string; code: TenantAuthFailCode }
  | { action: 'restore'; uid: string }
  | { action: 'create'; email: string }
  | { action: 'email_required' }

export function normalizeStaffEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isValidStaffEmail(email: string): boolean {
  if (email.length < 5 || email.length > 120) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function orphanedAuthUserMessage(email: string): string {
  return `El email "${email}" existe en autenticación pero no tiene perfil (cuenta incompleta). Eliminala desde Firebase Console y volvé a intentarlo.`
}

export function validateCashierAlta(input: {
  name: string
  email: string
  authorizedStores: string[]
}): { ok: true; name: string; email: string } | { ok: false; error: string } {
  const name = input.name.trim()
  if (name.length < 2) {
    return { ok: false, error: 'El nombre debe tener al menos 2 caracteres.' }
  }
  if (name.length > 100) {
    return { ok: false, error: 'El nombre es demasiado largo.' }
  }
  const email = normalizeStaffEmail(input.email)
  if (!email) {
    return { ok: false, error: 'El email es obligatorio.' }
  }
  if (!isValidStaffEmail(email)) {
    return { ok: false, error: 'Ingresá un email válido.' }
  }
  if (input.authorizedStores.length === 0) {
    return {
      ok: false,
      error: 'No hay locales activos. Creá un local antes de dar de alta una cajera.',
    }
  }
  return { ok: true, name, email }
}

export function mapTenantUserDoc(
  id: string,
  data: Record<string, unknown>,
): TenantUserRef {
  return {
    uid: id,
    email: typeof data['email'] === 'string' ? data['email'] : null,
    role: typeof data['role'] === 'string' ? data['role'] : '',
    employeeId: typeof data['employeeId'] === 'string' ? data['employeeId'] : null,
    active: data['active'] !== false,
  }
}

/** Prefiere un butcher inactivo (para restablecer) si hay más de uno. */
export function pickButcherProfile(users: TenantUserRef[]): TenantUserRef | null {
  const butchers = users.filter(u => u.role === 'butcher')
  if (butchers.length === 0) return null
  return butchers.find(u => u.active === false) ?? butchers[0] ?? null
}

export function buildTenantUserProfile(opts: {
  role: 'cashier' | 'butcher'
  displayName: string
  email: string
  authorizedStores: string[]
  employeeId?: string
}): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    role: opts.role,
    displayName: opts.displayName,
    email: opts.email,
    authorizedStores: opts.authorizedStores,
    active: true,
    deleted: false,
  }
  if (opts.employeeId) profile['employeeId'] = opts.employeeId
  return profile
}

export function mapAuthCreateError(err: unknown, authUserCreated: boolean): {
  code?: TenantAuthFailCode
  firebaseCode?: string
} {
  const firebaseCode = (err as { code?: string }).code
  if (!authUserCreated && firebaseCode === 'auth/email-already-in-use') {
    return { firebaseCode, code: 'ALREADY_EXISTS' }
  }
  if (
    firebaseCode === 'auth/network-request-failed' ||
    firebaseCode === 'auth/timeout' ||
    firebaseCode === 'unavailable'
  ) {
    return { firebaseCode, code: 'UNAVAILABLE' }
  }
  return { firebaseCode }
}

export function resolveCreateAuthFailure(opts: {
  email: string
  hasFirestoreProfile: boolean | null
}): { error: string; code: TenantAuthFailCode } {
  if (opts.hasFirestoreProfile === false) {
    return { error: orphanedAuthUserMessage(opts.email), code: 'ORPHANED_AUTH_USER' }
  }
  return { error: ALREADY_EXISTS_MESSAGE, code: 'ALREADY_EXISTS' }
}

export function decideGrantButcherAccess(input: {
  employee: { id: string; kind: string; firebaseUid: string | null } | null
  byEmployeeId: TenantUserRef | null
  email: string | null
  byEmail: TenantUserRef | null
}): GrantButcherDecision {
  if (!input.employee) {
    return { action: 'reject', error: 'Empleado no encontrado.', code: 'NOT_FOUND' }
  }
  if (input.employee.kind !== 'butcher') {
    return {
      action: 'reject',
      error: 'Solo los carniceros pueden recibir acceso celular.',
      code: 'INVALID_PAYLOAD',
    }
  }
  if (input.employee.firebaseUid) {
    return {
      action: 'reject',
      error: 'Este carnicero ya tiene acceso al celular.',
      code: 'ALREADY_EXISTS',
    }
  }
  if (input.byEmployeeId) {
    return { action: 'restore', uid: input.byEmployeeId.uid }
  }

  const email = input.email ? normalizeStaffEmail(input.email) : null
  if (email) {
    if (!isValidStaffEmail(email)) {
      return { action: 'reject', error: 'Ingresá un email válido.', code: 'INVALID_PAYLOAD' }
    }
    if (input.byEmail) {
      if (input.byEmail.employeeId && input.byEmail.employeeId !== input.employee.id) {
        return { action: 'reject', error: ALREADY_EXISTS_MESSAGE, code: 'ALREADY_EXISTS' }
      }
      return { action: 'restore', uid: input.byEmail.uid }
    }
    return { action: 'create', email }
  }

  return { action: 'email_required' }
}

export function resolveButcherAccess(
  employee: { id: string; firebaseUid: string | null },
  butcherUsers: TenantUserRef[],
): { firebaseUid: string | null; email: string | null } {
  const matches = butcherUsers.filter(u =>
    (u.employeeId !== null && u.employeeId === employee.id)
    || (employee.firebaseUid !== null && u.uid === employee.firebaseUid),
  )
  const active = matches.find(u => u.active)
  if (active) {
    return { firebaseUid: active.uid, email: active.email }
  }
  return { firebaseUid: null, email: null }
}

export function authorizedStoreIdsForGrant(
  activeStoreIds: string[],
  homeStoreId: string | null,
): string[] {
  if (activeStoreIds.length > 0) return activeStoreIds
  return [homeStoreId ?? 'default']
}
