/**
 * Reanudar turno abierto en este celular (misma cuenta).
 * Si hay más de uno (raro), gana el más reciente.
 */
export function pickOpenShiftForUser<T extends {
  closedAt: string | null
  userId: string
  startedAt: string
}>(shifts: T[], userId: string): T | null {
  const open = shifts
    .filter(s => s.closedAt === null && s.userId === userId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return open[0] ?? null
}
