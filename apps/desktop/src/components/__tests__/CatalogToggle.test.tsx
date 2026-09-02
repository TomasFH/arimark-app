import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CatalogToggle from '../CatalogToggle'

describe('CatalogToggle', () => {
  it('no dispara onChange si está deshabilitado', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<CatalogToggle checked={true} disabled onChange={onChange} />)

    await user.click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('dispara onChange cuando está habilitado', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<CatalogToggle checked={false} onChange={onChange} />)

    await user.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
