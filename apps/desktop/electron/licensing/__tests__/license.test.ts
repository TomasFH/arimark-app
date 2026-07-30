import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}))

vi.mock('../firebase', () => ({
  getFirebaseApp: vi.fn(),
  isFirebaseAvailable: vi.fn().mockReturnValue(true),
}))

import { getDoc } from 'firebase/firestore'
import { verifyLicense } from '../license'

describe('verifyLicense', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['APP_ENV'] = 'production'
  })

  it('siempre retorna válida en modo production (gate eliminado — A1)', async () => {
    const result = await verifyLicense('ANY-KEY')
    expect(result.valid).toBe(true)
    expect(getDoc).not.toHaveBeenCalled()
  })

  it('siempre retorna válida en modo dev', async () => {
    process.env['APP_ENV'] = 'dev'
    const result = await verifyLicense('ANY-KEY')
    expect(result.valid).toBe(true)
    expect(getDoc).not.toHaveBeenCalled()
  })

  it('no consulta Firestore aunque la clave sea desconocida', async () => {
    const result = await verifyLicense('MISSING-KEY')
    expect(result.valid).toBe(true)
    expect(getDoc).not.toHaveBeenCalled()
  })
})
