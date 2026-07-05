import {
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { v4 as uuidv4 } from 'uuid'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import { relayEventsPath } from '@carniceria/shared'
import type { RelayScanEvent, RelayScanStatus } from '@carniceria/shared'

const db = getFirestore(firebaseApp)

/**
 * Escribe un evento de relay en Firestore con status='pending'.
 * El eventId se genera en el dispositivo para idempotencia.
 * Retorna el eventId generado.
 */
export async function publishScanEvent(
  storeId: string,
  barcode: string,
  uid: string
): Promise<string> {
  const eventId = uuidv4()
  const eventsPath = relayEventsPath(LICENSE_KEY, storeId)
  const eventRef = doc(collection(db, eventsPath), eventId)

  const event: RelayScanEvent = {
    eventId,
    barcode,
    status: 'pending',
    createdAt: new Date().toISOString(),
    createdByUid: uid,
  }

  await setDoc(eventRef, event)
  return eventId
}

/**
 * Escucha un evento específico y llama al callback cuando cambia su status.
 * Retorna una función para cancelar la suscripción.
 */
export function watchScanEvent(
  storeId: string,
  eventId: string,
  onUpdate: (status: RelayScanStatus, event: RelayScanEvent) => void
): Unsubscribe {
  const eventsPath = relayEventsPath(LICENSE_KEY, storeId)
  const eventRef = doc(db, eventsPath, eventId)

  return onSnapshot(eventRef, snap => {
    if (!snap.exists()) return
    const data = snap.data() as RelayScanEvent
    onUpdate(data.status, data)
  })
}
