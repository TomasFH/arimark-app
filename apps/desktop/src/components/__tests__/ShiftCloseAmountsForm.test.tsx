import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShiftCloseAmountsForm from '../ShiftCloseAmountsForm'

describe('ShiftCloseAmountsForm', () => {
  it('no manda un campo vacío y manda el cero tipeado', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ShiftCloseAmountsForm mode="close" submitLabel="Cerrar turno" onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: 'Cerrar turno' }))
    expect(onSubmit).toHaveBeenCalledWith({})

    await user.type(screen.getByRole('textbox', { name: /quedó en la caja/i }), '0')
    await user.click(screen.getByRole('button', { name: 'Cerrar turno' }))
    expect(onSubmit).toHaveBeenLastCalledWith({ cashLeft: 0 })
  })

  it('precarga los montos y deja borrarlos o cambiarlos', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ShiftCloseAmountsForm
        mode="correct"
        submitLabel="Corregir"
        initialCashLeft={1200}
        initialWithdrawn={300}
        onSubmit={onSubmit}
      />,
    )

    const left = screen.getByRole('textbox', { name: /quedó en la caja/i })
    const withdrawn = screen.getByRole('textbox', { name: /se retiró/i })
    expect(left).toHaveValue('1.200')
    expect(withdrawn).toHaveValue('300')

    await user.clear(left)
    await user.clear(withdrawn)
    await user.type(withdrawn, '0')
    await user.click(screen.getByRole('button', { name: 'Corregir' }))

    expect(onSubmit).toHaveBeenCalledWith({ withdrawn: 0 })
  })
})
