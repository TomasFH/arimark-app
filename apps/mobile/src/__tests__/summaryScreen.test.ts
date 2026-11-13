import { afterEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { mondayWeekRange, summaryMonthStep, summaryPeriodQuery } from '@carniceria/shared'
import type { StoreDoc } from '../lib/adminFirestore'

vi.mock('../lib/adminSummary', () => ({
  loadMobileSummary: vi.fn(async () => ({ shifts: [], visits: [], warning: null })),
}))

import { loadMobileSummary } from '../lib/adminSummary'
import { fetchAllCustomerDebtEvents } from '../lib/adminFirestore'
import { SummaryScreen } from '../components/admin/SummaryScreen'

vi.mock('../lib/adminFirestore', async () => {
  const actual = await vi.importActual<typeof import('../lib/adminFirestore')>('../lib/adminFirestore')
  return {
    ...actual,
    fetchAllCustomerDebtEvents: vi.fn(async () => []),
  }
})

function store(id: string, name: string, archivedAt: string | null = null): StoreDoc {
  return {
    id,
    name,
    archivedAt,
    address: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('SummaryScreen del celu', () => {
  let host: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    vi.unstubAllEnvs()
    act(() => { root?.unmount() })
    host?.remove()
    host = null
    root = null
  })

  it('arranca en todos los locales y en esta semana', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(createElement(SummaryScreen, {
        onBack: () => {},
        stores: [
          store('archivado', 'Archivado', '2026-01-01T00:00:00.000Z'),
          store('norte', 'Local Norte'),
          store('sur', 'Local Sur'),
        ],
      }))
    })
    await act(async () => { await Promise.resolve() })

    const local = document.getElementById('summary-store')
    const period = document.getElementById('summary-period')
    if (!(local instanceof HTMLSelectElement) || !(period instanceof HTMLSelectElement)) {
      throw new Error('faltan los filtros')
    }
    expect(local.value).toBe('')
    expect([...local.options].map(option => option.text)).toEqual([
      'Todos los locales',
      'Local Norte',
      'Local Sur',
    ])
    expect(period.value).toBe('week')
    const names = [...period.options].map(option => option.text)
    expect(names).toEqual(['Hoy', 'Esta semana', 'Este mes', summaryMonthStep(1).name])

    const week = mondayWeekRange(0)
    expect(loadMobileSummary).toHaveBeenCalledWith('norte', week.startIso, week.endIso)
    expect(loadMobileSummary).toHaveBeenCalledWith('sur', week.startIso, week.endIso)
    expect(loadMobileSummary).not.toHaveBeenCalledWith('archivado', week.startIso, week.endIso)

    const calls = vi.mocked(loadMobileSummary).mock.calls.length
    await act(async () => {
      period.value = 'today'
      period.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(vi.mocked(loadMobileSummary).mock.calls.length).toBe(calls)

    await act(async () => {
      period.value = 'previous'
      period.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { await Promise.resolve() })
    const previous = summaryPeriodQuery('previous')
    expect(loadMobileSummary).toHaveBeenCalledWith('norte', previous.startIso, previous.endIso)
    expect([...period.options].map(option => option.text)).toContain('Este mes')
    expect([...period.options].map(option => option.text)).toContain(summaryMonthStep(1).name)
    expect(host.textContent ?? '').not.toContain('Aportes')

    const cobros = rowText(host, 'Cobros del período')
    const deuda = rowText(host, 'Deuda de ahora')
    expect(cobros).toContain('pendiente')
    expect(cobros).not.toContain('$')
    expect(deuda).toContain('pendiente')
    expect(deuda).not.toContain('$')
    expect(fetchAllCustomerDebtEvents).not.toHaveBeenCalled()
  })

  it('con el interruptor apagado no pinta el juego de prueba', async () => {
    vi.stubEnv('VITE_APP_ENV', 'dev')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(createElement(SummaryScreen, {
        onBack: () => {},
        stores: [store('norte', 'Local Norte')],
      }))
    })
    await act(async () => { await Promise.resolve() })
    const calls = vi.mocked(loadMobileSummary).mock.calls.length
    expect(calls).toBeGreaterThan(0)
    expect(host.textContent ?? '').not.toContain('Mostrador Norte')

    const toggle = host.querySelector('input[type="checkbox"]')
    if (!(toggle instanceof HTMLInputElement)) throw new Error('falta el interruptor')
    await act(async () => { toggle.click() })
    await act(async () => { await Promise.resolve() })
    expect(vi.mocked(loadMobileSummary).mock.calls.length).toBe(calls)
    expect(host.textContent ?? '').toContain('Mostrador Norte')
    expect(host.textContent ?? '').toContain('Hay cobros sin turno')
    expect(fetchAllCustomerDebtEvents).not.toHaveBeenCalled()

    await act(async () => { toggle.click() })
    await act(async () => { await Promise.resolve() })
    expect(vi.mocked(loadMobileSummary).mock.calls.length).toBeGreaterThan(calls)
    expect(host.textContent ?? '').not.toContain('Mostrador Norte')
    vi.unstubAllEnvs()
  })
})

function rowText(host: HTMLElement, label: string): string {
  const row = [...host.querySelectorAll('div')].find(node =>
    [...node.children].some(child => child.textContent === label),
  )
  return row?.textContent ?? ''
}
