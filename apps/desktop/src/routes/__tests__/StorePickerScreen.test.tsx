import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StorePickerScreen from '../StorePickerScreen'
import type { StoreRow } from '../../types/hw-api'

const STORES: StoreRow[] = [
  { id: 's1', name: 'Local Centro', address: 'Calle 1' },
  { id: 's2', name: 'Local Norte', address: 'Calle 2' },
]

describe('StorePickerScreen', () => {
  it('sin último local lista todos y entra al toque', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn().mockResolvedValue(undefined)
    render(
      <StorePickerScreen
        stores={STORES}
        onSelect={onSelect}
        onLogout={() => {}}
      />,
    )

    expect(screen.getByRole('heading', { name: '¿En qué local trabajás hoy?' })).toBeInTheDocument()
    expect(screen.queryByText('Último local')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Local Centro/ }))
    expect(onSelect).toHaveBeenCalledWith('s1')
    expect(screen.queryByText('¿Confirmás este local?')).not.toBeInTheDocument()
  })

  it('resalta el último local y entra sin modal extra', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn().mockResolvedValue(undefined)
    render(
      <StorePickerScreen
        stores={STORES}
        preferredStoreId="s1"
        onSelect={onSelect}
        onLogout={() => {}}
      />,
    )

    expect(screen.getByText('Último local')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Local Centro/ }))
    expect(onSelect).toHaveBeenCalledWith('s1')
    expect(screen.queryByText('¿Confirmás este local?')).not.toBeInTheDocument()
  })

  it('pedir el que no está resaltado exige doble confirmación', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn().mockResolvedValue(undefined)
    render(
      <StorePickerScreen
        stores={STORES}
        preferredStoreId="s1"
        onSelect={onSelect}
        onLogout={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Local Norte/ }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByText('¿Confirmás este local?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByText('¿Confirmás este local?')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Local Norte/ }))
    await user.click(screen.getByRole('button', { name: 'Sí, continuar' }))
    expect(onSelect).toHaveBeenCalledWith('s2')
  })
})
