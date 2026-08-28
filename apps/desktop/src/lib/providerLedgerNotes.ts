/** Prefijo de los movimientos de emergencia que deja un admin. */
export const ADMIN_ADJUST_NOTE_PREFIX = 'Ajuste de admin'

export function isAdminAdjustNote(notes: string | null | undefined): boolean {
  return typeof notes === 'string' && notes.startsWith(ADMIN_ADJUST_NOTE_PREFIX)
}

function authorSuffix(adminName?: string): string {
  const name = adminName?.trim()
  return name ? ` (${name})` : ''
}

/** Texto que queda en el historial (PC y celu) cuando un admin fija el saldo. */
export function formatAdminAdjustNote(targetBalance: number, adminName?: string): string {
  const rounded = Math.round(targetBalance)
  const abs = Math.abs(rounded).toLocaleString('es-AR')
  const who = authorSuffix(adminName)
  if (rounded > 0) return `${ADMIN_ADJUST_NOTE_PREFIX}${who}: dejó la deuda en $ ${abs}`
  if (rounded < 0) return `${ADMIN_ADJUST_NOTE_PREFIX}${who}: dejó saldo a favor $ ${abs}`
  return `${ADMIN_ADJUST_NOTE_PREFIX}${who}: dejó el saldo en $ 0`
}

/** Inserta el nombre del admin si la nota es un ajuste y todavía no lo tiene. */
export function stampAdminAdjustAuthor(notes: string | null | undefined, adminName: string): string | null {
  if (!notes) return notes ?? null
  if (!isAdminAdjustNote(notes)) return notes
  const name = adminName.trim()
  if (!name) return notes
  if (notes.startsWith(`${ADMIN_ADJUST_NOTE_PREFIX} (`)) return notes
  return notes.replace(ADMIN_ADJUST_NOTE_PREFIX, `${ADMIN_ADJUST_NOTE_PREFIX} (${name})`)
}
