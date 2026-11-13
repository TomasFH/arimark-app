/**
 * Cierre y corrección de un turno que ya está en Firestore.
 * No crea el documento y no toca ventas. Un monto omitido no se escribe.
 */
import { deleteField, doc, getFirestore, updateDoc } from 'firebase/firestore'
import { closingCashFromParts } from '@carniceria/shared'
import { firebaseApp, LICENSE_KEY } from '../firebase'

export interface CloseShiftFieldsInput {
  cashLeft?: number
  withdrawn?: number
  closedByUserId: string
  closedByName: string
  now: string
}

export interface ShiftAmountFields {
  closedAt?: string
  closedByUserId?: string
  closedByName?: string
  cashLeft?: number
  deliveredAmount?: number
  /** Null = borrar el total. Solo existe si los dos montos están escritos. */
  closingCash: number | null
}

export function closeShiftFields(input: CloseShiftFieldsInput): ShiftAmountFields {
  const fields: ShiftAmountFields = {
    closedAt: input.now,
    closedByUserId: input.closedByUserId,
    closedByName: input.closedByName,
    closingCash: closingCashFromParts(input.cashLeft, input.withdrawn),
  }
  if (input.cashLeft !== undefined) fields.cashLeft = input.cashLeft
  if (input.withdrawn !== undefined) fields.deliveredAmount = input.withdrawn
  return fields
}

export function correctShiftFields(input: {
  cashLeft?: number
  withdrawn?: number
  currentCashLeft: number | null
  currentWithdrawn: number | null
}): ShiftAmountFields {
  const cashLeft = input.cashLeft !== undefined ? input.cashLeft : input.currentCashLeft
  const withdrawn = input.withdrawn !== undefined ? input.withdrawn : input.currentWithdrawn
  const fields: ShiftAmountFields = {
    closingCash: closingCashFromParts(cashLeft, withdrawn),
  }
  if (input.cashLeft !== undefined) fields.cashLeft = input.cashLeft
  if (input.withdrawn !== undefined) fields.deliveredAmount = input.withdrawn
  return fields
}

function shiftRef(shiftId: string) {
  return doc(getFirestore(firebaseApp), 'licenses', LICENSE_KEY, 'shifts', shiftId)
}

function toFirestore(fields: ShiftAmountFields): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...fields }
  payload['closingCash'] = fields.closingCash == null ? deleteField() : fields.closingCash
  return payload
}

export async function closeRemoteShift(
  shiftId: string,
  input: Omit<CloseShiftFieldsInput, 'now'>,
): Promise<ShiftAmountFields> {
  const fields = closeShiftFields({ ...input, now: new Date().toISOString() })
  await updateDoc(shiftRef(shiftId), toFirestore(fields))
  return fields
}

export async function correctRemoteShiftClose(
  shiftId: string,
  input: {
    cashLeft?: number
    withdrawn?: number
    currentCashLeft: number | null
    currentWithdrawn: number | null
  },
): Promise<ShiftAmountFields> {
  const fields = correctShiftFields(input)
  await updateDoc(shiftRef(shiftId), toFirestore(fields))
  return fields
}
