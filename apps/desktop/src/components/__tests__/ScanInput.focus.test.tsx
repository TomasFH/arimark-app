import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ScanInput from '../ScanInput'
import type { ProductRow, SaleItemDraft } from '../../types/hw-api'

const sinPrecio: ProductRow = {
  id: 'p-sin',
  pluNumber: 7,
  name: 'Corte',
  category: 'beef_cut',
  unit: 'kg',
  price: null,
}

const conPrecio: ProductRow = {
  id: 'p-con',
  pluNumber: 5,
  name: 'Vacío',
  category: 'beef_cut',
  unit: 'kg',
  price: 21000,
}

async function typeWeight(user: ReturnType<typeof userEvent.setup>, plu: string, weight: string, special: boolean) {
  await new Promise(resolve => setTimeout(resolve, 60))
  const pluInput = screen.getByLabelText('PLU o nombre')
  await user.click(pluInput)
  await user.type(pluInput, plu)
  if (special) {
    await user.click(screen.getByRole('checkbox', { name: /Precio especial/ }))
  }
  const weightInput = screen.getByLabelText('Peso (kg)')
  await user.click(weightInput)
  await user.type(weightInput, weight)
  return weightInput
}

describe('ScanInput — foco del peso', () => {
  it('con precio especial y coma decimal el foco sigue en Peso', async () => {
    const user = userEvent.setup()
    render(<ScanInput products={[conPrecio]} onAddItem={() => {}} />)
    const weightInput = await typeWeight(user, '5', '0,45', true)
    expect(weightInput).toHaveFocus()
    expect(screen.getByRole('checkbox', { name: /Precio especial/ })).toBeChecked()
    const kilo = screen.getByLabelText(/Precio por kilo/)
    expect(kilo).not.toHaveFocus()
    expect(kilo).toHaveValue('21.000')
    expect(screen.queryByLabelText(/Precio total/)).not.toBeInTheDocument()
    expect(weightInput).toHaveValue('0,45')
  })

  it('sin precio de lista no salta al precio al escribir el peso', async () => {
    const user = userEvent.setup()
    render(<ScanInput products={[sinPrecio]} onAddItem={() => {}} />)
    const weightInput = await typeWeight(user, '7', '0,45', false)
    expect(weightInput).toHaveFocus()
    expect(screen.getByLabelText(/Precio total/)).not.toHaveFocus()
    expect(screen.getByLabelText(/Precio total/)).toHaveValue('')
    expect(screen.queryByLabelText(/Precio por kilo/)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Precio especial/ })).toBeInTheDocument()
  })
})

describe('ScanInput — precio por kilo', () => {
  it('sin el tilde el total es peso por el kilo de lista', async () => {
    const user = userEvent.setup()
    const onAddItem = vi.fn<(item: SaleItemDraft) => void>()
    render(<ScanInput products={[conPrecio]} onAddItem={onAddItem} />)
    await typeWeight(user, '5', '0,5', false)

    expect(screen.queryByLabelText(/Precio por kilo/)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Precio especial/ })).toBeInTheDocument()
    expect(screen.getByLabelText(/Precio total/)).toHaveValue('10.500')

    await user.click(screen.getByRole('button', { name: 'Agregar a la venta' }))
    expect(onAddItem).toHaveBeenCalledWith(expect.objectContaining({
      weightKg: 0.5,
      unitPrice: 21000,
      subtotal: 10500,
      manualEntry: true,
    }))
    expect(onAddItem.mock.calls[0]?.[0].priceDiscrepancy).toBeUndefined()
  })

  it('con el tilde el total es peso por el kilo editado, sin tope', async () => {
    const user = userEvent.setup()
    const onAddItem = vi.fn<(item: SaleItemDraft) => void>()
    render(<ScanInput products={[conPrecio]} onAddItem={onAddItem} />)
    const weightInput = await typeWeight(user, '5', '0,5', true)

    const kilo = screen.getByLabelText(/Precio por kilo/)
    expect(kilo).toHaveValue('21.000')
    expect(screen.getByRole('checkbox', { name: /Precio especial/ })).toBeChecked()

    await user.clear(kilo)
    await user.type(kilo, '19000')
    expect(kilo).toHaveValue('19.000')
    expect(weightInput).toHaveValue('0,5')
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText(/9\.500/)).toBeInTheDocument()

    await user.clear(weightInput)
    await user.type(weightInput, '2')
    expect(kilo).toHaveValue('19.000')
    expect(weightInput).toHaveValue('2')

    await user.click(screen.getByRole('button', { name: 'Agregar a la venta' }))
    expect(onAddItem).toHaveBeenCalledWith(expect.objectContaining({
      weightKg: 2,
      unitPrice: 19000,
      subtotal: 38000,
      manualEntry: true,
      priceDiscrepancy: true,
    }))
  })
})
