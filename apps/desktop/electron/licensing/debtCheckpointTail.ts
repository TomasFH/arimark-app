/**
 * Actualiza el doc de cola (tail) de un par entidad+local.
 * El job de checkpoint arma el worklist desde esta colección, no desde
 * todos los proveedores/clientes.
 */
import {
  getFirestore,
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore'
import {
  DEBT_CHECKPOINT_TAILS_COL,
  debtCheckpointDocId,
  type DebtCheckpointKind,
} from '@carniceria/shared'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import log from 'electron-log'

export async function touchDebtCheckpointTail(input: {
  tenantId: string
  kind: DebtCheckpointKind
  entityId: string
  storeId: string
  firestore?: Firestore
}): Promise<void> {
  if (!isFirebaseAvailable() && !input.firestore) return
  if (!input.entityId || !input.storeId) return

  try {
    const firestore = input.firestore ?? getFirestore(getFirebaseApp())
    const ref = doc(
      firestore,
      'licenses',
      input.tenantId,
      DEBT_CHECKPOINT_TAILS_COL,
      debtCheckpointDocId(input.entityId, input.storeId),
    )
    await runTransaction(firestore, async tx => {
      const snap = await tx.get(ref)
      const payload: Record<string, unknown> = {
        kind: input.kind,
        entityId: input.entityId,
        storeId: input.storeId,
        lastEventAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      if (!snap.exists() || snap.data()?.['firstEventAt'] == null) {
        payload['firstEventAt'] = serverTimestamp()
      }
      tx.set(ref, payload, { merge: true })
    })
  } catch (err) {
    log.warn('[debtCheckpoint] No se pudo actualizar tail', {
      kind: input.kind,
      entityId: input.entityId,
      storeId: input.storeId,
      err,
    })
  }
}
