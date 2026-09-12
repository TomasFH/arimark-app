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

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn(async () => ({ connected: false })),
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
  },
}))

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn((_opts?: unknown, name?: string) => ({
    name: name ?? '[DEFAULT]',
    options: {},
  })),
  getApps: vi.fn(() => [{ name: '[DEFAULT]', options: {} }]),
}))

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ currentUser: null })),
  initializeAuth: vi.fn(() => ({ currentUser: null })),
  indexedDBLocalPersistence: {},
  browserLocalPersistence: {},
  inMemoryPersistence: {},
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  updatePassword: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  EmailAuthProvider: {
    credential: vi.fn((email: string, password: string) => ({ email, password })),
  },
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(() => () => {}),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocFromServer: vi.fn(),
  setDoc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  updateDoc: vi.fn(),
}))
