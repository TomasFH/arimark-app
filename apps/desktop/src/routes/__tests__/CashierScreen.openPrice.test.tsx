import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CashierScreen from '../CashierScreen'
import type { ProductRow, SessionInfo, ShiftInfo } from '../../types/hw-api'

const session: SessionInfo = {
  role: 'cashier',
  userId: 'u1',
  storeId: 's1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  displayName: 'Ana',
}

const shift: ShiftInfo = {
  id: 'sh1',
  storeId: 's1',
  userId: 'u1',
  shiftType: 'morning',
  startedAt: '2026-10-16T12:00:00.000Z',
  openingCash: 0,
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

function installHw(products: ProductRow[]) {
  const getProducts = vi.fn().mockResolvedValue({ ok: true, data: products })
  const known: Record<string, unknown> = {
    getProducts,
    getMerchVisitDraft: vi.fn().mockResolvedValue({ ok: true, data: null }),
    getUiSettings: vi.fn().mockResolvedValue({
      ok: true,
      data: { colorScheme: 'light', zoomFactor: 1 },
    }),
    getStores: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    getShiftSummary: vi.fn().mockResolvedValue({ ok: true, data: { cashInHand: 0 } }),
    onUiSettingsChanged: vi.fn(() => () => {}),
    onCatalogSyncUpdated: vi.fn(() => () => {}),
  }
  window.hw = new Proxy({} as Record<PropertyKey, unknown>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop in known) return known[prop]
      if (prop.startsWith('on')) return () => () => {}
      return vi.fn().mockResolvedValue({ ok: false, error: 'mock' })
    },
  }) as unknown as typeof window.hw
  return { getProducts }
}

async function openCashier() {
  installHw([prueba, vacio])
  render(
    <CashierScreen session={session} shift={shift} onLogout={() => {}} onCloseShift={() => {}} />,
  )
  expect(await screen.findByText('Sin productos')).toBeInTheDocument()
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('CashierScreen — precio abierto al escanear', () => {
  beforeEach(() => {
    installHw([prueba, vacio])
  })

  it('no entra la línea hasta el precio tipeado y el lector queda en pausa', async () => {
    const user = userEvent.setup()
    await openCashier()

    scanBarcode(kretzBarcode(998, 10000))
    expect(await screen.findByRole('dialog', { name: 'Precio de esta venta' })).toBeInTheDocument()
    expect(screen.getByText('Sin productos')).toBeInTheDocument()

    scanBarcode(kretzBarcode(5, 17535))
    expect(screen.queryByText('Vacío')).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Precio de esta venta' })).not.toBeInTheDocument()
    expect(screen.queryByText('Prueba')).not.toBeInTheDocument()

    scanBarcode(kretzBarcode(998, 10000))
    expect(await screen.findByRole('dialog', { name: 'Precio de esta venta' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Precio por kilo ($)'), '20000')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    expect(screen.getAllByText('Prueba').length).toBeGreaterThan(0)
    expect(screen.getByText(/0\.500 kg/)).toBeInTheDocument()
    expect(screen.queryByText('Vacío')).not.toBeInTheDocument()
    expect(screen.queryByText('Sin productos')).not.toBeInTheDocument()
  })

  it('un precio de lista mayor a 0 entra sin preguntar', async () => {
    await openCashier()
    scanBarcode(kretzBarcode(5, 21000))
    expect((await screen.findAllByText('Vacío')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('dialog', { name: 'Precio de esta venta' })).not.toBeInTheDocument()
    expect(screen.getByText(/1\.000 kg/)).toBeInTheDocument()
  })
})
