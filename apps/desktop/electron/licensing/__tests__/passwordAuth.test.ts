import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../firebase', () => ({
  getFirebaseApp: vi.fn(() => ({ name: 'test-app' })),
  isFirebaseAvailable: vi.fn(),
}))

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  updatePassword: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  EmailAuthProvider: {
    credential: vi.fn((email: string, password: string) => ({ email, password })),
  },
}))

import { getAuth, sendPasswordResetEmail, updatePassword, reauthenticateWithCredential } from 'firebase/auth'
import { isFirebaseAvailable } from '../firebase'
import { sendPasswordReset, changeOwnPassword } from '../passwordAuth'

function authError(code: string): Error {
  const err = new Error(code)
  ;(err as Error & { code: string }).code = code
  return err
}

describe('passwordAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('sendPasswordReset', () => {
    it('en modo pruebas no llama a Firebase y retorna ok', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      const result = await sendPasswordReset('a@negocio.com')
      expect(result).toEqual({ ok: true })
      expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    })

    it('envía el mail al email indicado', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(getAuth).mockReturnValue({ currentUser: null } as never)
      vi.mocked(sendPasswordResetEmail).mockResolvedValue(undefined)

      const result = await sendPasswordReset('cajera@negocio.com')
      expect(result).toEqual({ ok: true })
      expect(sendPasswordResetEmail).toHaveBeenCalledWith(expect.anything(), 'cajera@negocio.com')
    })

    it('sin email usa el de la sesión actual', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(getAuth).mockReturnValue({
        currentUser: { email: 'sesion@negocio.com' },
      } as never)
      vi.mocked(sendPasswordResetEmail).mockResolvedValue(undefined)

      const result = await sendPasswordReset()
      expect(result).toEqual({ ok: true })
      expect(sendPasswordResetEmail).toHaveBeenCalledWith(expect.anything(), 'sesion@negocio.com')
    })

    it('sin email ni sesión retorna error', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(getAuth).mockReturnValue({ currentUser: null } as never)

      const result = await sendPasswordReset()
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('NO_SESSION')
    })

    it('user-not-found en reset no filtra si el email existe', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(getAuth).mockReturnValue({ currentUser: null } as never)
      vi.mocked(sendPasswordResetEmail).mockRejectedValue(authError('auth/user-not-found'))

      const result = await sendPasswordReset('nadie@negocio.com')
      expect(result).toEqual({ ok: true })
    })

    it('error de red se traduce a mensaje de conexión', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(getAuth).mockReturnValue({ currentUser: null } as never)
      vi.mocked(sendPasswordResetEmail).mockRejectedValue(authError('auth/network-request-failed'))

      const result = await sendPasswordReset('a@negocio.com')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('NETWORK')
        expect(result.error).toMatch(/conexión/i)
      }
    })
  })

  describe('changeOwnPassword', () => {
    const user = { email: 'cajera@negocio.com', uid: 'uid-1' }

    it('en modo pruebas no llama a Firebase y retorna ok', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      const result = await changeOwnPassword('vieja123', 'nueva123')
      expect(result).toEqual({ ok: true })
      expect(updatePassword).not.toHaveBeenCalled()
    })

    it('rechaza si la nueva es igual a la actual', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      const result = await changeOwnPassword('misma123', 'misma123')
      expect(result.ok).toBe(false)
      expect(updatePassword).not.toHaveBeenCalled()
    })

    it('reautentica y actualiza', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(getAuth).mockReturnValue({ currentUser: user } as never)
      vi.mocked(reauthenticateWithCredential).mockResolvedValue({} as never)
      vi.mocked(updatePassword).mockResolvedValue(undefined)

      const result = await changeOwnPassword('vieja123', 'nueva456')
      expect(result).toEqual({ ok: true })
      expect(reauthenticateWithCredential).toHaveBeenCalled()
      expect(updatePassword).toHaveBeenCalledWith(user, 'nueva456')
    })

    it('sin sesión retorna NO_SESSION', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(getAuth).mockReturnValue({ currentUser: null } as never)

      const result = await changeOwnPassword('vieja123', 'nueva456')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('NO_SESSION')
    })

    it('contraseña actual incorrecta', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(getAuth).mockReturnValue({ currentUser: user } as never)
      vi.mocked(reauthenticateWithCredential).mockRejectedValue(authError('auth/invalid-credential'))

      const result = await changeOwnPassword('mal1234', 'nueva456')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('WRONG_PASSWORD')
      expect(updatePassword).not.toHaveBeenCalled()
    })

    it('requires-recent-login se expone para el flujo de mail', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(getAuth).mockReturnValue({ currentUser: user } as never)
      vi.mocked(reauthenticateWithCredential).mockRejectedValue(authError('auth/requires-recent-login'))

      const result = await changeOwnPassword('vieja123', 'nueva456')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('REQUIRES_REAUTH')
    })

    it('updatePassword débil se traduce a WEAK_PASSWORD', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(getAuth).mockReturnValue({ currentUser: user } as never)
      vi.mocked(reauthenticateWithCredential).mockResolvedValue({} as never)
      vi.mocked(updatePassword).mockRejectedValue(authError('auth/weak-password'))

      const result = await changeOwnPassword('vieja123', 'nueva456')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('WEAK_PASSWORD')
    })
  })
})
