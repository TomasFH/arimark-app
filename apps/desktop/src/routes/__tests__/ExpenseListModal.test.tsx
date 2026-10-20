import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExpenseListModal from '../ExpenseListModal'
import type { ExpenseRow } from '../../types/hw-api'

const HIELO: ExpenseRow = {
  id: 'exp-hielo',
  concept: 'Hielo',
  amount: 5000,
  createdAt: '2026-10-20T18:00:00.000Z',
  createdBy: 'Ana',
}

function installHw(overrides: Record<string, unknown> = {}): void {
  window.hw = {
    getShiftExpenses: vi.fn().mockResolvedValue({ ok: true, data: [HIELO] }),
    deleteExpense: vi.fn().mockResolvedValue({ ok: true }),
    updateExpense: vi.fn().mockResolvedValue({ ok: true }),
    listProviders: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    getExpenseCategories: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    getInitStatus: vi.fn().mockResolvedValue({ ok: true, data: { businessName: 'Nombre del negocio' } }),
    getUserOpenShift: vi.fn().mockResolvedValue({ ok: false }),
    getStores: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    ...overrides,
  } as unknown as typeof window.hw
}

describe('ExpenseListModal — aviso al efectivo en caja', () => {
  beforeEach(() => {
    installHw()
  })

  it('avisa al borrar un gasto', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    render(<ExpenseListModal onClose={() => {}} onChanged={onChanged} />)

    await user.click(await screen.findByRole('button', { name: /Hielo/ }))
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(window.hw.deleteExpense).toHaveBeenCalledWith('exp-hielo')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('no avisa si el borrado falla', async () => {
    installHw({
      deleteExpense: vi.fn().mockResolvedValue({ ok: false, error: 'No se pudo eliminar.' }),
    })
    const user = userEvent.setup()
    const onChanged = vi.fn()
    render(<ExpenseListModal onClose={() => {}} onChanged={onChanged} />)

    await user.click(await screen.findByRole('button', { name: /Hielo/ }))
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('No se pudo eliminar.')).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('avisa al guardar una edición', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    render(<ExpenseListModal onClose={() => {}} onChanged={onChanged} />)

    await user.click(await screen.findByRole('button', { name: /Hielo/ }))
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    expect(await screen.findByRole('dialog', { name: 'Editar gasto' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Actualizar' }))

    expect(window.hw.updateExpense).toHaveBeenCalledWith(expect.objectContaining({
      id: 'exp-hielo',
      concept: 'Hielo',
      amount: 5000,
    }))
    expect(onChanged).toHaveBeenCalledTimes(1)
  })
})
