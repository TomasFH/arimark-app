/**
 * Setup de tests del POS móvil.
 * Reemplaza IndexedDB con fake-indexeddb para tests unitarios.
 */
import 'fake-indexeddb/auto'

// El módulo firebase se mockea para evitar dependencias de red.
import { vi } from 'vitest'

vi.mock('../firebase', () => ({
  firebaseApp: {},
  auth: { currentUser: null },
  LICENSE_KEY: 'test-license',
}))

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ currentUser: null })),
  initializeAuth: vi.fn(() => ({ currentUser: null })),
  indexedDBLocalPersistence: {},
  browserLocalPersistence: {},
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(() => () => {}),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  collection: vi.fn(),
}))
