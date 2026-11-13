import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  addDaysYmd,
  mondayWeekRange,
  summaryMonthStep,
  summaryPeriodQuery,
  type SummaryShiftCard,
} from '@carniceria/shared'
import SummaryScreen from '../SummaryScreen'

function card(partial: Partial<SummaryShiftCard> & Pick<SummaryShiftCard, 'id' | 'startedAt' | 'shiftType'>): SummaryShiftCard {
  return {
    cashierName: 'Admin Prueba',
    closedAt: partial.startedAt,
    openingCash: 0,
    cashLeft: null,
    withdrawn: null,
    soldTotal: null,
    cashTotal: null,
    cardWalletTotal: null,
    debtTotal: null,
    expenseTotal: null,
    contributionTotal: null,
    walletCashTotal: null,
    moneySnapshottedAt: null,
    live: false,
    ...partial,
  }
}

function withMoney(id: string, sold: number, startedAt: string, shiftType: 'morning' | 'evening'): SummaryShiftCard {
  return card({
    id,
    startedAt,
    shiftType,
    closedAt: startedAt,
    soldTotal: sold,
    cashTotal: sold,
    cardWalletTotal: 0,
    debtTotal: 0,
    expenseTotal: 0,
    contributionTotal: 0,
    walletCashTotal: 0,
    moneySnapshottedAt: startedAt,
  })
}

describe('SummaryScreen', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    window.hw = {
      getStores: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          { id: 'archivado', name: 'Archivado', archivedAt: '2026-01-01T00:00:00.000Z' },
          { id: 'norte', name: 'Local Norte' },
          { id: 'sur', name: 'Local Sur' },
        ],
      }),
      getAdminSummary: vi.fn().mockResolvedValue({
        ok: true,
        data: { shifts: [], visits: [], warning: null },
      }),
    } as unknown as typeof window.hw
  })

  it('arranca en todos los locales y en esta semana, y Hoy no vuelve a consultar', async () => {
    const user = userEvent.setup()
    render(<SummaryScreen onBack={vi.fn()} />)

    const week = mondayWeekRange(0)
    await waitFor(() => expect(window.hw.getAdminSummary).toHaveBeenCalledTimes(2))
    expect(window.hw.getAdminSummary).toHaveBeenCalledWith({
      storeId: 'norte',
      startIso: week.startIso,
      endIso: week.endIso,
    })
    expect(window.hw.getAdminSummary).toHaveBeenCalledWith({
      storeId: 'sur',
      startIso: week.startIso,
      endIso: week.endIso,
    })
    expect(screen.getByRole('button', { name: 'Local' })).toHaveTextContent('Todos los locales')
    expect(screen.queryByRole('option', { name: 'Archivado' })).not.toBeInTheDocument()

    const period = screen.getByRole('combobox', { name: 'Período' })
    expect(period).toHaveValue('week')
    const previousName = summaryMonthStep(1).name
    expect(screen.getByRole('option', { name: 'Hoy' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Esta semana' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Este mes' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: previousName })).toBeInTheDocument()

    await user.selectOptions(period, 'today')
    expect(window.hw.getAdminSummary).toHaveBeenCalledTimes(2)

    await user.selectOptions(period, 'previous')
    const previous = summaryPeriodQuery('previous')
    await waitFor(() => expect(window.hw.getAdminSummary).toHaveBeenCalledTimes(4))
    expect(window.hw.getAdminSummary).toHaveBeenCalledWith({
      storeId: 'norte',
      startIso: previous.startIso,
      endIso: previous.endIso,
    })
    expect(screen.getByRole('option', { name: 'Este mes' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: previousName })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hoy' })).not.toBeInTheDocument()
    expect(screen.queryByText(/puede faltar plata/i)).not.toBeInTheDocument()
  })

  it('suma los turnos del período y separa la caja sin ficha de la que cerró bien', async () => {
    const shifts = [
      withMoney('tarde-22', 2_141_692, '2026-10-22T21:00:00.000Z', 'evening'),
      withMoney('manana-22', 2_803_899, '2026-10-22T11:00:00.000Z', 'morning'),
      withMoney('tarde-21', 2_853_219, '2026-10-21T21:00:00.000Z', 'evening'),
      card({
        id: 'hoy',
        startedAt: '2026-10-28T21:00:00.000Z',
        shiftType: 'evening',
        closedAt: '2026-10-28T23:00:00.000Z',
      }),
    ]
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: {
        shifts: payload.storeId === 'norte' ? shifts : [],
        visits: [],
        warning: null,
      },
    }))
    render(<SummaryScreen onBack={vi.fn()} />)

    expect(await screen.findByText('Vendió')).toBeInTheDocument()
    expect(screen.getByText('Vendió').parentElement?.textContent?.replace(/\D/g, '')).toBe('7798810')
    expect(screen.queryByText('Aportes')).not.toBeInTheDocument()
    expect(screen.queryByText('Se fió')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Cajas' })).not.toBeInTheDocument()
    expect(screen.queryByText('sin anotar')).not.toBeInTheDocument()
    expect(screen.queryByText('todavía no llegó')).not.toBeInTheDocument()
    expect(screen.queryByText('cerró bien')).not.toBeInTheDocument()
    expect(screen.queryByText('No hay turnos cerrados.')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Medias reses' })).toBeInTheDocument()
    expect(screen.queryByText(/puede faltar plata/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/promedio/i)).not.toBeInTheDocument()
  })

  it('un día sin ficha no es una barra en cero y la caja incompleta no cerró bien', async () => {
    const week = mondayWeekRange(0)
    const iso = (offset: number) => new Date(`${addDaysYmd(week.startYmd, offset)}T12:00:00.000-03:00`).toISOString()
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: payload.storeId === 'norte'
        ? {
          shifts: [
            withMoney('lun', 1_000, iso(0), 'morning'),
            withMoney('mar', 0, iso(1), 'morning'),
            card({
              id: 'mie',
              startedAt: iso(2),
              shiftType: 'evening',
              closedAt: iso(2),
              cashLeft: 100,
              withdrawn: 100,
            }),
          ],
          visits: [{
            id: 'v',
            createdAt: iso(0),
            ymd: week.startYmd,
            providerName: 'Frigorífico',
            receivedByName: 'Ana',
            pieces: [],
            count: 3,
            kg: 90,
          }],
          warning: null,
          fiado: { debtNow: null, payments: null },
        }
        : { shifts: [], visits: [], warning: null, fiado: { debtNow: null, payments: null } },
    }))
    render(<SummaryScreen onBack={vi.fn()} />)
    expect(await screen.findByTitle(/Mié: todavía no llegó/)).toBeInTheDocument()
    expect(screen.getByTitle(/^Mar:/).getAttribute('title')).not.toMatch(/todavía/)
    expect(screen.getByTitle(/^Lun:/).getAttribute('title')).toMatch(/1/)
    expect(screen.queryByText('cerró bien')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Cajas' })).not.toBeInTheDocument()
    expect(screen.queryByText(/promedio/i)).not.toBeInTheDocument()
    expect(screen.getAllByText(/90\.000 kg/).length).toBeGreaterThan(0)
  })

  it('el cobro sin turno entra en cobranzas y no se suma otra vez a vendió', async () => {
    const user = userEvent.setup()
    const week = mondayWeekRange(0)
    const monday = new Date(`${week.startYmd}T12:00:00.000-03:00`).toISOString()
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: payload.storeId === 'norte'
        ? {
          shifts: [
            card({
              id: 'lun',
              startedAt: monday,
              shiftType: 'morning',
              closedAt: monday,
              soldTotal: 5_000,
              cashTotal: 1_000,
              cardWalletTotal: 0,
              debtTotal: 4_000,
              expenseTotal: 0,
              contributionTotal: 0,
              walletCashTotal: 0,
              moneySnapshottedAt: monday,
            }),
          ],
          visits: [],
          warning: null,
          fiado: {
            debtNow: 77_000,
            payments: [
              { amount: 12_000, createdAt: monday, shiftId: 'lun' },
              { amount: 8_000, createdAt: monday, shiftId: null },
            ],
          },
        }
        : { shifts: [], visits: [], warning: null, fiado: { debtNow: null, payments: null } },
    }))
    render(<SummaryScreen onBack={vi.fn()} />)
    expect(await screen.findByText('Cobros del período')).toBeInTheDocument()
    expect(screen.getByText('Vendió').parentElement?.textContent?.replace(/\D/g, '')).toBe('5000')
    expect(screen.getByText('Cobros del período').parentElement?.textContent?.replace(/\D/g, '')).toBe('20000')
    expect(screen.getByText('Deuda de ahora').parentElement?.textContent?.replace(/\D/g, '')).toBe('77000')
    expect(screen.getByText('Hay cobros sin turno. No entran en efectivo ni en tarjeta.')).toBeInTheDocument()
    expect(screen.queryByText(/ya están en efectivo/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/efectivo o tarjeta/i)).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Período' }), 'today')
    expect(screen.getByText('Deuda de ahora').parentElement?.textContent?.replace(/\D/g, '')).toBe('77000')
  })

  it('el modo de prueba no se consulta apagado y no llama al resumen encendido', async () => {
    vi.stubEnv('VITE_APP_ENV', 'dev')
    const user = userEvent.setup()
    render(<SummaryScreen onBack={vi.fn()} />)
    await waitFor(() => expect(window.hw.getAdminSummary).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/Hay cobros sin turno/)).not.toBeInTheDocument()
    const toggle = screen.getByRole('checkbox', { name: 'Datos de prueba' })
    await user.click(toggle)
    expect(window.hw.getAdminSummary).toHaveBeenCalledTimes(2)
    expect(await screen.findByText(/Hay cobros sin turno/)).toBeInTheDocument()
    await user.click(toggle)
    await waitFor(() => expect(window.hw.getAdminSummary).toHaveBeenCalledTimes(4))
    expect(screen.queryByText(/Hay cobros sin turno/)).not.toBeInTheDocument()
    vi.unstubAllEnvs()
  })

  it('sin pollo dice que no hay, y no muestra cero', async () => {
    render(<SummaryScreen onBack={vi.fn()} />)
    const empty = await screen.findByText('No hay pollo en este período.')
    const section = empty.closest('section')
    expect(section?.textContent).not.toMatch(/0 caj/)
    expect(section?.textContent).not.toMatch(/0\.000/)
    expect(screen.queryByText('Kilos brutos')).not.toBeInTheDocument()
  })

  it('muestra el pollo de cada local, con cajones y kilos brutos', async () => {
    const visit = {
      id: 'cajon',
      createdAt: '2026-11-10T15:00:00.000Z',
      ymd: '2026-11-10',
      providerName: 'Avícola del Norte',
      receivedByName: 'Luis',
      storeName: null,
      crates: 15,
      grossKg: 304.3,
      crateKg: [],
    }
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: {
        shifts: [],
        visits: [],
        warning: null,
        chicken: payload.storeId === 'norte'
          ? [visit]
          : [{ ...visit, id: 'cajon-sur', providerName: 'Avícola del Sur', crates: 2, grossKg: 40 }],
      },
    }))
    render(<SummaryScreen onBack={vi.fn()} />)
    expect(await screen.findByText('Kilos brutos')).toBeInTheDocument()
    expect(screen.getByText('Avícola del Norte')).toBeInTheDocument()
    expect(screen.getByText('Avícola del Sur')).toBeInTheDocument()
    expect(screen.getByText('Local Norte')).toBeInTheDocument()
    expect(screen.getByText('Local Sur')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('304.300 kg')).toBeInTheDocument()
    expect(screen.getByText('17 cajones · 344.300 kg brutos')).toBeInTheDocument()
    expect(screen.queryByText('No hay pollo en este período.')).not.toBeInTheDocument()
  })

  it('muestra débito sin corregirlo y avisa el turno que solo tiene el total', async () => {
    const base = {
      cashierName: 'Ana',
      shiftType: 'morning' as const,
      startedAt: '2026-11-10T12:00:00.000Z',
      closedAt: '2026-11-10T20:00:00.000Z',
      openingCash: 0,
      cashLeft: null,
      withdrawn: null,
      debtTotal: 0,
      expenseTotal: 0,
      contributionTotal: 0,
      walletCashTotal: 0,
      moneySnapshottedAt: '2026-11-10T20:00:00.000Z',
      live: false,
    }
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: {
        shifts: payload.storeId === 'norte'
          ? [
            {
              ...base,
              id: 'con-filas',
              soldTotal: 7000,
              cashTotal: 2000,
              cardWalletTotal: 5000,
              paymentSplit: { debit: 1000, wallet: 0, credit: 0 },
            },
            {
              ...base,
              id: 'solo-total',
              soldTotal: 3000,
              cashTotal: 0,
              cardWalletTotal: 3000,
              paymentSplit: null,
            },
            {
              ...base,
              id: 'sin-ficha',
              soldTotal: null,
              cashTotal: null,
              cardWalletTotal: null,
              debtTotal: null,
              expenseTotal: null,
              contributionTotal: null,
              walletCashTotal: null,
              moneySnapshottedAt: null,
              paymentSplit: null,
            },
          ]
          : [],
        visits: [],
        chicken: [],
        warning: null,
      },
    }))
    render(<SummaryScreen onBack={vi.fn()} />)
    expect(await screen.findByText('1 turno solo tiene el total')).toBeInTheDocument()
    expect(screen.getByText('Débito').parentElement?.textContent?.replace(/\D/g, '')).toBe('1000')
    expect(screen.getByText(/no suman el total de la ficha/)).toBeInTheDocument()
    expect(screen.getAllByText('Tarjeta y billetera').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('2 turnos solo tienen el total')).not.toBeInTheDocument()
  })

  it('si ningún turno tiene filas, el medio dice sin dato y no cero', async () => {
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: {
        shifts: payload.storeId === 'norte'
          ? [{
            id: 'solo',
            cashierName: 'Ana',
            shiftType: 'morning',
            startedAt: '2026-11-10T12:00:00.000Z',
            closedAt: '2026-11-10T20:00:00.000Z',
            openingCash: 0,
            cashLeft: null,
            withdrawn: null,
            soldTotal: 4000,
            cashTotal: 1000,
            cardWalletTotal: 3000,
            debtTotal: 0,
            expenseTotal: 0,
            contributionTotal: 0,
            walletCashTotal: 0,
            moneySnapshottedAt: '2026-11-10T20:00:00.000Z',
            live: false,
            paymentSplit: null,
          }]
          : [],
        visits: [],
        chicken: [],
        warning: null,
      },
    }))
    render(<SummaryScreen onBack={vi.fn()} />)
    expect(await screen.findByText('1 turno solo tiene el total')).toBeInTheDocument()
    expect(screen.getByText('Débito').nextElementSibling).toHaveTextContent('sin dato')
    expect(screen.getByText('Billetera virtual').nextElementSibling).toHaveTextContent('sin dato')
    expect(screen.getByText('Crédito').nextElementSibling).toHaveTextContent('sin dato')
    expect(screen.getByText('Efectivo').parentElement?.textContent?.replace(/\D/g, '')).toBe('1000')
  })
})
