import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Modal } from '../ui/Modal'

function Harness({ open }: { open: boolean }) {
  return (
    <>
      <button type="button">Pedido</button>
      <input aria-label="Buscar" />
      <textarea aria-label="Nota" />
      <Modal open={open} onClose={() => {}} title="Vales">
        <p>Listo</p>
      </Modal>
    </>
  )
}

describe('Modal — foco al cerrar', () => {
  it('no devuelve el foco al botón que estaba activo', () => {
    const { rerender } = render(<Harness open={false} />)
    const button = screen.getByRole('button', { name: 'Pedido' })
    button.focus()
    expect(button).toHaveFocus()

    rerender(<Harness open />)
    expect(screen.getByRole('dialog')).toHaveFocus()

    rerender(<Harness open={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(button).not.toHaveFocus()
  })

  it('devuelve el foco al input que estaba activo', () => {
    const { rerender } = render(<Harness open={false} />)
    const input = screen.getByLabelText('Buscar')
    input.focus()

    rerender(<Harness open />)
    expect(screen.getByRole('dialog')).toHaveFocus()

    rerender(<Harness open={false} />)
    expect(input).toHaveFocus()
  })

  it('devuelve el foco al textarea que estaba activo', () => {
    const { rerender } = render(<Harness open={false} />)
    const textarea = screen.getByLabelText('Nota')
    textarea.focus()

    rerender(<Harness open />)
    expect(screen.getByRole('dialog')).toHaveFocus()

    rerender(<Harness open={false} />)
    expect(textarea).toHaveFocus()
  })
})
