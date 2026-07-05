import { initializeApp, getApps } from 'firebase/app'
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  type Auth,
} from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env['VITE_FIREBASE_API_KEY'] as string,
  authDomain: import.meta.env['VITE_FIREBASE_AUTH_DOMAIN'] as string,
  projectId: import.meta.env['VITE_FIREBASE_PROJECT_ID'] as string,
  storageBucket: import.meta.env['VITE_FIREBASE_STORAGE_BUCKET'] as string,
  messagingSenderId: import.meta.env['VITE_FIREBASE_MESSAGING_SENDER_ID'] as string,
  appId: import.meta.env['VITE_FIREBASE_APP_ID'] as string,
}

export const firebaseApp =
  getApps().length > 0 ? getApps()[0]! : initializeApp(firebaseConfig)

/**
 * Auth con persistencia local explícita.
 *
 * La sesión (refresh token) queda guardada en IndexedDB del dispositivo. Esto
 * es lo que permite que, tras iniciar sesión UNA vez con internet, la cajera
 * quede autenticada de forma indefinida — incluso reabriendo la app sin
 * conexión. Reemplaza al viejo PIN de emergencia: no hay claves que recordar.
 *
 * Se listan dos backends de persistencia por orden de preferencia: IndexedDB
 * (WebView de Capacitor / navegadores modernos) y localStorage como respaldo.
 */
export const auth: Auth = initializeAuth(firebaseApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
})

export const LICENSE_KEY = import.meta.env['VITE_LICENSE_KEY'] as string
