import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ValesModal from '../ValesModal'
import type { EmployeeRow, ProductRow } from '../../types/hw-api'

const butcher: EmployeeRow = {
  id: 'butcher',
  name: 'Pedro',
  weeklyWage: 100000,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  kind: 'butcher',
  homeStoreId: 's1',
}

const prueba: ProductRow = {
  id: 'p-998',
  pluNumber: 998,
  name: 'Prueba',
  category: 'beef_cut',
  unit: 'kg',
  price: 0,
}

const vacio: ProductRow = {
  id: 'p-5',
  pluNumber: 5,
  name: 'Vacío',
  category: 'beef_cut',
  unit: 'kg',
  price: 21000,
}

function kretzBarcode(plu: number, pesos: number): string {
  const body = `20${String(plu).padStart(3, '0')}${String(pesos * 100).padStart(7, '0')}`
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const digit = Number(body[i])
    sum += i % 2 === 0 ? digit : digit * 3
  }
  return body + String((10 - (sum % 10)) % 10)
}

function scanBarcode(digits: string) {
  for (const key of digits) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  }
}

function installHw() {
  const registerVale = vi.fn().mockResolvedValue({ ok: true, data: { id: 'vale-1' } })
  const known: Record<string, unknown> = {
    registerVale,
    listEmployees: vi.fn().mockResolvedValue({ ok: true, data: [butcher] }),
    getProducts: vi.fn().mockResolvedValue({ ok: true, data: [prueba, vacio] }),
    listVales: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    getWeeklyValeSummary: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        employeeId: butcher.id,
        weekStart: '2026-10-19',
        weekEnd: '2026-10-25',
        totalVales: 0,
        weeklyWage: 100000,
        netToPay: 100000,
      },
    }),
    getStoreOpenShift: vi.fn().mockResolvedValue({ ok: true, data: null }),
  }
  window.hw = new Proxy({} as Record<PropertyKey, unknown>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop in known) return known[prop]
      if (prop.startsWith('on')) return () => () => {}
      return vi.fn().mockResolvedValue({ ok: true, data: null })
    },
  }) as unknown as typeof window.hw
  return { registerVale }
}

describe('ValesModal — precio abierto', () => {
  beforeEach(() => {
    installHw()
  })

  it('pide el precio, ignora otro código mientras está abierto y conserva el importe del ticket', async () => {
    const user = userEvent.setup()
    const { registerVale } = installHw()
    render(
      <ValesModal onClose={() => {}} storeId="s1" viewerRole="admin" viewerName="Admin" />,
    )
    expect(await screen.findByRole('button', { name: 'Pedro' })).toBeInTheDocument()
    expect(await screen.findByText('Producto (nombre o PLU)')).toBeInTheDocument()

    scanBarcode(kretzBarcode(998, 10000))
    expect(await screen.findByRole('dialog', { name: 'Precio de esta venta' })).toBeInTheDocument()

    scanBarcode(kretzBarcode(5, 17535))
    expect(screen.queryByText('Vacío')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Precio por kilo ($)'), '20000')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    expect(screen.queryByRole('dialog', { name: 'Precio de esta venta' })).not.toBeInTheDocument()
    expect(screen.getByText('Prueba')).toBeInTheDocument()
    expect(screen.getByText(/0,5 kg/)).toBeInTheDocument()
    expect(screen.queryByText('Vacío')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Registrar vale' }))
    expect(registerVale).toHaveBeenCalledWith(expect.objectContaining({
      amount: 10000,
      items: [expect.objectContaining({
        productId: prueba.id,
        quantity: 0.5,
        unitPrice: 20000,
        subtotal: 10000,
      })],
    }))
  })

  it('Escape no agrega la línea', async () => {
    const user = userEvent.setup()
    render(
      <ValesModal onClose={() => {}} storeId="s1" viewerRole="admin" viewerName="Admin" />,
    )
    expect(await screen.findByText('Producto (nombre o PLU)')).toBeInTheDocument()
    scanBarcode(kretzBarcode(998, 10000))
    expect(await screen.findByRole('dialog', { name: 'Precio de esta venta' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Precio de esta venta' })).not.toBeInTheDocument()
    expect(screen.queryByText('Prueba')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Vales / adelantos' })).toBeInTheDocument()
  })
})
