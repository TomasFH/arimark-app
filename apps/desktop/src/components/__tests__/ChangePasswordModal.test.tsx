import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChangePasswordModal from '../ChangePasswordModal'

describe('ChangePasswordModal', () => {
  beforeEach(() => {
    window.hw = {
      changePassword: vi.fn(),
      sendPasswordReset: vi.fn(),
    } as unknown as typeof window.hw
  })

  it('rechaza si las nuevas no coinciden, sin llamar IPC', async () => {
    const user = userEvent.setup()
    render(<ChangePasswordModal onClose={() => {}} />)

    await user.type(screen.getByLabelText('Contraseña actual'), 'vieja123')
    await user.type(screen.getByLabelText('Nueva contraseña'), 'nueva123')
    await user.type(screen.getByLabelText('Repetir nueva'), 'otra1234')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByText('Las contraseñas no coinciden.')).toBeInTheDocument()
    expect(window.hw.changePassword).not.toHaveBeenCalled()
  })

  it('guarda cuando el IPC responde ok', async () => {
    const user = userEvent.setup()
    vi.mocked(window.hw.changePassword).mockResolvedValue({ ok: true, data: undefined })
    render(<ChangePasswordModal onClose={() => {}} />)

    await user.type(screen.getByLabelText('Contraseña actual'), 'vieja123')
    await user.type(screen.getByLabelText('Nueva contraseña'), 'nueva123')
    await user.type(screen.getByLabelText('Repetir nueva'), 'nueva123')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(window.hw.changePassword).toHaveBeenCalledWith({
      currentPassword: 'vieja123',
      newPassword: 'nueva123',
    })
    expect(await screen.findByText(/Contraseña actualizada|Modo pruebas/)).toBeInTheDocument()
  })

  it('si Firebase pide reauth ofrece enviar mail', async () => {
    const user = userEvent.setup()
    vi.mocked(window.hw.changePassword).mockResolvedValue({
      ok: false,
      error: 'Por seguridad hay que confirmar la contraseña actual o restablecerla por mail.',
      code: 'REQUIRES_REAUTH',
    })
    vi.mocked(window.hw.sendPasswordReset).mockResolvedValue({ ok: true, data: undefined })
    render(<ChangePasswordModal onClose={() => {}} />)

    await user.type(screen.getByLabelText('Contraseña actual'), 'vieja123')
    await user.type(screen.getByLabelText('Nueva contraseña'), 'nueva123')
    await user.type(screen.getByLabelText('Repetir nueva'), 'nueva123')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    const mailBtn = await screen.findByRole('button', { name: 'Enviar mail para restablecer' })
    await user.click(mailBtn)
    expect(window.hw.sendPasswordReset).toHaveBeenCalledWith({})
  })
})
