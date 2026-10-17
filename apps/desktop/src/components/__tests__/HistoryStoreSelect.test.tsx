import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HistoryStoreSelect from '../HistoryStoreSelect'
import type { StoreRow } from '../../types/hw-api'

function store(id: string, name: string): StoreRow {
  return { id, name }
}

const stores = [
  store('s1', 'San Martín'),
  store('s2', 'Centro'),
  store('s3', 'San Martín Norte'),
]

describe('HistoryStoreSelect', () => {
  it('busca entre muchos locales y elige uno', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<HistoryStoreSelect stores={stores} value="all" onChange={onChange} />)

    expect(screen.getByRole('button', { name: /Todos los locales/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Centro' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Todos los locales/ }))
    await user.type(screen.getByRole('textbox', { name: 'Buscar local' }), 'norte')

    expect(screen.queryByRole('option', { name: 'Centro' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'San Martín Norte' }))

    expect(onChange).toHaveBeenCalledWith('s3')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
