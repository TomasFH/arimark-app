import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

describe('ScanInput — buscar por nombre', () => {
  const ahumado: ProductRow = {
    id: 'p-ahu',
    pluNumber: 12,
    name: 'Vacío ahumado',
    category: 'beef_cut',
    unit: 'kg',
    price: 18000,
  }

  it('un número dentro del nombre no borra lo escrito', async () => {
    const user = userEvent.setup()
    render(<ScanInput products={[conPrecio, ahumado]} onAddItem={() => {}} />)
    await new Promise(resolve => setTimeout(resolve, 60))
    const pluInput = screen.getByLabelText('PLU o nombre')
    await user.type(pluInput, 'Vacío x2')
    expect(pluInput).toHaveValue('Vacío x2')
  })

  it('flechas y enter eligen la sugerencia y el campo queda PLU - producto', async () => {
    const user = userEvent.setup()
    const onAddItem = vi.fn<(item: SaleItemDraft) => void>()
    render(<ScanInput products={[conPrecio, ahumado]} onAddItem={onAddItem} />)
    await new Promise(resolve => setTimeout(resolve, 60))
    const pluInput = screen.getByLabelText('PLU o nombre')
    await user.type(pluInput, 'va')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(pluInput).toHaveValue('12 - Vacío ahumado')

    const weightInput = screen.getByLabelText('Peso (kg)')
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(weightInput).toHaveFocus()
    await user.type(weightInput, '1')
    await user.click(screen.getByRole('button', { name: 'Agregar a la venta' }))
    expect(onAddItem).toHaveBeenCalledWith(expect.objectContaining({
      pluNumber: 12,
      productName: 'Vacío ahumado',
      weightKg: 1,
      unitPrice: 18000,
      subtotal: 18000,
      manualEntry: true,
    }))
  })

  it('tab baja a la siguiente sugerencia', async () => {
    const user = userEvent.setup()
    render(<ScanInput products={[conPrecio, ahumado]} onAddItem={() => {}} />)
    await new Promise(resolve => setTimeout(resolve, 60))
    const pluInput = screen.getByLabelText('PLU o nombre')
    await user.type(pluInput, 'va')
    await user.keyboard('{Tab}{Enter}')
    expect(pluInput).toHaveValue('12 - Vacío ahumado')
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

  it('con lista en 0 el unitario es total ÷ peso y no queda en 0', async () => {
    const user = userEvent.setup()
    const onAddItem = vi.fn<(item: SaleItemDraft) => void>()
    const abierto: ProductRow = { ...sinPrecio, id: 'p-0', pluNumber: 998, name: 'Prueba', price: 0 }
    render(<ScanInput products={[abierto]} onAddItem={onAddItem} />)
    await typeWeight(user, '998', '0,5', false)
    const total = screen.getByLabelText(/Precio total/)
    await user.click(total)
    await user.type(total, '10000')
    await user.click(screen.getByRole('button', { name: 'Agregar a la venta' }))
    expect(onAddItem).toHaveBeenCalledWith(expect.objectContaining({
      pluNumber: 998,
      weightKg: 0.5,
      unitPrice: 20000,
      subtotal: 10000,
      manualEntry: true,
    }))
    expect(onAddItem.mock.calls[0]?.[0].unitPrice).not.toBe(0)
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

describe('ScanInput — producto por unidad sin precio de lista', () => {
  const suelto: ProductRow = {
    id: 'u-0',
    pluNumber: 3,
    name: 'Huevo suelto',
    category: 'other',
    unit: 'unit',
    price: 0,
  }

  it('muestra el precio por unidad y la línea no queda en 0', async () => {
    const user = userEvent.setup()
    const onAddItem = vi.fn<(item: SaleItemDraft) => void>()
    render(<ScanInput products={[suelto]} onAddItem={onAddItem} />)
    await new Promise(resolve => setTimeout(resolve, 60))
    const pluInput = screen.getByLabelText('PLU o nombre')
    await user.type(pluInput, '3')
    expect(screen.getByLabelText('Precio por unidad ($)')).toBeInTheDocument()
    expect(screen.queryByText('Precio total')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Cantidad'), '2')
    await user.type(screen.getByLabelText('Precio por unidad ($)'), '1500')
    await user.click(screen.getByRole('button', { name: 'Agregar a la venta' }))
    expect(onAddItem).toHaveBeenCalledWith(expect.objectContaining({
      unit: 'unit',
      weightKg: 2,
      unitPrice: 1500,
      subtotal: 3000,
      manualEntry: true,
    }))
  })
})

describe('ScanInput — autoscroll del autocompletado', () => {
  const cortes: ProductRow[] = Array.from({ length: 8 }, (_, index) => ({
    id: `corte-${index}`,
    pluNumber: index + 1,
    name: `Corte ${index + 1}`,
    category: 'beef_cut' as const,
    unit: 'kg' as const,
    price: 10000 + index,
  }))

  it('flechas y tab llevan la fila a la vista; el mouse no', async () => {
    const user = userEvent.setup()
    render(<ScanInput products={cortes} onAddItem={() => {}} />)
    await new Promise(resolve => setTimeout(resolve, 60))
    const calls: HTMLElement[] = []
    const seen: Array<boolean | ScrollIntoViewOptions | undefined> = []
    const previousScroll = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, arg?: boolean | ScrollIntoViewOptions) {
      calls.push(this)
      seen.push(arg)
    }
    try {
      const pluInput = screen.getByLabelText('PLU o nombre')
      await user.type(pluInput, 'Corte')
      const segunda = screen.getByRole('button', { name: /Corte 2/ })
      fireEvent.mouseEnter(segunda)
      expect(document.querySelector('[data-scan-marked="true"]')).toHaveTextContent('Corte 2')
      expect(calls).toHaveLength(0)

      await user.keyboard('{ArrowDown}')
      const marked = document.querySelector<HTMLElement>('[data-scan-marked="true"]')
      expect(marked).toHaveTextContent('Corte 3')
      expect(calls.at(-1)).toBe(marked)
      expect(seen.at(-1)).toEqual({ block: 'nearest' })

      calls.length = 0
      await user.keyboard('{Tab}')
      const next = document.querySelector<HTMLElement>('[data-scan-marked="true"]')
      expect(next).toHaveTextContent('Corte 4')
      expect(calls.at(-1)).toBe(next)
      expect(seen.at(-1)).toEqual({ block: 'nearest' })
    } finally {
      HTMLElement.prototype.scrollIntoView = previousScroll
    }
  })
})
