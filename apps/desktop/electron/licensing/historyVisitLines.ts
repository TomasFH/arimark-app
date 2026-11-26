import { formatMerchVisitQty, isMediaResLine, type MerchIntakeLineSnapshot } from '@carniceria/shared'

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
