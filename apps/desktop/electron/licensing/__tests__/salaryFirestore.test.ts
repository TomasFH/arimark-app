import { describe, it, expect, vi } from 'vitest'

vi.mock('../firebase', () => ({
  isFirebaseAvailable: vi.fn(() => false),
  getFirebaseApp: vi.fn(),
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn(() => ({ tenant_id: 'tenant-test' })),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn((col: unknown) => col),
  where: vi.fn(),
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { firestorePaidAtBounds } from '../salaryFirestore'

describe('firestorePaidAtBounds', () => {
  it('el recorte Firestore es más ancho que la semana civil', () => {
    const b = firestorePaidAtBounds('2026-07-27', '2026-08-02')
    expect(b.from < '2026-07-27T00:00:00.000Z').toBe(true)
    expect(b.to > '2026-08-02T23:59:59.000Z').toBe(true)
  })
})
