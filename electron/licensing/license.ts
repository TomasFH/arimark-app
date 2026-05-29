/**
 * Verificación de licencia contra Firestore.
 * Implementa la ventana de 48h offline y el log de actividad.
 */

import { getFirestore, doc, getDoc } from 'firebase/firestore'
import { getFirebaseApp } from './firebase'
import { getSecret, setSecret, SECRET_KEYS } from '../secureStorage'
import log from 'electron-log'

const OFFLINE_WINDOW_HOURS = 48

export type LicenseStatus =
  | { valid: true }
  | { valid: false; reason: 'inactive' | 'expired' | 'offline_timeout' | 'not_found' | 'error'; message: string }

export interface LicenseData {
  activo: boolean
  vencimiento: { toDate: () => Date } | null
  cliente: string
  plan: string
  max_stores: number
  stores_created: number
}

/**
 * Verifica la licencia contra Firestore.
 * Si no hay internet, permite hasta 48h desde la última verificación exitosa.
 */
export async function verifyLicense(licenseKey: string): Promise<LicenseStatus> {
  const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'

  if (APP_ENV === 'sandbox') {
    log.info('[license] Modo sandbox — verificación omitida, licencia siempre válida')
    return { valid: true }
  }

  try {
    const app = getFirebaseApp()
    const db = getFirestore(app)
    const licenseRef = doc(db, 'licenses', licenseKey)
    const snap = await getDoc(licenseRef)

    if (!snap.exists()) {
      return { valid: false, reason: 'not_found', message: 'Licencia no encontrada en el servidor.' }
    }

    const data = snap.data() as LicenseData

    if (!data.activo) {
      return { valid: false, reason: 'inactive', message: 'La licencia está desactivada. Contactar soporte.' }
    }

    if (data.vencimiento) {
      const expiry = data.vencimiento.toDate()
      if (expiry < new Date()) {
        return { valid: false, reason: 'expired', message: `La licencia venció el ${expiry.toLocaleDateString('es-AR')}.` }
      }
    }

    await setSecret(SECRET_KEYS.LAST_LICENSE_VERIFIED_AT, new Date().toISOString())
    log.info('[license] Verificación exitosa')
    return { valid: true }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn('[license] Sin conexión o error de red', message)
    return await checkOfflineWindow()
  }
}

/**
 * Si no hay internet, verifica si la última verificación fue hace menos de 48h.
 */
async function checkOfflineWindow(): Promise<LicenseStatus> {
  const lastVerifiedStr = getSecret(SECRET_KEYS.LAST_LICENSE_VERIFIED_AT)

  if (!lastVerifiedStr) {
    return {
      valid: false,
      reason: 'offline_timeout',
      message: 'Sin conexión y sin verificación previa. Se requiere conexión a internet para el primer uso.',
    }
  }

  const lastVerified = new Date(lastVerifiedStr)
  const hoursElapsed = (Date.now() - lastVerified.getTime()) / (1000 * 60 * 60)

  if (hoursElapsed <= OFFLINE_WINDOW_HOURS) {
    log.info('[license] Modo offline aceptado', { hoursElapsed: hoursElapsed.toFixed(1) })
    return { valid: true }
  }

  return {
    valid: false,
    reason: 'offline_timeout',
    message: `Sin conexión por más de ${OFFLINE_WINDOW_HOURS}h. Se requiere internet para continuar.`,
  }
}
