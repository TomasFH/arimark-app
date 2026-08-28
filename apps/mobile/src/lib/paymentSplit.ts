import { parseNumericInput } from './numericInput'

/** Cuánto falta asignar a `field` para cubrir `total`, ignorando lo ya puesto en ese campo. */
export function remainderForField(
  total: number,
  amounts: Record<string, string>,
  field: string,
): number {
  const others = Object.entries(amounts)
    .filter(([key]) => key !== field)
    .reduce((sum, [, value]) => sum + (parseNumericInput(value) ?? 0), 0)
  return Math.max(0, Math.round(total - others))
}

export function paidTotal(amounts: Record<string, string>): number {
  return Object.values(amounts).reduce((sum, value) => sum + (parseNumericInput(value) ?? 0), 0)
}
