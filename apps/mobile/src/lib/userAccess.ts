/**
 * Reglas de acceso al POS móvil a partir del documento
 * `licenses/{key}/users/{uid}`. Puras: sin Firebase ni IndexedDB.
 */
import type { LocalProfile } from '../types/pos'

export const ACCESS_REVOKED_MESSAGE = 'Usuario desactivado. Contactar al administrador.'
export const ACCESS_UNAUTHORIZED_MESSAGE = 'Usuario no registrado o sin rol autorizado.'

export type AppRole = 'cashier' | 'admin' | 'butcher'
export type AccessDenial = 'inactive' | 'unauthorized'

export function isAllowedAppRole(role: unknown): role is AppRole {
  return role === 'cashier' || role === 'admin' || role === 'butcher'
}

/**
 * Motivo por el que el perfil no puede usar la app, o null si está habilitado.
 * `active` ausente se trata como habilitado (docs viejos).
 */
export function denyUserAccess(data: Record<string, unknown> | undefined | null): AccessDenial | null {
  if (!data) return 'unauthorized'
  if (data['deleted'] === true || data['active'] === false) return 'inactive'
  if (!isAllowedAppRole(data['role'])) return 'unauthorized'
  return null
}

export function accessDenialMessage(reason: AccessDenial): string {
  return reason === 'inactive' ? ACCESS_REVOKED_MESSAGE : ACCESS_UNAUTHORIZED_MESSAGE
}

export function buildLocalProfile(
  uid: string,
  email: string,
  data: Record<string, unknown>,
): LocalProfile | null {
  if (denyUserAccess(data)) return null
  const role = data['role'] as AppRole
  const stores = data['authorizedStores']
  return {
    uid,
    displayName: (typeof data['displayName'] === 'string' && data['displayName'].trim())
      ? data['displayName'].trim()
      : (email.split('@')[0] || email),
    role,
    authorizedStores: Array.isArray(stores)
      ? stores.filter((s): s is string => typeof s === 'string')
      : [],
    email,
    employeeId: typeof data['employeeId'] === 'string' ? data['employeeId'] : undefined,
  }
}
