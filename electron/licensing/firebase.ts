/**
 * Inicialización de Firebase.
 * En sandbox: Firebase completamente desactivado.
 * En producción: inicializa con las credenciales del entorno.
 *
 * REGLA: Cero credenciales hardcodeadas. Todo viene de variables de entorno
 * inyectadas en tiempo de build.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import log from 'electron-log'

const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'

let _app: FirebaseApp | null = null

export function getFirebaseApp(): FirebaseApp {
  if (APP_ENV === 'sandbox') {
    throw new Error('[firebase] Firebase desactivado en modo sandbox.')
  }
  if (_app) return _app

  const config = {
    apiKey: process.env['VITE_FIREBASE_API_KEY'],
    authDomain: process.env['VITE_FIREBASE_AUTH_DOMAIN'],
    projectId: process.env['VITE_FIREBASE_PROJECT_ID'],
    storageBucket: process.env['VITE_FIREBASE_STORAGE_BUCKET'],
    messagingSenderId: process.env['VITE_FIREBASE_MESSAGING_SENDER_ID'],
    appId: process.env['VITE_FIREBASE_APP_ID'],
  }

  const missing = Object.entries(config)
    .filter(([, v]) => !v)
    .map(([k]) => k)

  if (missing.length > 0) {
    throw new Error(
      `[firebase] Variables de entorno faltantes: ${missing.join(', ')}. ` +
      'Verificar .env.production antes de continuar.'
    )
  }

  if (getApps().length === 0) {
    _app = initializeApp(config)
    log.info('[firebase] App inicializada')
  } else {
    _app = getApps()[0]
  }

  return _app
}

export function isFirebaseAvailable(): boolean {
  return APP_ENV === 'production'
}
