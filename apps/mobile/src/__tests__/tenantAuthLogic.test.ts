import { describe, it, expect } from 'vitest'
import {
  ALREADY_EXISTS_MESSAGE,
  authorizedStoreIdsForGrant,
  buildTenantUserProfile,
  decideGrantButcherAccess,
  isValidStaffEmail,
  mapAuthCreateError,
  mapTenantUserDoc,
  normalizeStaffEmail,
  orphanedAuthUserMessage,
  pickButcherProfile,
  resolveButcherAccess,
  resolveCreateAuthFailure,
  validateCashierAlta,
} from '../lib/tenantAuthLogic'

describe('validateCashierAlta', () => {
  it('exige nombre, email válido y al menos un local', () => {
    expect(validateCashierAlta({ name: 'A', email: 'a@b.com', authorizedStores: ['s1'] })).toEqual({
      ok: false,
      error: 'El nombre debe tener al menos 2 caracteres.',
    })
    expect(validateCashierAlta({ name: 'Ana', email: '', authorizedStores: ['s1'] })).toEqual({
      ok: false,
      error: 'El email es obligatorio.',
    })
    expect(validateCashierAlta({ name: 'Ana', email: 'no-es-mail', authorizedStores: ['s1'] })).toEqual({
      ok: false,
      error: 'Ingresá un email válido.',
    })
    expect(validateCashierAlta({ name: 'Ana', email: 'ana@x.com', authorizedStores: [] })).toEqual({
      ok: false,
      error: 'No hay locales activos. Creá un local antes de dar de alta una cajera.',
    })
    expect(validateCashierAlta({ name: '  Ana  ', email: 'Ana@X.COM', authorizedStores: ['s1'] })).toEqual({
      ok: true,
      name: 'Ana',
      email: 'ana@x.com',
    })
  })
})

describe('email helpers', () => {
  it('normaliza y valida', () => {
    expect(normalizeStaffEmail('  Foo@Bar.COM ')).toBe('foo@bar.com')
    expect(isValidStaffEmail('a@b.c')).toBe(true)
    expect(isValidStaffEmail('x')).toBe(false)
    expect(isValidStaffEmail('a@b')).toBe(false)
  })
})

describe('mapTenantUserDoc / pickButcherProfile', () => {
  it('mapea campos y prefiere butcher inactivo', () => {
    const mapped = mapTenantUserDoc('uid-1', {
      email: 'a@a.com',
      role: 'butcher',
      employeeId: 'emp-1',
      active: false,
    })
    expect(mapped).toEqual({
      uid: 'uid-1',
      email: 'a@a.com',
      role: 'butcher',
      employeeId: 'emp-1',
      active: false,
    })
    expect(pickButcherProfile([
      { uid: 'on', email: 'a@a.com', role: 'butcher', employeeId: 'e', active: true },
      { uid: 'off', email: 'b@b.com', role: 'butcher', employeeId: 'e', active: false },
    ])?.uid).toBe('off')
    expect(pickButcherProfile([
      { uid: 'c', email: 'x@x.com', role: 'cashier', employeeId: null, active: false },
    ])).toBeNull()
  })
})

describe('buildTenantUserProfile', () => {
  it('incluye employeeId solo en carniceros', () => {
    expect(buildTenantUserProfile({
      role: 'cashier',
      displayName: 'Ana',
      email: 'ana@x.com',
      authorizedStores: ['s1'],
    })).toEqual({
      role: 'cashier',
      displayName: 'Ana',
      email: 'ana@x.com',
      authorizedStores: ['s1'],
      active: true,
      deleted: false,
    })
    expect(buildTenantUserProfile({
      role: 'butcher',
      displayName: 'Juan',
      email: 'j@x.com',
      authorizedStores: ['s1'],
      employeeId: 'emp-1',
    })).toMatchObject({ role: 'butcher', employeeId: 'emp-1' })
  })
})

describe('mapAuthCreateError / resolveCreateAuthFailure', () => {
  it('distingue email en uso, huérfano y sin red', () => {
    expect(mapAuthCreateError({ code: 'auth/email-already-in-use' }, false).code).toBe('ALREADY_EXISTS')
    expect(mapAuthCreateError({ code: 'auth/email-already-in-use' }, true).code).toBeUndefined()
    expect(mapAuthCreateError({ code: 'auth/network-request-failed' }, false).code).toBe('UNAVAILABLE')
    expect(resolveCreateAuthFailure({ email: 'a@a.com', hasFirestoreProfile: false })).toEqual({
      error: orphanedAuthUserMessage('a@a.com'),
      code: 'ORPHANED_AUTH_USER',
    })
    expect(resolveCreateAuthFailure({ email: 'a@a.com', hasFirestoreProfile: true })).toEqual({
      error: ALREADY_EXISTS_MESSAGE,
      code: 'ALREADY_EXISTS',
    })
  })
})

describe('decideGrantButcherAccess', () => {
  const butcher = { id: 'emp-1', kind: 'butcher', firebaseUid: null as string | null }

  it('rechaza si no hay ficha, no es carnicero o ya tiene acceso', () => {
    expect(decideGrantButcherAccess({
      employee: null, byEmployeeId: null, email: null, byEmail: null,
    }).action).toBe('reject')
    expect(decideGrantButcherAccess({
      employee: { id: 'e', kind: 'cashier', firebaseUid: null },
      byEmployeeId: null, email: 'a@a.com', byEmail: null,
    })).toMatchObject({ action: 'reject', code: 'INVALID_PAYLOAD' })
    expect(decideGrantButcherAccess({
      employee: { ...butcher, firebaseUid: 'uid-on' },
      byEmployeeId: null, email: null, byEmail: null,
    })).toMatchObject({ action: 'reject', code: 'ALREADY_EXISTS' })
  })

  it('restablece por employeeId sin pedir email', () => {
    expect(decideGrantButcherAccess({
      employee: butcher,
      byEmployeeId: { uid: 'uid-old', email: 'c@c.com', role: 'butcher', employeeId: 'emp-1', active: false },
      email: null,
      byEmail: null,
    })).toEqual({ action: 'restore', uid: 'uid-old' })
  })

  it('pide email si no hay cuenta previa', () => {
    expect(decideGrantButcherAccess({
      employee: butcher, byEmployeeId: null, email: null, byEmail: null,
    })).toEqual({ action: 'email_required' })
  })

  it('crea si el email no está usado; restablece si el perfil es del mismo empleado', () => {
    expect(decideGrantButcherAccess({
      employee: butcher, byEmployeeId: null, email: 'nuevo@x.com', byEmail: null,
    })).toEqual({ action: 'create', email: 'nuevo@x.com' })
    expect(decideGrantButcherAccess({
      employee: butcher,
      byEmployeeId: null,
      email: 'viejo@x.com',
      byEmail: { uid: 'uid-mail', email: 'viejo@x.com', role: 'butcher', employeeId: null, active: false },
    })).toEqual({ action: 'restore', uid: 'uid-mail' })
    expect(decideGrantButcherAccess({
      employee: butcher,
      byEmployeeId: null,
      email: 'otro@x.com',
      byEmail: { uid: 'uid-x', email: 'otro@x.com', role: 'butcher', employeeId: 'emp-otro', active: false },
    })).toMatchObject({ action: 'reject', code: 'ALREADY_EXISTS' })
  })
})

describe('resolveButcherAccess', () => {
  it('usa el perfil activo ligado por employeeId o uid', () => {
    expect(resolveButcherAccess(
      { id: 'emp-1', firebaseUid: null },
      [{ uid: 'u1', email: 'c@c.com', role: 'butcher', employeeId: 'emp-1', active: true }],
    )).toEqual({ firebaseUid: 'u1', email: 'c@c.com' })
    expect(resolveButcherAccess(
      { id: 'emp-1', firebaseUid: 'u2' },
      [{ uid: 'u2', email: 'd@d.com', role: 'butcher', employeeId: null, active: true }],
    )).toEqual({ firebaseUid: 'u2', email: 'd@d.com' })
    expect(resolveButcherAccess(
      { id: 'emp-1', firebaseUid: 'u3' },
      [{ uid: 'u3', email: 'e@e.com', role: 'butcher', employeeId: 'emp-1', active: false }],
    )).toEqual({ firebaseUid: null, email: null })
  })
})

describe('authorizedStoreIdsForGrant', () => {
  it('cae al local habitual si no hay locales activos', () => {
    expect(authorizedStoreIdsForGrant(['a', 'b'], 'h')).toEqual(['a', 'b'])
    expect(authorizedStoreIdsForGrant([], 'home')).toEqual(['home'])
    expect(authorizedStoreIdsForGrant([], null)).toEqual(['default'])
  })
})
