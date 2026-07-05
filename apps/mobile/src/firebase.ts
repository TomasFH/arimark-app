import { initializeApp, getApps } from 'firebase/app'

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

export const LICENSE_KEY = import.meta.env['VITE_LICENSE_KEY'] as string
