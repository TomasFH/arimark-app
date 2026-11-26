import { formatMerchVisitQty, isDelanteroLine, isMediaResLine, type MerchIntakeLineSnapshot } from '@carniceria/shared'

export interface HistoryVisitLineView {
  name: string
  quantityLabel: string
  unitPrice: number
  subtotal: number
}

/** Precio de la media res en cero cuando quien mira es la cajera. */
export function historyVisitLinesFromSnapshots(
  lines: MerchIntakeLineSnapshot[],
  hideMediaResPrice: boolean,
): HistoryVisitLineView[] {
  return [...lines]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap(line => {
      const name = line.rubroName.trim()
      if (!name) return []
      const hide = hideMediaResPrice && isMediaResLine(line)
      return [{
        name,
        quantityLabel: formatMerchVisitQty(line),
        unitPrice: hide || !(line.unitCost > 0) ? 0 : Math.round(line.unitCost),
        subtotal: hide || !(line.costTotal > 0) ? 0 : Math.round(line.costTotal),
      }]
    })
}

export interface HistoryUnpaidArrival {
  intakeId: string
  createdAt: string
  providerName: string | null
  lines: Array<{ name: string; quantityLabel: string }>
}

/** Media res y delantero que entraron sin plata. No es un gasto. */
export function unpaidArrivalFromIntake(input: {
  intakeId: string
  createdAt: string
  providerName: string | null
  paymentKind: string | null
  status?: string | null
  lines: MerchIntakeLineSnapshot[]
}): HistoryUnpaidArrival | null {
  if (input.status === 'draft' || input.paymentKind !== 'none') return null
  const pieces = input.lines.filter(line => isMediaResLine(line) || isDelanteroLine(line))
  const lines = historyVisitLinesFromSnapshots(pieces, true)
    .map(line => ({ name: line.name, quantityLabel: line.quantityLabel }))
  if (lines.length === 0) return null
  return {
    intakeId: input.intakeId,
    createdAt: input.createdAt,
    providerName: input.providerName?.trim() || null,
    lines,
  }
}
