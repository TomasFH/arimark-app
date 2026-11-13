import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShiftCloseCorrection from '../ShiftCloseCorrection'

describe('ShiftCloseCorrection', () => {
  it('no muestra los campos hasta elegir corregir en el menú', async () => {
    const user = userEvent.setup()
    render(<ShiftCloseCorrection cashLeft={1500} withdrawn={null} onSubmit={vi.fn()} />)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('sin anotar')).toBeInTheDocument()
    expect(screen.getByText('Quedó en la caja')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Acciones del cierre' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Corregir cierre' }))

    expect(screen.getByRole('textbox', { name: /quedó en la caja/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /se retiró/i })).toBeInTheDocument()
  })
})
