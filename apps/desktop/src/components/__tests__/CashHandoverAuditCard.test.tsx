import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CashHandoverAuditCard from '../CashHandoverAuditCard'
import type { CashHandoverAudit } from '@carniceria/shared'

const audit: CashHandoverAudit = {
  found: {
    cashierName: 'Admin Prueba',
    at: '2026-10-02T19:36:00.000Z',
    bills: [{ denomination: 10000, quantity: 1 }],
    total: 10000,
    counted: true,
  },
  expected: {
    cashierName: 'Admin Prueba',
    at: '2026-10-02T19:23:00.000Z',
    bills: [],
    total: 0,
    counted: true,
  },
  left: {
    cashierName: 'Admin Prueba',
    at: '2026-10-04T04:10:00.000Z',
    bills: [],
    total: 0,
    counted: true,
  },
  amountDiff: 10000,
}

describe('CashHandoverAuditCard', () => {
  it('esconde el conteo de billetes hasta que se abre', async () => {
    const user = userEvent.setup()
    render(<CashHandoverAuditCard audit={audit} />)

    const toggle = screen.getByRole('button', { name: /Entrega del cambio/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent(/Encontró de más/)
    const reveal = document.querySelector('.height-reveal')
    expect(reveal).toHaveAttribute('aria-hidden', 'true')
    expect(reveal?.textContent).toContain('× 1')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(reveal).toHaveAttribute('aria-hidden', 'false')
    expect(screen.getByTitle(/\$10\.000 × 1/)).toBeInTheDocument()
    expect(screen.getAllByText('Ningún billete')).toHaveLength(2)
  })
})
