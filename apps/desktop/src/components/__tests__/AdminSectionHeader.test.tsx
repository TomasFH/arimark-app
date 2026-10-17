import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminSectionHeader } from '../AdminSectionHeader'

describe('AdminSectionHeader', () => {
  it('deja Volver a la izquierda y abre el engranaje de la cuenta', async () => {
    const user = userEvent.setup()
    window.hw = {
      getUiSettings: vi.fn().mockResolvedValue({ ok: true, data: { zoomFactor: 1, colorScheme: 'dark' } }),
      onUiSettingsChanged: vi.fn(() => () => {}),
    } as unknown as typeof window.hw

    render(
      <AdminSectionHeader
        title="Historial de turnos"
        subtitle="Lo vendido, cómo se cobró y el cierre de cada turno"
        onBack={() => {}}
        onLogout={() => {}}
      />,
    )

    const back = screen.getByRole('button', { name: 'Volver' })
    const gear = screen.getByRole('button', { name: 'Configuración' })
    expect(back.compareDocumentPosition(gear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(gear)
    expect(await screen.findByRole('dialog', { name: 'Configuración' })).toBeInTheDocument()
    expect(screen.getByText('Tamaño de pantalla')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Claro' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Oscuro' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Ajustes' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actualizar datos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cambiar contraseña' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument()
  })
})
