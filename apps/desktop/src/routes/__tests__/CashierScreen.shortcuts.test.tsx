import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CashierScreen from '../CashierScreen'
import { clearOrderChargeDraft, loadOrderChargeDraft, saveOrderChargeDraft } from '../../lib/orderChargeDraft'
import type { OrderChargeLine } from '../../lib/orderTicketMatch'
import type { SaleItemDraft, SessionInfo, ShiftInfo } from '../../types/hw-api'

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

function line(name: string, productId: string): SaleItemDraft {
  return {
    pluNumber: 5,
    productId,
    productName: name,
    unit: 'kg',
    weightKg: 1,
    unitPrice: 10000,
    subtotal: 10000,
    manualEntry: false,
  }
}

function installHw() {
  const createSale = vi.fn().mockResolvedValue({ ok: true, data: { saleId: 'sale-1' } })
  const known: Record<string, unknown> = {
    createSale,
    getProducts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
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
  return { createSale }
}

function renderCashier(items: SaleItemDraft[] = []) {
  const hw = installHw()
  render(
    <CashierScreen
      session={session}
      shift={shift}
      onLogout={() => {}}
      onCloseShift={() => {}}
      pendingOrderCart={items.length === 0 ? null : {
        orderId: 'o1',
        customerName: 'Cliente',
        depositAmount: 0,
        depositPayments: [],
        items,
      }}
    />,
  )
  return hw
}

function markedLine(): HTMLElement {
  const row = document.querySelector<HTMLElement>('[data-cart-marked="true"]')
  if (!row) throw new Error('No hay una línea marcada')
  return row
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
  })
}

async function openCashier(items: SaleItemDraft[] = []) {
  cleanup()
  const hw = renderCashier(items)
  expect(await screen.findByText(items.length === 0 ? 'Sin productos' : items[0]!.productName)).toBeInTheDocument()
  await settle()
  return hw
}

function pressAlt(key: string, code: string, target: EventTarget = document) {
  return fireEvent.keyDown(target, { key, code, altKey: true })
}

describe('CashierScreen — atajos de cobro', () => {
  beforeEach(() => {
    installHw()
  })

  it('F1–F3 y F9 con el carrito vacío no abren el cobro', async () => {
    renderCashier()
    expect(await screen.findByText('Sin productos')).toBeInTheDocument()
    await settle()

    expect(fireEvent.keyDown(document, { key: 'F1' })).toBe(false)
    fireEvent.keyDown(document, { key: 'F2' })
    fireEvent.keyDown(document, { key: 'F3' })
    fireEvent.keyDown(document, { key: 'F4' })
    fireEvent.keyDown(document, { key: 'F9' })

    expect(screen.queryByRole('heading', { name: 'Cobrar venta' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Cobro en efectivo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Confirmar cobro/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Cobro con crédito' })).not.toBeInTheDocument()
    expect(fireEvent.keyDown(document, { key: 'F5' })).toBe(false)
    expect(screen.queryByRole('heading', { name: 'Cobro dividido' })).not.toBeInTheDocument()
  })

  it('F5 desde la venta abre el cobro dividido y no confirma', async () => {
    await openCashier([line('Vacío', 'p1')])

    expect(fireEvent.keyDown(document, { key: 'F5' })).toBe(false)

    expect(await screen.findByRole('heading', { name: 'Cobro dividido' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirmar cobro/ })).toBeDisabled()
  })

  it('Supr y las flechas no actúan si el foco está en un input', async () => {
    const user = userEvent.setup()
    renderCashier([line('Vacío', 'p1'), line('Asado', 'p2')])
    expect(await screen.findByText('Vacío')).toBeInTheDocument()
    expect(screen.getByText('Asado')).toBeInTheDocument()
    expect(markedLine()).toHaveTextContent('Vacío')

    await user.click(screen.getByRole('button', { name: 'Manual' }))
    const name = screen.getByLabelText('PLU o nombre')
    name.focus()

    fireEvent.keyDown(name, { key: 'ArrowDown' })
    fireEvent.keyDown(name, { key: 'ArrowUp' })
    fireEvent.keyDown(name, { key: 'Delete' })

    expect(screen.getByText('Vacío')).toBeInTheDocument()
    expect(screen.getByText('Asado')).toBeInTheDocument()
    expect(markedLine()).toHaveTextContent('Vacío')

    const cobrar = screen.getByRole('button', { name: 'Cobrar' })
    cobrar.focus()
    fireEvent.keyDown(cobrar, { key: 'ArrowDown' })
    expect(markedLine()).toHaveTextContent('Asado')

    name.focus()
    fireEvent.keyDown(name, { key: 'ArrowUp' })
    fireEvent.keyDown(name, { key: 'Delete' })

    expect(screen.getByText('Vacío')).toBeInTheDocument()
    expect(screen.getByText('Asado')).toBeInTheDocument()
    expect(markedLine()).toHaveTextContent('Asado')
  })

  it('la misma pulsación que abre el medio no confirma la venta', async () => {
    const { createSale } = renderCashier([line('Vacío', 'p1')])
    expect(await screen.findByText('Vacío')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'F2' })

    expect(await screen.findByRole('heading', { name: 'Confirmar cobro — Débito' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirmar cobro/ })).toBeInTheDocument()
    expect(createSale).not.toHaveBeenCalled()
    await settle()
    expect(createSale).not.toHaveBeenCalled()
  })

  it('Alt+1 vuelve a la venta', async () => {
    const user = userEvent.setup()
    await openCashier()

    await user.click(screen.getByRole('button', { name: 'Menú' }))
    expect(screen.getByRole('dialog', { name: 'Opciones' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Venta' })).not.toHaveAttribute('aria-current', 'page')

    expect(pressAlt('1', 'Digit1')).toBe(false)

    expect(screen.queryByRole('dialog', { name: 'Opciones' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Venta' })).toHaveAttribute('aria-current', 'page')
  })

  it('Alt+2 abre pedido, Alt+3 vales, Alt+4 gastos, Alt+5 turno y Alt+I ingreso', async () => {
    await openCashier()
    expect(pressAlt('2', 'Digit2')).toBe(false)
    expect(await screen.findByRole('heading', { name: 'Nuevo pedido' })).toBeInTheDocument()

    await openCashier()
    expect(pressAlt('3', 'Digit3')).toBe(false)
    expect(screen.getByRole('heading', { name: 'Vales / adelantos' })).toBeInTheDocument()

    await openCashier()
    expect(pressAlt('4', 'Digit4')).toBe(false)
    expect(screen.getByRole('heading', { name: 'Gastos' })).toBeInTheDocument()

    await openCashier()
    expect(pressAlt('5', 'Digit5')).toBe(false)
    expect(screen.getByRole('heading', { name: 'Ventas del turno' })).toBeInTheDocument()

    await openCashier()
    expect(pressAlt('i', 'KeyI')).toBe(false)
    expect(screen.getByRole('heading', { name: 'Ingreso de efectivo' })).toBeInTheDocument()
  })

  it('Alt+1–5 y Alt+I no actúan si el foco está en un input', async () => {
    const user = userEvent.setup()
    await openCashier()

    await user.click(screen.getByRole('button', { name: 'Menú' }))
    await user.click(screen.getByRole('button', { name: 'Manual' }))
    const name = screen.getByLabelText('PLU o nombre')
    name.focus()

    pressAlt('1', 'Digit1', name)
    pressAlt('2', 'Digit2', name)
    pressAlt('3', 'Digit3', name)
    pressAlt('4', 'Digit4', name)
    pressAlt('5', 'Digit5', name)
    pressAlt('i', 'KeyI', name)

    expect(screen.getByRole('dialog', { name: 'Opciones' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Nuevo pedido' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Vales / adelantos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Gastos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ventas del turno' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ingreso de efectivo' })).not.toBeInTheDocument()
  })

  it('Alt+1–5 y Alt+I no actúan si hay un modal abierto', async () => {
    await openCashier([line('Vacío', 'p1')])

    fireEvent.keyDown(document, { key: 'F2' })
    expect(await screen.findByRole('heading', { name: 'Confirmar cobro — Débito' })).toBeInTheDocument()

    pressAlt('1', 'Digit1')
    pressAlt('2', 'Digit2')
    pressAlt('3', 'Digit3')
    pressAlt('4', 'Digit4')
    pressAlt('5', 'Digit5')
    pressAlt('i', 'KeyI')

    expect(screen.getByRole('heading', { name: 'Confirmar cobro — Débito' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Nuevo pedido' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Vales / adelantos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Gastos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ventas del turno' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ingreso de efectivo' })).not.toBeInTheDocument()
  })

  it('F6 abre y cierra la carga manual, también con el cursor en el nombre', async () => {
    renderCashier()
    expect(await screen.findByText('Sin productos')).toBeInTheDocument()
    await settle()
    expect(screen.queryByLabelText('PLU o nombre')).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'F6' })
    const name = await screen.findByLabelText('PLU o nombre')
    await waitFor(() => expect(name).toHaveFocus())

    fireEvent.keyDown(name, { key: 'F6' })
    await waitFor(() => {
      expect(screen.queryByLabelText('PLU o nombre')).not.toBeInTheDocument()
    })
  })

  it('F6 no abre la carga manual si hay un modal de cobro', async () => {
    await openCashier([line('Vacío', 'p1')])
    fireEvent.keyDown(document, { key: 'F2' })
    expect(await screen.findByRole('heading', { name: 'Confirmar cobro — Débito' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'F6' })
    expect(screen.queryByLabelText('PLU o nombre')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Confirmar cobro — Débito' })).toBeInTheDocument()
  })

  it('al confirmar una venta la carga manual queda como estaba', async () => {
    const user = userEvent.setup()
    const draft: OrderChargeLine = {
      productId: 'p1',
      name: 'Vacío',
      unit: 'kg',
      pluNumber: 5,
      estimatedQty: 1,
      requestedUnits: null,
      unitPrice: 10000,
      qtyRaw: '1,5',
      checked: true,
      ticketTotal: null,
      extra: false,
    }
    saveOrderChargeDraft('o1', [draft])
    const { createSale } = await openCashier([line('Vacío', 'p1')])
    expect(screen.queryByLabelText('PLU o nombre')).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'F2' })
    await user.click(await screen.findByRole('button', { name: /Confirmar cobro/ }))

    await waitFor(() => expect(createSale).toHaveBeenCalledTimes(1))
    expect(loadOrderChargeDraft('o1')).toBeNull()
    clearOrderChargeDraft('o1')
    expect(screen.queryByLabelText('PLU o nombre')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Confirmar cobro/ })).not.toBeInTheDocument()
  })

  it('si la carga manual estaba abierta, al confirmar sigue abierta y el foco vuelve al nombre', async () => {
    const user = userEvent.setup()
    const { createSale } = await openCashier([line('Vacío', 'p1')])
    fireEvent.keyDown(document, { key: 'F6' })
    expect(await screen.findByLabelText('PLU o nombre')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'F2' })
    await user.click(await screen.findByRole('button', { name: /Confirmar cobro/ }))

    expect(await screen.findByLabelText('PLU o nombre')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText('PLU o nombre')).toHaveFocus()
    })
    expect(createSale).toHaveBeenCalledTimes(1)
  })

  it('Atajos abre un diálogo con F1 y los rótulos muestran (F6) y (F7)', async () => {
    const user = userEvent.setup()
    await openCashier([line('Vacío', 'p1')])

    expect(screen.getByRole('button', { name: 'Manual' })).toHaveTextContent('(F6)')
    expect(screen.getByRole('button', { name: 'Añadir bolsas' })).toHaveTextContent('(F7)')

    await user.click(screen.getByRole('button', { name: 'Atajos' }))
    const dialog = screen.getByRole('dialog', { name: 'Atajos' })
    expect(dialog).toHaveTextContent('F1')
    expect(dialog).toHaveTextContent('F6')
    expect(dialog).toHaveTextContent('F7')
    expect(dialog).toHaveTextContent('Venta')
    expect(dialog).toHaveTextContent('Bolsas abiertas')
    expect(dialog).toHaveTextContent('Pedido')

    fireEvent.keyDown(document, { key: 'F1' })
    fireEvent.keyDown(document, { key: 'F6' })
    expect(screen.queryByRole('heading', { name: /Confirmar cobro/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('PLU o nombre')).not.toBeInTheDocument()
  })
})
