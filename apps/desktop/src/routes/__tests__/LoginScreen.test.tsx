import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginScreen from '../LoginScreen'

describe('LoginScreen — olvidé contraseña', () => {
  beforeEach(() => {
    window.hw = {
      sendPasswordReset: vi.fn(),
    } as unknown as typeof window.hw
  })

  it('pasa a pedir el email sin mostrar error si está vacío', async () => {
    const user = userEvent.setup()
    render(<LoginScreen onLogin={vi.fn()} businessName="Nombre del negocio" />)

    await user.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }))
    expect(screen.queryByText('Ingresá tu email para enviarte el mail.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restablecer contraseña' })).toBeInTheDocument()
    expect(window.hw.sendPasswordReset).not.toHaveBeenCalled()
  })

  it('muestra el error si restablece sin email', async () => {
    const user = userEvent.setup()
    render(<LoginScreen onLogin={vi.fn()} businessName="Nombre del negocio" />)

    await user.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }))
    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))
    expect(screen.getByText('Ingresá tu email para enviarte el mail.')).toBeInTheDocument()
    expect(window.hw.sendPasswordReset).not.toHaveBeenCalled()
  })

  it('llama sendPasswordReset al restablecer con email', async () => {
    const user = userEvent.setup()
    vi.mocked(window.hw.sendPasswordReset).mockResolvedValue({ ok: true, data: undefined })
    render(<LoginScreen onLogin={vi.fn()} businessName="Nombre del negocio" />)

    await user.type(screen.getByLabelText('Email'), 'cajera@negocio.com')
    await user.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }))
    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

    expect(window.hw.sendPasswordReset).toHaveBeenCalledWith({ email: 'cajera@negocio.com' })
    expect(await screen.findByText(/Si hay una cuenta|Modo pruebas/)).toBeInTheDocument()
  })
})
