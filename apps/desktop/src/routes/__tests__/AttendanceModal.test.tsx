import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AttendanceModal from '../AttendanceModal'
import type { EmployeeRow } from '../../types/hw-api'

function emp(over: Partial<EmployeeRow> & Pick<EmployeeRow, 'id' | 'name' | 'homeStoreId'>): EmployeeRow {
  return {
    weeklyWage: 1,
    active: true,
    createdAt: '2026-08-28T00:00:00.000Z',
    kind: 'butcher',
    ...over,
  }
}

describe('AttendanceModal — local habitual', () => {
  beforeEach(() => {
    window.hw = {
      listEmployees: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          emp({ id: 'home', name: 'De acá', homeStoreId: 's1' }),
          emp({ id: 'other', name: 'Del otro', homeStoreId: 's2' }),
          emp({ id: 'marked', name: 'Ya marcado en B', homeStoreId: 's2' }),
        ],
      }),
      listAttendance: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          {
            id: 'a1',
            employeeId: 'marked',
            employeeName: 'Ya marcado en B',
            date: '2026-08-28',
            status: 'present',
            note: null,
            recordedBy: 'u1',
            createdAt: '2026-08-28T10:00:00.000Z',
            storeId: 's2',
          },
        ],
      }),
    } as unknown as typeof window.hw
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lista al habitual de este local, oculta al de otro y ofrece visitantes no marcados', async () => {
    const user = userEvent.setup()
    render(<AttendanceModal onClose={() => {}} storeId="s1" />)

    expect(await screen.findByText('De acá')).toBeInTheDocument()
    expect(screen.queryByText('Del otro')).not.toBeInTheDocument()
    expect(screen.queryByText('Ya marcado en B')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Agregar visitante' }))
    expect(screen.getByText('Del otro')).toBeInTheDocument()
    expect(screen.queryByText('Ya marcado en B')).not.toBeInTheDocument()
  })
})
