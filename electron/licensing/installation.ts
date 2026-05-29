/**
 * Gestión de instalaciones vinculadas a UID anónimo de Firebase.
 *
 * Flujo:
 * 1. signInAnonymously() → obtiene UID efímero pero persistido por Firebase SDK
 * 2. Verificar si el UID ya está en installations/{uid} con status='active'
 * 3. Si no → pantalla de activación con código de un solo uso
 * 4. Cloud Function activateInstallation valida el código y crea el documento
 *
 * En reinstalación (UID cambia): el cliente pide al desarrollador un nuevo código.
 */

import {
  getAuth,
  signInAnonymously,
} from 'firebase/auth'
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore'
import { getFirebaseApp } from './firebase'
import { getSecret, setSecret, SECRET_KEYS } from '../secureStorage'
import log from 'electron-log'
import os from 'os'

export interface InstallationStatus {
  uid: string
  activated: boolean
}

/**
 * Realiza signInAnonymously y retorna el UID.
 * El UID se persiste en safeStorage para detectar cambios (reinstalaciones).
 */
export async function signInAnon(): Promise<string> {
  const app = getFirebaseApp()
  const auth = getAuth(app)

  const credential = await signInAnonymously(auth)
  const uid = credential.user.uid

  const previousUid = getSecret(SECRET_KEYS.FIREBASE_ANON_UID)
  if (previousUid && previousUid !== uid) {
    log.warn('[installation] UID cambió — posible reinstalación', { previousUid, newUid: uid })
  }

  await setSecret(SECRET_KEYS.FIREBASE_ANON_UID, uid)
  log.info('[installation] signInAnonymously OK', { uid })
  return uid
}

/**
 * Verifica si la instalación actual (UID) está activa en Firestore.
 */
export async function checkInstallationStatus(
  licenseKey: string,
  uid: string
): Promise<InstallationStatus> {
  const app = getFirebaseApp()
  const db = getFirestore(app)

  const installRef = doc(db, 'licenses', licenseKey, 'installations', uid)
  const snap = await getDoc(installRef)

  if (!snap.exists()) {
    return { uid, activated: false }
  }

  const data = snap.data() as { status: string }
  const activated = data.status === 'active'

  if (activated) {
    await _updateLastSeen(db, licenseKey, uid)
  }

  return { uid, activated }
}

/**
 * Llama a la Cloud Function activateInstallation.
 * Si el código es válido, crea el documento installations/{uid} con status='active'.
 */
export async function activateInstallation(
  licenseKey: string,
  uid: string,
  activationCode: string
): Promise<{ ok: boolean; error?: string }> {
  const app = getFirebaseApp()
  const auth = getAuth(app)

  if (!auth.currentUser) {
    return { ok: false, error: 'No hay sesión anónima activa.' }
  }

  try {
    const token = await auth.currentUser.getIdToken()

    const projectId = process.env['VITE_FIREBASE_PROJECT_ID']
    const region = 'us-central1'
    const functionUrl = `https://${region}-${projectId}.cloudfunctions.net/activateInstallation`

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        licenseKey,
        uid,
        activationCode,
        deviceHint: getDeviceHint(),
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      log.error('[installation] activateInstallation falló', response.status, body)
      return { ok: false, error: `Error del servidor: ${response.status}` }
    }

    log.info('[installation] Instalación activada correctamente')
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('[installation] Error al llamar Cloud Function', message)
    return { ok: false, error: message }
  }
}

/**
 * Registra un evento en el activity_log de Firestore.
 * Incluye si el login ocurrió offline.
 */
export async function logActivity(
  licenseKey: string,
  storeId: string,
  role: string,
  offline: boolean
): Promise<void> {
  try {
    const app = getFirebaseApp()
    const db = getFirestore(app)
    const logRef = collection(db, 'licenses', licenseKey, 'activity_log')

    await addDoc(logRef, {
      timestamp: new Date().toISOString(),
      store_id: storeId,
      role,
      device_hint: getDeviceHint(),
      offline,
    })
  } catch (err) {
    log.warn('[installation] No se pudo registrar actividad (no crítico)', err)
  }
}

function getDeviceHint(): string {
  return `${os.hostname()}/${os.platform()}/${os.arch()}`
}

async function _updateLastSeen(db: Firestore, licenseKey: string, uid: string): Promise<void> {
  try {
    const installRef = doc(db, 'licenses', licenseKey, 'installations', uid)
    await setDoc(installRef, { last_seen: serverTimestamp() }, { merge: true })
  } catch (err) {
    log.warn('[installation] No se pudo actualizar last_seen', err)
  }
}
