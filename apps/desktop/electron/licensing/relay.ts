/**
 * Listener de relay Firestore para el proceso main del desktop.
 *
 * Flujo:
 *  1. La PWA móvil escribe un RelayScanEvent con status='pending'.
 *  2. Este listener observa nuevos eventos pending en el local activo.
 *  3. Valida el barcode (parseKretzBarcode) y el PLU en SQLite.
 *  4. Actualiza el evento a 'accepted' (+ productName) o 'rejected' (+ motivo).
 *  5. Si fue aceptado, llama a onAcceptedBarcode para que el caller lo inyecte al renderer vía IPC.
 *
 * Nota: los tipos de relay están definidos localmente para que tsc pueda compilar
 * este módulo a CJS sin depender de la ruta simbólica de @carniceria/shared.
 * El contrato canonical es packages/shared/src/relay.ts.
 */

import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import log from 'electron-log'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { getDb } from '../db/client'
import { products, productPrices } from '../db/schema'
import { eq } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Tipos locales del relay (mirror de packages/shared/src/relay.ts)
// ---------------------------------------------------------------------------

interface RelayScanEvent {
  eventId: string
  barcode: string
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
  createdByUid: string
  productName?: string
  rejectReason?: string
}

function relayEventsPath(licenseKey: string, storeId: string): string {
  return `licenses/${licenseKey}/relay/${storeId}/events`
}

// ---------------------------------------------------------------------------
// Barcode parser (inline — no import desde shared para evitar issues de runtime)
// ---------------------------------------------------------------------------

const KRETZ_PREFIX = '20'
const KRETZ_LENGTH = 13

function parseKretzBarcodeLocal(raw: string): { pluNumber: string; totalCents: number } | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== KRETZ_LENGTH) return null
  if (!digits.startsWith(KRETZ_PREFIX)) return null
  if (!verifyEan13(digits)) return null

  const pluNumber = digits.slice(2, 5)
  const totalCents = parseInt(digits.slice(5, 12), 10)
  return { pluNumber, totalCents }
}

function verifyEan13(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const d = parseInt(digits[i]!, 10)
    sum += i % 2 === 0 ? d : d * 3
  }
  const computed = (10 - (sum % 10)) % 10
  return computed === parseInt(digits[12]!, 10)
}

// ---------------------------------------------------------------------------
// Listener principal
// ---------------------------------------------------------------------------

let _unsub: Unsubscribe | null = null

/**
 * Inicia la escucha de eventos relay para el local dado.
 * Si ya hay un listener activo lo detiene primero.
 *
 * @param licenseKey - Clave de licencia del negocio
 * @param storeId    - ID del local activo
 * @param onAcceptedBarcode - Callback que recibe los dígitos del barcode aceptado
 */
export function startRelayListener(
  licenseKey: string,
  storeId: string,
  onAcceptedBarcode: (digits: string) => void
): void {
  stopRelayListener()

  if (!isFirebaseAvailable()) {
    log.info('[relay] Firebase no disponible en modo dev — listener de relay deshabilitado')
    return
  }

  try {
    const app = getFirebaseApp()
    const db = getFirestore(app)
    const eventsPath = relayEventsPath(licenseKey, storeId)
    const eventsRef = collection(db, eventsPath)
    const pendingQuery = query(eventsRef, where('status', '==', 'pending'))

    _unsub = onSnapshot(
      pendingQuery,
      async snapshot => {
        for (const change of snapshot.docChanges()) {
          if (change.type !== 'added') continue

          const event = change.doc.data() as RelayScanEvent
          const eventRef = doc(db, eventsPath, event.eventId)

          const parsed = parseKretzBarcodeLocal(event.barcode)
          if (!parsed) {
            log.warn('[relay] Barcode inválido recibido', { barcode: event.barcode })
            await updateDoc(eventRef, {
              status: 'rejected',
              rejectReason: 'Código de barras no reconocido (no es un ticket KRETZ).',
            }).catch(e => log.error('[relay] Error actualizando rejected', e))
            continue
          }

          const pluNum = parseInt(parsed.pluNumber, 10)
          const product = lookupProduct(pluNum)

          if (!product) {
            log.warn('[relay] PLU no encontrado en catálogo local', { plu: pluNum })
            await updateDoc(eventRef, {
              status: 'rejected',
              rejectReason: `PLU ${pluNum} no está en el catálogo. Verificá la configuración.`,
            }).catch(e => log.error('[relay] Error actualizando rejected', e))
            continue
          }

          log.info('[relay] Barcode aceptado', { barcode: event.barcode, product: product.name })
          await updateDoc(eventRef, {
            status: 'accepted',
            productName: product.name,
          }).catch(e => log.error('[relay] Error actualizando accepted', e))

          onAcceptedBarcode(event.barcode)
        }
      },
      err => {
        log.error('[relay] Error en onSnapshot', err)
      }
    )

    log.info('[relay] Listener iniciado', { licenseKey, storeId })
  } catch (err) {
    log.error('[relay] No se pudo iniciar el listener', err)
  }
}

/** Detiene el listener de relay si estaba activo. */
export function stopRelayListener(): void {
  if (_unsub) {
    _unsub()
    _unsub = null
    log.info('[relay] Listener detenido')
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lookupProduct(pluNumber: number): { name: string } | null {
  try {
    const db = getDb()
    const rows = db
      .select({ name: products.name })
      .from(products)
      .leftJoin(productPrices, eq(productPrices.productId, products.id))
      .where(eq(products.pluNumber, pluNumber))
      .limit(1)
      .all()
    return rows[0] ?? null
  } catch {
    return null
  }
}
