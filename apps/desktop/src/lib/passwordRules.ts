/** Mínimo de Firebase Auth (regla por defecto del proyecto). */
export const MIN_AUTH_PASSWORD_LENGTH = 6
export const MAX_AUTH_PASSWORD_LENGTH = 128

export function newPasswordIssue(
  newPassword: string,
  confirmPassword: string,
  currentPassword?: string,
): string | null {
  if (newPassword.length < MIN_AUTH_PASSWORD_LENGTH) {
    return `La nueva contraseña debe tener al menos ${MIN_AUTH_PASSWORD_LENGTH} caracteres.`
  }
  if (newPassword.length > MAX_AUTH_PASSWORD_LENGTH) {
    return 'La nueva contraseña es demasiado larga.'
  }
  if (newPassword !== confirmPassword) {
    return 'Las contraseñas no coinciden.'
  }
  if (currentPassword !== undefined && newPassword === currentPassword) {
    return 'La nueva contraseña tiene que ser distinta a la actual.'
  }
  return null
}
