import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  addDaysYmd,
  civilYmd,
  mondayWeekRange,
  summaryMonthStep,
  summaryPeriodQuery,
  soldHoursFromAmounts,
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

function hourAmounts(hour: number, amount: number): number[] {
  return Array.from({ length: 24 }, (_, index) => (index === hour ? amount : 0))
}

function withHours(
  id: string,
  startedAt: string,
  shiftType: 'morning' | 'evening',
  amounts: number[] | null,
  extra: Partial<SummaryShiftCard> = {},
): SummaryShiftCard {
  const sold = amounts?.reduce((acc, value) => acc + value, 0) ?? null
  return card({
    id,
    startedAt,
    shiftType,
    closedAt: startedAt,
    soldTotal: sold,
    cashTotal: sold,
    cardWalletTotal: sold == null ? null : 0,
    debtTotal: sold == null ? null : 0,
    expenseTotal: sold == null ? null : 0,
    contributionTotal: sold == null ? null : 0,
    walletCashTotal: sold == null ? null : 0,
    moneySnapshottedAt: sold == null ? null : startedAt,
    soldHours: amounts ? soldHoursFromAmounts(amounts) : null,
    ...extra,
  })
}

async function hourSection(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: 'Ventas por hora' })
  const section = heading.closest('section')
  if (!section) throw new Error('Falta la sección de horas')
  return section
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

  it('muestra el detalle de gastos y la diferencia si la ficha no tiene filas', async () => {
    const user = userEvent.setup()
    const at = '2026-11-10T15:00:00.000Z'
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: {
        shifts: payload.storeId === 'norte'
          ? [
            {
              id: 'con-gasto',
              cashierName: 'Ana',
              shiftType: 'morning',
              startedAt: at,
              closedAt: at,
              openingCash: 0,
              cashLeft: null,
              withdrawn: null,
              soldTotal: 0,
              cashTotal: 0,
              cardWalletTotal: 0,
              debtTotal: 0,
              expenseTotal: 100,
              contributionTotal: 0,
              walletCashTotal: 0,
              moneySnapshottedAt: at,
              live: false,
            },
            {
              id: 'sin-gasto',
              cashierName: 'Ana',
              shiftType: 'evening',
              startedAt: at,
              closedAt: at,
              openingCash: 0,
              cashLeft: null,
              withdrawn: null,
              soldTotal: 0,
              cashTotal: 0,
              cardWalletTotal: 0,
              debtTotal: 0,
              expenseTotal: 800,
              contributionTotal: 0,
              walletCashTotal: 0,
              moneySnapshottedAt: at,
              live: false,
            },
          ]
          : [],
        visits: [],
        chicken: [],
        expenses: payload.storeId === 'norte'
          ? [{
            id: 'hielo',
            shiftId: 'con-gasto',
            createdAt: at,
            concept: 'Hielo',
            providerName: null,
            amount: 100,
            notes: 'barra',
            kind: 'expense',
          }]
          : [],
        warning: null,
      },
    }))
    window.hw.getSummaryExpenses = vi.fn().mockResolvedValue({ ok: true, data: [] })
    render(<SummaryScreen onBack={vi.fn()} />)
    expect(await screen.findByText(/La ficha llegó sin las filas de gastos/)).toBeInTheDocument()
    expect(screen.getByText('Hielo').closest('[aria-hidden]')).toHaveAttribute('aria-hidden', 'true')
    await user.click(await screen.findByRole('button', { name: 'Ver detalle de gastos' }))
    expect(await screen.findByText('Hielo')).toBeInTheDocument()
    expect(screen.getByText('Hielo').closest('[aria-hidden]')).toHaveAttribute('aria-hidden', 'false')
    expect(screen.getByText('Gasto')).toBeInTheDocument()
    expect(screen.getByText('Sin proveedor')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ocultar detalle' }))
    expect(screen.getByText('Hielo').closest('[aria-hidden]')).toHaveAttribute('aria-hidden', 'true')
    await user.click(screen.getByRole('button', { name: 'Ver detalle de gastos' }))
    await user.click(screen.getByRole('button', { name: 'Agrupado' }))
    expect(screen.getByText('Por origen')).toBeInTheDocument()
    expect(screen.getByText('Por concepto')).toBeInTheDocument()
    expect(screen.getAllByText('Gastos').length).toBeGreaterThan(0)
  })

  it('el botón pide solo los gastos de los turnos que están en pantalla', async () => {
    const user = userEvent.setup()
    const todayId = '11111111-1111-4111-8111-111111111111'
    const otherDayId = '22222222-2222-4222-8222-222222222222'
    const today = `${civilYmd()}T15:00:00.000Z`
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: {
        shifts: payload.storeId === 'norte'
          ? [
            withMoney(todayId, 1000, today, 'morning'),
            withMoney(otherDayId, 2000, '2026-10-01T15:00:00.000Z', 'morning'),
          ]
          : [],
        visits: [],
        expenses: [],
        warning: null,
      },
    }))
    window.hw.getSummaryExpenses = vi.fn().mockResolvedValue({ ok: true, data: [] })

    render(<SummaryScreen onBack={vi.fn()} />)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Período' }), 'today')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ver detalle de gastos' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Ver detalle de gastos' }))

    expect(window.hw.getSummaryExpenses).toHaveBeenCalledTimes(1)
    expect(window.hw.getSummaryExpenses).toHaveBeenCalledWith({
      shifts: [{ id: todayId, storeId: 'norte', startedAt: today }],
    })
  })

  it('Hoy arma las horas con la ficha y no pide las ventas', async () => {
    const user = userEvent.setup()
    const today = `${civilYmd()}T15:00:00.000Z`
    const amounts = hourAmounts(12, 1500)
    amounts[19] = 800
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: {
        shifts: payload.storeId === 'norte'
          ? [withHours('hoy', today, 'morning', amounts, { cashierName: 'Ana' })]
          : [],
        visits: [],
        warning: null,
      },
    }))

    render(<SummaryScreen onBack={vi.fn()} />)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Período' }), 'today')

    expect(await screen.findByRole('heading', { name: 'Ventas por hora' })).toBeInTheDocument()
    expect(screen.getByText('12h')).toBeInTheDocument()
    expect(screen.getByText('15h')).toBeInTheDocument()
    expect(screen.getByText('19h')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ventas por día' })).not.toBeInTheDocument()
    expect('getSummarySaleHours' in window.hw).toBe(false)
  })

  it('un turno abierto avisa y no muestra el gráfico', async () => {
    const user = userEvent.setup()
    const today = `${civilYmd()}T15:00:00.000Z`
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: {
        shifts: payload.storeId === 'norte'
          ? [withHours('abierto', today, 'evening', hourAmounts(12, 5000), {
            cashierName: 'Ana',
            closedAt: null,
            live: true,
          })]
          : [],
        visits: [],
        warning: null,
      },
    }))

    render(<SummaryScreen onBack={vi.fn()} />)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Período' }), 'today')
    const section = within(await hourSection())
    expect(section.getByText('Tarde · Local Norte · Ana: Disponible cuando se cierre el turno')).toBeInTheDocument()
    expect(section.queryByText('12h')).not.toBeInTheDocument()
    expect(section.queryByText('sin dato')).not.toBeInTheDocument()
    expect(section.queryByText('No hay ventas en este día')).not.toBeInTheDocument()
  })

  it('una ficha vieja dice sin dato', async () => {
    const user = userEvent.setup()
    const today = `${civilYmd()}T15:00:00.000Z`
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: {
        shifts: payload.storeId === 'norte'
          ? [withMoney('vieja', 1000, today, 'morning')]
          : [],
        visits: [],
        warning: null,
      },
    }))

    render(<SummaryScreen onBack={vi.fn()} />)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Período' }), 'today')
    const section = within(await hourSection())
    expect(section.getByText('sin dato')).toBeInTheDocument()
    expect(section.queryByText('12h')).not.toBeInTheDocument()
  })

  it('veinticuatro ceros dicen que no hubo ventas', async () => {
    const user = userEvent.setup()
    const today = `${civilYmd()}T15:00:00.000Z`
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: {
        shifts: payload.storeId === 'norte'
          ? [withHours('vacia', today, 'morning', Array.from({ length: 24 }, () => 0))]
          : [],
        visits: [],
        warning: null,
      },
    }))

    render(<SummaryScreen onBack={vi.fn()} />)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Período' }), 'today')
    const section = within(await hourSection())
    expect(section.getByText('No hay ventas en este día')).toBeInTheDocument()
    expect(section.queryByText('sin dato')).not.toBeInTheDocument()
  })

  it('el día con un turno cerrado y otro abierto grafica el cerrado y nombra al abierto', async () => {
    const user = userEvent.setup()
    const today = `${civilYmd()}T15:00:00.000Z`
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: {
        shifts: payload.storeId === 'norte'
          ? [
            withHours('manana', today, 'morning', hourAmounts(12, 1500), { cashierName: 'Ana' }),
            withHours('tarde', today, 'evening', null, { cashierName: 'Luis', closedAt: null, live: true }),
          ]
          : [],
        visits: [],
        warning: null,
      },
    }))

    render(<SummaryScreen onBack={vi.fn()} />)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Período' }), 'today')
    const section = within(await hourSection())
    expect(section.getByText('12h')).toBeInTheDocument()
    expect(section.getByText('Tarde · Local Norte · Luis: Disponible cuando se cierre el turno')).toBeInTheDocument()
  })

  it('la semana no cuenta el día incompleto y muestra cuántos quedaron afuera', async () => {
    const week = mondayWeekRange(0)
    const at = (offset: number) => new Date(`${addDaysYmd(week.startYmd, offset)}T12:00:00.000-03:00`).toISOString()
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: {
        shifts: payload.storeId === 'norte'
          ? [
            withHours('lun', at(0), 'morning', hourAmounts(10, 2000), { cashierName: 'Ana' }),
            withHours('mar', at(1), 'morning', hourAmounts(18, 9000), { cashierName: 'Ana' }),
            withHours('mar-tarde', at(1), 'evening', null, { cashierName: 'Luis', closedAt: null, live: true }),
          ]
          : [],
        visits: [],
        warning: null,
      },
    }))

    render(<SummaryScreen onBack={vi.fn()} />)
    const section = within(await hourSection())
    expect(section.getByText('10h')).toBeInTheDocument()
    expect(section.queryByText('18h')).not.toBeInTheDocument()
    expect(section.getByText('1 día no se contó por estar incompleto')).toBeInTheDocument()
    expect(section.getByText(/Pico: 10h/)).toBeInTheDocument()
    expect(section.getByText('Tarde · Local Norte · Luis: Disponible cuando se cierre el turno')).toBeInTheDocument()
  })

  it('la cuenta resta los gastos a proveedores y no los vuelve a sumar', async () => {
    const week = mondayWeekRange(0)
    const at = new Date(`${week.startYmd}T12:00:00.000-03:00`).toISOString()
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: payload.storeId === 'norte'
        ? {
          shifts: [card({
            id: 'lun',
            startedAt: at,
            shiftType: 'morning',
            soldTotal: 10_000,
            cashTotal: 10_000,
            cardWalletTotal: 0,
            debtTotal: 0,
            expenseTotal: 800,
            contributionTotal: 0,
            walletCashTotal: 0,
            moneySnapshottedAt: at,
            providerExpenseTotal: 700,
          })],
          visits: [],
          purchases: [{
            createdAt: at,
            lines: [{ costTotal: 500, moneyRole: 'payable' as const }],
          }],
          warning: null,
          fiado: { debtNow: null, payments: null },
        }
        : { shifts: [], visits: [], purchases: [], warning: null, fiado: { debtNow: null, payments: null } },
    }))
    render(<SummaryScreen onBack={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Cuenta' })).toBeInTheDocument()
    expect(screen.getByText('Ventas').nextElementSibling?.textContent?.replace(/\D/g, '')).toBe('10000')
    expect(screen.getByText('Compras').nextElementSibling?.textContent?.replace(/\D/g, '')).toBe('500')
    expect(screen.getByText('Otros gastos').nextElementSibling?.textContent?.replace(/\D/g, '')).toBe('100')
    expect(screen.getByText('Ventas menos compras y gastos').nextElementSibling?.textContent?.replace(/\D/g, '')).toBe('9400')
    expect(screen.queryByText(/ganancia|pérdida|perdida/i)).not.toBeInTheDocument()
    expect(window.hw.getSummaryExpenses).toBeUndefined()
  })

  it('la ficha sin el número queda sin dato y la media res sin precio avisa', async () => {
    const user = userEvent.setup()
    const week = mondayWeekRange(0)
    const at = new Date(`${week.startYmd}T12:00:00.000-03:00`).toISOString()
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: payload.storeId === 'norte'
        ? {
          shifts: [card({
            id: 'vieja',
            startedAt: at,
            shiftType: 'morning',
            soldTotal: 9_000,
            cashTotal: 9_000,
            cardWalletTotal: 0,
            debtTotal: 0,
            expenseTotal: 100,
            contributionTotal: 0,
            walletCashTotal: 0,
            moneySnapshottedAt: at,
            providerExpenseTotal: null,
          })],
          visits: [{
            id: 'media',
            createdAt: at,
            ymd: week.startYmd,
            providerName: 'Frigorífico',
            receivedByName: 'Ana',
            pieces: [{ kg: 90 }],
            count: 1,
            kg: 90,
            cost: null,
          }],
          purchases: [{
            createdAt: at,
            lines: [{ costTotal: 0, moneyRole: 'none' as const, mediaRes: true }],
          }],
          warning: null,
          fiado: { debtNow: null, payments: null },
        }
        : { shifts: [], visits: [], purchases: [], warning: null, fiado: { debtNow: null, payments: null } },
    }))
    render(<SummaryScreen onBack={vi.fn()} />)
    expect(await screen.findByText('1 turno quedó afuera: la ficha no tiene el dato de gastos a proveedores.')).toBeInTheDocument()
    expect(screen.getByText('Ventas').nextElementSibling).toHaveTextContent('sin dato')
    expect(screen.getByText('Otros gastos').nextElementSibling).toHaveTextContent('sin dato')
    expect(screen.getByText('Ventas menos compras y gastos').nextElementSibling).toHaveTextContent('incompleta')
    expect(screen.getByText('1 ingreso de media res sin precio no suma')).toBeInTheDocument()
    const day = `${week.startYmd.slice(8, 10)}/${week.startYmd.slice(5, 7)}`
    await user.click(screen.getByRole('button', { name: new RegExp(day) }))
    expect(screen.getByText('sin precio')).toBeInTheDocument()
    expect(screen.getByText('Compras').nextElementSibling?.textContent?.replace(/\D/g, '')).toBe('0')
  })

  it('sin ingresos de mercadería, Compras es cero y no sin dato', async () => {
    const week = mondayWeekRange(0)
    const at = new Date(`${week.startYmd}T12:00:00.000-03:00`).toISOString()
    window.hw.getAdminSummary = vi.fn().mockImplementation(async (payload: { storeId: string }) => ({
      ok: true,
      data: payload.storeId === 'norte'
        ? {
          shifts: [card({
            id: 'lun',
            startedAt: at,
            shiftType: 'morning',
            soldTotal: 2_000,
            cashTotal: 2_000,
            cardWalletTotal: 0,
            debtTotal: 0,
            expenseTotal: 40,
            contributionTotal: 0,
            walletCashTotal: 0,
            moneySnapshottedAt: at,
            providerExpenseTotal: 0,
          })],
          visits: [],
          purchases: [],
          warning: null,
          fiado: { debtNow: null, payments: null },
        }
        : { shifts: [], visits: [], purchases: [], warning: null, fiado: { debtNow: null, payments: null } },
    }))
    render(<SummaryScreen onBack={vi.fn()} />)
    expect(await screen.findByText('Compras')).toBeInTheDocument()
    const compras = screen.getByText('Compras').nextElementSibling?.textContent ?? ''
    expect(compras).not.toMatch(/sin dato/i)
    expect(compras.replace(/\D/g, '')).toBe('0')
  })
})
