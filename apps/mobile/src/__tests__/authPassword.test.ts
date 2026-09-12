import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
} from 'firebase/auth'
import { sendPasswordReset, changePassword } from '../lib/auth'
import { auth } from '../firebase'
import { newPasswordIssue } from '../lib/passwordRules'

function authError(code: string): Error {
  const err = new Error(code)
  ;(err as Error & { code: string }).code = code
  return err
}

describe('passwordRules', () => {
  it('rechaza clave corta y distinta', () => {
    expect(newPasswordIssue('12345', '12345')).toMatch(/al menos 6/)
    expect(newPasswordIssue('abcdef', 'xxxxxx')).toMatch(/no coinciden/)
    expect(newPasswordIssue('abcdef', 'abcdef', 'abcdef')).toMatch(/distinta/)
    expect(newPasswordIssue('abcdef', 'abcdef', 'vieja12')).toBeNull()
  })
})

describe('sendPasswordReset / changePassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(auth as { currentUser: unknown }).currentUser = null
  })

  it('sendPasswordReset usa el email indicado', async () => {
    vi.mocked(sendPasswordResetEmail).mockResolvedValue(undefined)
    const result = await sendPasswordReset('cajera@negocio.com')
    expect(result).toEqual({ ok: true })
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(auth, 'cajera@negocio.com')
  })

  it('sendPasswordReset sin email usa la sesión', async () => {
    ;(auth as { currentUser: unknown }).currentUser = { email: 'sesion@negocio.com' }
    vi.mocked(sendPasswordResetEmail).mockResolvedValue(undefined)
    const result = await sendPasswordReset()
    expect(result).toEqual({ ok: true })
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(auth, 'sesion@negocio.com')
  })

  it('sendPasswordReset user-not-found no filtra la existencia', async () => {
    vi.mocked(sendPasswordResetEmail).mockRejectedValue(authError('auth/user-not-found'))
    const result = await sendPasswordReset('nadie@negocio.com')
    expect(result).toEqual({ ok: true })
  })

  it('changePassword reautentica y actualiza', async () => {
    const user = { email: 'cajera@negocio.com', uid: 'uid-1' }
    ;(auth as { currentUser: unknown }).currentUser = user
    vi.mocked(reauthenticateWithCredential).mockResolvedValue({} as never)
    vi.mocked(updatePassword).mockResolvedValue(undefined)

    const result = await changePassword('vieja123', 'nueva456')
    expect(result).toEqual({ ok: true })
    expect(updatePassword).toHaveBeenCalledWith(user, 'nueva456')
  })

  it('changePassword con clave actual incorrecta', async () => {
    ;(auth as { currentUser: unknown }).currentUser = { email: 'cajera@negocio.com' }
    vi.mocked(reauthenticateWithCredential).mockRejectedValue(authError('auth/invalid-credential'))

    const result = await changePassword('mal1234', 'nueva456')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('WRONG_PASSWORD')
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('changePassword requires-recent-login se expone para el mail', async () => {
    ;(auth as { currentUser: unknown }).currentUser = { email: 'cajera@negocio.com' }
    vi.mocked(reauthenticateWithCredential).mockRejectedValue(authError('auth/requires-recent-login'))

    const result = await changePassword('vieja123', 'nueva456')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('REQUIRES_REAUTH')
  })
})
