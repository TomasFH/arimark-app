/**
 * Utilidades de formato genéricas (no fecha/hora — esas van en datetime.ts).
 */

export function capitalize(str: string): string {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return `${str.slice(0, maxLength - 3)}...`
}
