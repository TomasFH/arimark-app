import {
  getFirestore,
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import {
  DEBT_CHECKPOINT_TAILS_COL,
  debtCheckpointDocId,
  type DebtCheckpointKind,
} from '@carniceria/shared'

const firestore = getFirestore(firebaseApp)

export function debtEventServerTimestampFields(): { createdAtServer: ReturnType<typeof serverTimestamp> } {
  return { createdAtServer: serverTimestamp() }
}

export async function touchDebtCheckpointTail(input: {
  kind: DebtCheckpointKind
  entityId: string
  storeId: string
}): Promise<void> {
  if (!input.entityId || !input.storeId) return
  const ref = doc(
    firestore,
    'licenses',
    LICENSE_KEY,
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
}
