import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ActionMenu } from '../ui/ActionMenu'

describe('ActionMenu — foco al cerrar', () => {
  it('Escape suelta el foco del botón en vez de devolverlo', () => {
    render(
      <ActionMenu
        items={[{ id: 'edit', label: 'Editar', onSelect: vi.fn() }]}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Más acciones' })
    fireEvent.click(trigger)
    trigger.focus()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).not.toHaveFocus()
  })
})
