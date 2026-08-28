/**
 * Preview de compensación entre locales (sin escribir en DB).
 * Mismo criterio que el handler IPC: crédito de un local cancela deuda de otro.
 */

export type CompensationDelta = { storeId: string; type: 'debt' | 'payment'; amount: number }

export function planProviderStoreCompensation(
  byStore: Record<string, number>,
): CompensationDelta[] {
  const credits = Object.entries(byStore)
    .filter(([, bal]) => bal < 0)
    .map(([storeId, bal]) => ({ storeId, remaining: -bal }))
  const debts = Object.entries(byStore)
    .filter(([, bal]) => bal > 0)
    .map(([storeId, bal]) => ({ storeId, remaining: bal }))

  const out: CompensationDelta[] = []
  let i = 0
  let j = 0
  while (i < credits.length && j < debts.length) {
    const take = Math.min(credits[i].remaining, debts[j].remaining)
    if (take > 0) {
      out.push({ storeId: credits[i].storeId, type: 'debt', amount: take })
      out.push({ storeId: debts[j].storeId, type: 'payment', amount: take })
      credits[i].remaining -= take
      debts[j].remaining -= take
    }
    if (credits[i].remaining === 0) i++
    if (debts[j].remaining === 0) j++
  }
  return out
}

/** Saldos resultantes si se aplicara la compensación ahora. */
export function previewCompensatedBalances(
  byStore: Record<string, number>,
): Record<string, number> {
  const next = { ...byStore }
  for (const d of planProviderStoreCompensation(byStore)) {
    next[d.storeId] = (next[d.storeId] ?? 0) + (d.type === 'debt' ? d.amount : -d.amount)
  }
  return next
}
