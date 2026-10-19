import { describe, expect, it } from 'vitest'
import { formatKgQuantity } from '../numericInput'
import {
  listPriceIfDifferent,
  matchOrderTicket,
  repriceChargeLine,
  saleItemFromChargeLine,
  type OrderChargeLine,
  type OrderTicketProduct,
} from '../orderTicketMatch'

function line(overrides: Partial<OrderChargeLine> = {}): OrderChargeLine {
  return {
    productId: 'p1',
    name: 'Asado',
    unit: 'kg',
    pluNumber: 1,
    estimatedQty: 1,
    requestedUnits: null,
    unitPrice: 20000,
    qtyRaw: '',
    checked: true,
    ticketTotal: null,
    extra: false,
    ...overrides,
  }
}

function product(overrides: Partial<OrderTicketProduct> = {}): OrderTicketProduct {
  return {
    id: 'p5',
    name: 'Vacío',
    unit: 'kg',
    pluNumber: 5,
    price: 21000,
    ...overrides,
  }
}

describe('matchOrderTicket', () => {
  it('guarda el total del ticket y calcula los kilos con el precio de la línea', () => {
    const lines = [line({ pluNumber: 1, unitPrice: 20000 })]
    const result = matchOrderTicket(lines, { pluNumber: 1, totalPesos: 10000 }, [])

    expect(result.notice).toBeNull()
    expect(result.touchedIndex).toBe(0)
    expect(result.lines[0]).toMatchObject({
      ticketTotal: 10000,
      qtyRaw: '0,5',
      unitPrice: 20000,
      extra: false,
    })
    expect(lines[0]?.ticketTotal).toBeNull()

    const item = saleItemFromChargeLine(result.lines[0]!)
    expect(item?.subtotal).toBe(10000)
    expect(item?.weightKg).toBeCloseTo(0.5, 8)
    expect(item?.manualEntry).toBe(false)
  })

  it('completa la línea del pedido aunque el PLU no esté en el catálogo', () => {
    const result = matchOrderTicket(
      [line({ pluNumber: 7, name: 'Matambre', unitPrice: 20000 })],
      { pluNumber: 7, totalPesos: 10000 },
      [product({ pluNumber: 5, name: 'Vacío', price: 21000 })],
    )

    expect(result.notice).toBeNull()
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toMatchObject({
      name: 'Matambre',
      ticketTotal: 10000,
      qtyRaw: '0,5',
      extra: false,
    })
  })

  it('la segunda etiqueta del mismo PLU completa la siguiente línea libre', () => {
    const start = [
      line({ pluNumber: 3, name: 'Asado' }),
      line({ pluNumber: 3, name: 'Asado', productId: 'p1b' }),
    ]
    const first = matchOrderTicket(start, { pluNumber: 3, totalPesos: 10000 }, [])
    expect(first.lines[0]?.ticketTotal).toBe(10000)
    expect(first.lines[1]?.ticketTotal).toBeNull()

    const second = matchOrderTicket(first.lines, { pluNumber: 3, totalPesos: 5000 }, [])
    expect(second.lines).toHaveLength(2)
    expect(second.lines[1]).toMatchObject({
      ticketTotal: 5000,
      qtyRaw: '0,25',
      extra: false,
      productId: 'p1b',
    })
  })

  it('si no queda otra línea libre, la etiqueta siguiente entra como extra', () => {
    const first = matchOrderTicket(
      [line({ pluNumber: 3, unitPrice: 20000, productId: 'p3' })],
      { pluNumber: 3, totalPesos: 10000 },
      [],
    )
    const second = matchOrderTicket(first.lines, { pluNumber: 3, totalPesos: 8000 }, [])

    expect(second.lines).toHaveLength(2)
    expect(second.lines[0]?.ticketTotal).toBe(10000)
    expect(second.lines[1]).toMatchObject({
      extra: true,
      ticketTotal: 8000,
      unitPrice: 20000,
      productId: 'p3',
      qtyRaw: '0,4',
    })
  })

  it('el extra que desborda usa el precio de lista si el producto está en el catálogo', () => {
    const first = matchOrderTicket(
      [line({ pluNumber: 5, unitPrice: 20000, name: 'Asado' })],
      { pluNumber: 5, totalPesos: 10000 },
      [],
    )
    const second = matchOrderTicket(
      first.lines,
      { pluNumber: 5, totalPesos: 21000 },
      [product({ id: 'cat-5', pluNumber: 5, name: 'Asado oferta', price: 21000 })],
    )

    expect(second.lines).toHaveLength(2)
    expect(second.lines[1]).toMatchObject({
      extra: true,
      productId: 'cat-5',
      name: 'Asado oferta',
      unitPrice: 21000,
      ticketTotal: 21000,
      qtyRaw: '1',
    })
  })

  it('agrega un extra al precio de lista si el PLU no está en el pedido', () => {
    const result = matchOrderTicket(
      [line({ pluNumber: 1, name: 'Asado' })],
      { pluNumber: 5, totalPesos: 21000 },
      [product({ name: 'Vacío', price: 21000, pluNumber: 5 })],
    )

    expect(result.notice).toBeNull()
    expect(result.lines).toHaveLength(2)
    expect(result.lines[1]).toMatchObject({
      extra: true,
      name: 'Vacío',
      unitPrice: 21000,
      ticketTotal: 21000,
      qtyRaw: '1',
    })
    expect(result.lines[0]?.ticketTotal).toBeNull()
  })

  it('avisa y no agrega un PLU desconocido', () => {
    const lines = [line({ pluNumber: 1 })]
    const result = matchOrderTicket(lines, { pluNumber: 99, totalPesos: 5000 }, [])

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]?.ticketTotal).toBeNull()
    expect(result.touchedIndex).toBeNull()
    expect(result.notice).toMatch(/99/)
    expect(result.notice).toMatch(/catálogo/)
  })

  it('marca la fila que recibió la etiqueta y deja el extra al final', () => {
    const first = matchOrderTicket(
      [line({ name: 'Vacío', pluNumber: 1 })],
      { pluNumber: 1, totalPesos: 10000 },
      [],
    )
    expect(first.touchedIndex).toBe(0)

    const second = matchOrderTicket(
      first.lines,
      { pluNumber: 5, totalPesos: 21000 },
      [product({ name: 'Asado', pluNumber: 5, price: 21000 })],
    )
    expect(second.touchedIndex).toBe(1)
    expect(second.lines.map(row => row.name)).toEqual(['Vacío', 'Asado'])
    expect(second.lines[1]?.extra).toBe(true)

    const rejected = matchOrderTicket(second.lines, { pluNumber: 99, totalPesos: 5000 }, [])
    expect(rejected.touchedIndex).toBeNull()
    expect(rejected.lines.map(row => row.name)).toEqual(['Vacío', 'Asado'])
  })

  it('no divide por cero ni por un precio negativo', () => {
    for (const unitPrice of [0, -1500]) {
      const result = matchOrderTicket(
        [line({ pluNumber: 1, unitPrice, qtyRaw: '' })],
        { pluNumber: 1, totalPesos: 10000 },
        [],
      )
      expect(result.lines).toHaveLength(1)
      expect(result.lines[0]?.ticketTotal).toBeNull()
      expect(result.lines[0]?.qtyRaw).toBe('')
      expect(result.notice).toMatch(/precio/i)
      expect(result.lines[0]?.unitPrice).toBe(unitPrice)
    }
  })

  it('no agrega un extra si el precio de lista es cero o negativo', () => {
    for (const price of [0, -1]) {
      const result = matchOrderTicket(
        [line({ pluNumber: 1 })],
        { pluNumber: 8, totalPesos: 4000 },
        [product({ id: 'p8', pluNumber: 8, name: 'Mondongo', price })],
      )
      expect(result.lines).toHaveLength(1)
      expect(result.notice).toMatch(/precio/i)
    }
  })

  it('redondea la cantidad de un producto por unidad', () => {
    const result = matchOrderTicket(
      [line({ unit: 'unit', unitPrice: 6000, pluNumber: 1, name: 'Huevos' })],
      { pluNumber: 1, totalPesos: 12000 },
      [],
    )

    expect(result.notice).toBeNull()
    expect(result.lines[0]).toMatchObject({ qtyRaw: '2', ticketTotal: 12000 })
    const item = saleItemFromChargeLine(result.lines[0]!)
    expect(item?.weightKg).toBe(2)
    expect(item?.subtotal).toBe(12000)
    expect(item?.priceDiscrepancy).toBeUndefined()
  })

  it('avisa si el total no cierra con el precio por unidad y cobra el ticket', () => {
    const result = matchOrderTicket(
      [line({ unit: 'unit', unitPrice: 6000, pluNumber: 1, name: 'Huevos' })],
      { pluNumber: 1, totalPesos: 7000 },
      [],
    )

    expect(result.lines[0]).toMatchObject({ qtyRaw: '1', ticketTotal: 7000 })
    expect(result.notice).toMatch(/no cierra/i)
    const item = saleItemFromChargeLine(result.lines[0]!)
    expect(item?.weightKg).toBe(1)
    expect(item?.subtotal).toBe(7000)
    expect(item?.priceDiscrepancy).toBe(true)

    const repriced = repriceChargeLine(result.lines[0]!, 5000)
    expect(repriced.line.qtyRaw).toBe('1')
    expect(repriced.line.ticketTotal).toBe(7000)
    expect(repriced.notice).toMatch(/no cierra/i)
    expect(saleItemFromChargeLine(repriced.line)?.subtotal).toBe(7000)
  })

  it('al cambiar el precio recalcula los kilos y el subtotal sigue siendo el ticket', () => {
    const matched = matchOrderTicket(
      [line({ pluNumber: 5, unitPrice: 20000 })],
      { pluNumber: 5, totalPesos: 17535 },
      [],
    )
    expect(matched.lines[0]?.qtyRaw).toBe('0,877')
    const before = saleItemFromChargeLine(matched.lines[0]!)
    expect(before?.subtotal).toBe(17535)
    expect(before?.weightKg).toBeCloseTo(17535 / 20000, 8)
    expect(Math.round(0.877 * 20000)).toBe(17540)

    const priced = repriceChargeLine(matched.lines[0]!, 10000)
    expect(priced.notice).toBeNull()
    expect(priced.line.unitPrice).toBe(10000)
    expect(priced.line.ticketTotal).toBe(17535)
    expect(priced.line.qtyRaw).toBe(formatKgQuantity(17535 / 10000))
    expect(priced.line.qtyRaw).not.toBe(matched.lines[0]?.qtyRaw)

    const after = saleItemFromChargeLine(priced.line)
    expect(after?.unitPrice).toBe(10000)
    expect(after?.subtotal).toBe(17535)
    expect(after?.weightKg).toBeCloseTo(17535 / 10000, 8)
    const shownKg = Number((priced.line.qtyRaw).replace(/\./g, '').replace(',', '.'))
    expect(Math.round(shownKg * 10000)).toBe(17540)
    expect(after?.subtotal).not.toBe(Math.round(shownKg * 10000))
  })

  it('rechaza un precio nuevo en cero sin tocar los kilos ya calculados', () => {
    const matched = matchOrderTicket(
      [line({ unitPrice: 20000 })],
      { pluNumber: 1, totalPesos: 10000 },
      [],
    )
    const rejected = repriceChargeLine(matched.lines[0]!, 0)
    expect(rejected.notice).toMatch(/precio/i)
    expect(rejected.line.unitPrice).toBe(20000)
    expect(rejected.line.qtyRaw).toBe('0,5')
    expect(rejected.line.ticketTotal).toBe(10000)
    expect(saleItemFromChargeLine(rejected.line)?.subtotal).toBe(10000)
  })

  it('informa el precio de lista distinto sin comparar por nombre', () => {
    const row = line({ productId: 'p1', unitPrice: 20000, name: 'Asado' })
    expect(listPriceIfDifferent(row, [product({ id: 'p1', price: 22000, name: 'Otro nombre', pluNumber: 1 })])).toBe(22000)
    expect(listPriceIfDifferent(row, [product({ id: 'p1', price: 20000, pluNumber: 1 })])).toBeNull()
    expect(listPriceIfDifferent(row, [product({ id: 'otro', name: 'Asado', price: 99999, pluNumber: 99 })])).toBeNull()
  })

  it('el peso a mano cobra precio por cantidad', () => {
    const item = saleItemFromChargeLine(line({ qtyRaw: '1,5', unitPrice: 20000, ticketTotal: null }))
    expect(item?.weightKg).toBeCloseTo(1.5, 8)
    expect(item?.subtotal).toBe(30000)
    expect(item?.manualEntry).toBe(true)
  })

  it('un peso escrito distinto al de la etiqueta deja de cobrar el ticket', () => {
    const matched = matchOrderTicket(
      [line({ unitPrice: 20000 })],
      { pluNumber: 1, totalPesos: 10000 },
      [],
    )
    const edited = { ...matched.lines[0]!, qtyRaw: '2' }
    const item = saleItemFromChargeLine(edited)
    expect(item?.weightKg).toBe(2)
    expect(item?.subtotal).toBe(40000)
    expect(item?.manualEntry).toBe(true)
  })
})
