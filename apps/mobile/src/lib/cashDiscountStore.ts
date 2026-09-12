/**
 * Regla de descuento efectivo del local (1 getDoc / 1 updateDoc del store).
 * No baja colecciones diarias.
 */
import { doc, getDoc, getFirestore, updateDoc } from 'firebase/firestore'
import { v4 as uuidv4 } from 'uuid'
import { normalizeCashDiscountRule, parseCashDiscountSchedule, serializeCashDiscountSchedule, type CashDiscountBlock, type CashDiscountRule } from '@carniceria/shared'
import { firebaseApp, LICENSE_KEY } from '../firebase'

const AUDIT_LIMIT = 20

export interface CashDiscountAuditRemote {
  id: string
  createdAt: string
  actorUserId: string
  actorName: string
  previousMinAmount: number
  previousPercent: number
  nextMinAmount: number
  nextPercent: number
}

export interface StoreCashDiscount {
  rule: CashDiscountRule
  schedule: CashDiscountBlock[]
  audits: CashDiscountAuditRemote[]
}

const firestore = getFirestore(firebaseApp)

function storeRef(storeId: string) {
  return doc(firestore, 'licenses', LICENSE_KEY, 'stores', storeId)
}

function parseAudits(raw: unknown): CashDiscountAuditRemote[] {
  if (!Array.isArray(raw)) return []
  const out: CashDiscountAuditRemote[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    out.push({
      id: typeof rec.id === 'string' ? rec.id : uuidv4(),
      createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : new Date().toISOString(),
      actorUserId: typeof rec.actorUserId === 'string' ? rec.actorUserId : '',
      actorName: typeof rec.actorName === 'string' ? rec.actorName : '',
      previousMinAmount: Number(rec.previousMinAmount) || 0,
      previousPercent: Number(rec.previousPercent) || 0,
      nextMinAmount: Number(rec.nextMinAmount) || 0,
      nextPercent: Number(rec.nextPercent) || 0,
    })
  }
  return out.slice(0, AUDIT_LIMIT)
}

export async function fetchStoreCashDiscount(storeId: string): Promise<StoreCashDiscount> {
  const snap = await getDoc(storeRef(storeId))
  const data = snap.exists() ? snap.data() : {}
  return {
    rule: normalizeCashDiscountRule(data['cashDiscountMinAmount'], data['cashDiscountPercent']),
    schedule: parseCashDiscountSchedule(data['cashDiscountSchedule']),
    audits: parseAudits(data['cashDiscountAudits']),
  }
}

export async function saveStoreCashDiscount(input: {
  storeId: string
  minAmount: number
  percent: number
  schedule: CashDiscountBlock[]
  actorUserId: string
  actorName: string
}): Promise<StoreCashDiscount> {
  const current = await fetchStoreCashDiscount(input.storeId)
  const next = normalizeCashDiscountRule(input.minAmount, input.percent)
  const previous = current.rule
  const nextSchedule = serializeCashDiscountSchedule(input.schedule)
  const previousSchedule = serializeCashDiscountSchedule(current.schedule)
  let audits = current.audits
  if (
    previous.minAmount !== next.minAmount
    || previous.percent !== next.percent
    || previousSchedule !== nextSchedule
  ) {
    audits = [
      {
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        actorUserId: input.actorUserId,
        actorName: input.actorName,
        previousMinAmount: previous.minAmount,
        previousPercent: previous.percent,
        nextMinAmount: next.minAmount,
        nextPercent: next.percent,
      },
      ...audits,
    ].slice(0, AUDIT_LIMIT)
  }
  await updateDoc(storeRef(input.storeId), {
    cashDiscountMinAmount: next.minAmount,
    cashDiscountPercent: next.percent,
    cashDiscountSchedule: parseCashDiscountSchedule(nextSchedule),
    cashDiscountAudits: audits,
  })
  return { rule: next, schedule: parseCashDiscountSchedule(nextSchedule), audits }
}
