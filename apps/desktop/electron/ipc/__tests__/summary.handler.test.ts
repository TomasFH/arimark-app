import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import {
  customers,
  debtEvents,
  merchandiseIntakeLines,
  merchandiseIntakes,
  expenses,
  merchWeekPulls,
  salePayments,
  sales,
  shifts,
  stores,
  users,
} from '../../db/schema'
import { eq } from 'drizzle-orm'
import {
  addDaysYmd,
  civilYmd,
  mondayWeekRange,
  summarizeExpenses,
  summaryMoneyView,
  summaryMonthSpan,
  sumCollections,
  type ShiftMoneyParts,
  type SoldHourBucket,
  type SummaryExpenseInput,
} from '@carniceria/shared'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('../../activeSession', () => ({
  getActiveSession: vi.fn(),
}))

vi.mock('../../licensing/firebase', () => ({
  isFirebaseAvailable: vi.fn(() => false),
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn(() => ({ tenant_id: 'tenant-test' })),
}))

vi.mock('../../licensing/merchIntakeSync', () => ({
  pullMerchandiseIntakesForStoreWeek: vi.fn(async () => 0),
}))

vi.mock('../../licensing/summaryRemote', () => ({
  fetchRemoteSummaryShifts: vi.fn(async () => []),
  fetchRemoteShiftMoney: vi.fn(async () => new Map()),
  fetchRemoteExpenseLines: vi.fn(async () => []),
  fetchRemoteSaleStamps: vi.fn(async () => []),
  writeRemoteShiftMoney: vi.fn(async () => {}),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { isFirebaseAvailable } from '../../licensing/firebase'
import { pullMerchandiseIntakesForStoreWeek } from '../../licensing/merchIntakeSync'
import { registerSummaryHandlers } from '../summary.handler'
import type { AdminSummaryData } from '../../summary/loadAdminSummary'
import {
  fetchRemoteExpenseLines,
  fetchRemoteSaleStamps,
  fetchRemoteShiftMoney,
  fetchRemoteSummaryShifts,
  writeRemoteShiftMoney,
  type RemoteSummaryShift,
} from '../../licensing/summaryRemote'

type HandlerFn = (_event: unknown, payload?: unknown) => Promise<{ ok: boolean; data?: AdminSummaryData; code?: string }>
type ExpenseHandlerFn = (_event: unknown, payload?: unknown) => Promise<{ ok: boolean; data?: SummaryExpenseInput[]; code?: string }>

function getHandler(): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === 'ipc:get-admin-summary')
  if (!call) throw new Error('Handler no registrado')
  return call[1] as HandlerFn
}

function getExpenseHandler(): ExpenseHandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === 'ipc:get-summary-expenses')
  if (!call) throw new Error('Handler de gastos no registrado')
  return call[1] as ExpenseHandlerFn
}

type SaleHourHandlerFn = (_event: unknown, payload?: unknown) => Promise<{ ok: boolean; data?: SoldHourBucket[]; code?: string }>

function getSaleHourHandler(): SaleHourHandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === 'ipc:get-summary-sale-hours')
  if (!call) throw new Error('Handler de horas no registrado')
  return call[1] as SaleHourHandlerFn
}

const STORE_ID = 'store-001'
const OTHER_STORE = 'store-002'
const USER_ID = 'user-001'
const ADMIN = { userId: USER_ID, storeId: STORE_ID, role: 'admin' as const, shiftId: null }

describe('summary.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const result = await createInMemoryDb()
    db = result.db
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(ADMIN as unknown as ReturnType<typeof getActiveSession>)
    vi.mocked(isFirebaseAvailable).mockReturnValue(false)
    registerSummaryHandlers()
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(stores).values({ id: STORE_ID, name: 'Centro', address: 'Calle 1', createdAt: now }).run()
    db.insert(stores).values({ id: OTHER_STORE, name: 'Norte', address: 'Calle 2', createdAt: now }).run()
    db.insert(users).values({ id: USER_ID, storeId: STORE_ID, name: 'Ana', active: true, createdAt: now }).run()
  })

  it('rechaza un payload malformado', async () => {
    const res = await getHandler()(null, { storeId: '' })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('INVALID_PAYLOAD')
  })

  it('rechaza a una cajera', async () => {
    vi.mocked(getActiveSession).mockReturnValue({ ...ADMIN, role: 'cashier' } as unknown as ReturnType<typeof getActiveSession>)
    const week = mondayWeekRange(0)
    const res = await getHandler()(null, { storeId: STORE_ID, startIso: week.startIso, endIso: week.endIso })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('FORBIDDEN')
  })

  it('rechaza si no hay sesión', async () => {
    vi.mocked(getActiveSession).mockReturnValue(null)
    const week = mondayWeekRange(0)
    const res = await getHandler()(null, { storeId: STORE_ID, startIso: week.startIso, endIso: week.endIso })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('NO_SESSION')
  })

  it('rechaza un local que no existe', async () => {
    const week = mondayWeekRange(0)
    const res = await getHandler()(null, { storeId: 'no-esta', startIso: week.startIso, endIso: week.endIso })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('NOT_FOUND')
  })

  it('devuelve la ficha de ese local y solo las medias reses', async () => {
    const week = mondayWeekRange(-30)
    db.insert(shifts).values({
      id: 'shift-aqui',
      storeId: STORE_ID,
      userId: USER_ID,
      shiftType: 'morning',
      startedAt: week.startIso,
      closedAt: week.endInclusiveYmd + 'T18:00:00.000Z',
      openingCash: 1000,
      cashLeft: 200,
      deliveredAmount: 800,
      soldTotal: 5000,
      cashTotal: 3000,
      cardWalletTotal: 1500,
      debtTotal: 500,
      expenseTotal: 100,
      contributionTotal: 0,
      walletCashTotal: 0,
      moneySnapshottedAt: week.startIso,
      openedLocally: false,
    }).run()
    db.insert(shifts).values({
      id: 'shift-otro',
      storeId: OTHER_STORE,
      userId: USER_ID,
      shiftType: 'morning',
      startedAt: week.startIso,
      closedAt: week.startIso,
      openingCash: 0,
      soldTotal: 999,
      cashTotal: 999,
      cardWalletTotal: 0,
      debtTotal: 0,
      expenseTotal: 0,
      contributionTotal: 0,
      walletCashTotal: 0,
      moneySnapshottedAt: week.startIso,
    }).run()
    db.insert(merchandiseIntakes).values({
      id: 'ing-1',
      storeId: STORE_ID,
      shiftId: 'shift-aqui',
      paymentKind: 'none',
      paidAmount: 0,
      debtAmount: 0,
      providerName: 'Frigorífico',
      createdBy: USER_ID,
      createdAt: week.startIso,
      status: 'confirmed',
    }).run()
    db.insert(merchandiseIntakeLines).values({
      id: 'line-res',
      intakeId: 'ing-1',
      rubroId: 'rubro_media_res',
      rubroName: 'Media res',
      template: 'pieces_weight',
      sortOrder: 0,
      count: 2,
      netKg: 80,
      weightsJson: '[40,40]',
    }).run()
    db.insert(merchandiseIntakeLines).values({
      id: 'line-pollo',
      intakeId: 'ing-1',
      rubroId: 'rubro_pollo_entero',
      rubroName: 'Pollo',
      template: 'packs',
      sortOrder: 1,
      count: 1,
      netKg: 10,
      weightsJson: '[10]',
    }).run()

    const res = await getHandler()(null, { storeId: STORE_ID, startIso: week.startIso, endIso: week.endIso })
    expect(res.ok).toBe(true)
    expect(res.data?.shifts.map(shift => shift.id)).toEqual(['shift-aqui'])
    expect(res.data?.shifts[0]?.soldTotal).toBe(5000)
    expect(res.data?.shifts[0]?.cashierName).toBe('Ana')
    expect(res.data?.visits).toHaveLength(1)
    expect(res.data?.visits[0]?.count).toBe(2)
    expect(res.data?.visits[0]?.kg).toBe(80)
    expect(res.data?.chicken).toEqual([expect.objectContaining({ crates: 1, grossKg: 10 })])
    expect(pullMerchandiseIntakesForStoreWeek).not.toHaveBeenCalled()
  })

  it('suma el cajón de pollo y la media res del catálogo, y deja afuera el corte por kilo', async () => {
    const week = mondayWeekRange(-30)
    db.insert(shifts).values({
      id: 'shift-pollo',
      storeId: STORE_ID,
      userId: USER_ID,
      shiftType: 'morning',
      startedAt: week.startIso,
      closedAt: week.startIso,
      openingCash: 0,
    }).run()
    db.insert(merchandiseIntakes).values({
      id: 'ing-pollo',
      storeId: STORE_ID,
      shiftId: 'shift-pollo',
      paymentKind: 'none',
      paidAmount: 0,
      debtAmount: 0,
      providerName: 'Avícola',
      createdBy: USER_ID,
      createdAt: week.startIso,
      status: 'confirmed',
    }).run()
    db.insert(merchandiseIntakeLines).values({
      id: 'line-cajon',
      intakeId: 'ing-pollo',
      rubroId: 'custom:cajon de pollo',
      rubroName: 'Cajón de Pollo',
      nameKey: 'cajon de pollo',
      template: 'pieces_weight',
      costUnit: 'pack',
      packCount: 15,
      sortOrder: 0,
      count: 15,
      grossKg: 304.3,
      netKg: 304.3,
      weightsJson: null,
    }).run()
    db.insert(merchandiseIntakeLines).values({
      id: 'line-mila',
      intakeId: 'ing-pollo',
      rubroId: 'prod-mila',
      rubroName: 'Milanesa de pollo',
      nameKey: 'milanesa de pollo',
      template: 'weight',
      costUnit: 'kg',
      sortOrder: 1,
      count: 1,
      netKg: 4,
      weightsJson: '[4]',
    }).run()
    db.insert(merchandiseIntakeLines).values({
      id: 'line-catalogo',
      intakeId: 'ing-pollo',
      rubroId: 'prod-media-res',
      rubroName: 'Media res',
      nameKey: 'media res',
      template: 'pieces_weight',
      sortOrder: 2,
      count: 2,
      netKg: 188,
      weightsJson: null,
    }).run()
    db.insert(merchandiseIntakeLines).values({
      id: 'line-corte',
      intakeId: 'ing-pollo',
      rubroId: 'prod-asado',
      rubroName: 'Asado media res',
      nameKey: 'asado media res',
      template: 'weight',
      costUnit: 'kg',
      sortOrder: 3,
      count: 1,
      netKg: 6.5,
      weightsJson: '[6.5]',
    }).run()

    const res = await getHandler()(null, { storeId: STORE_ID, startIso: week.startIso, endIso: week.endIso })
    expect(res.ok).toBe(true)
    expect(res.data?.chicken).toEqual([expect.objectContaining({
      providerName: 'Avícola',
      crates: 15,
      grossKg: 304.3,
    })])
    expect(res.data?.visits).toEqual([expect.objectContaining({ count: 2, kg: 188, pieces: [] })])
    expect(pullMerchandiseIntakesForStoreWeek).not.toHaveBeenCalled()
  })

  it('deja el total de la ficha si las filas no coinciden, y no inventa desglose sin filas', async () => {
    const week = mondayWeekRange(-30)
    const at = week.startIso
    db.insert(shifts).values({
      id: 'shift-distinto',
      storeId: STORE_ID,
      userId: USER_ID,
      shiftType: 'morning',
      startedAt: at,
      closedAt: at,
      openingCash: 0,
      soldTotal: 5000,
      cashTotal: 0,
      cardWalletTotal: 5000,
      debtTotal: 0,
      expenseTotal: 0,
      contributionTotal: 0,
      walletCashTotal: 0,
      moneySnapshottedAt: at,
    }).run()
    db.insert(shifts).values({
      id: 'shift-solo',
      storeId: STORE_ID,
      userId: USER_ID,
      shiftType: 'evening',
      startedAt: at,
      closedAt: at,
      openingCash: 0,
      soldTotal: 2000,
      cashTotal: 0,
      cardWalletTotal: 2000,
      debtTotal: 0,
      expenseTotal: 0,
      contributionTotal: 0,
      walletCashTotal: 0,
      moneySnapshottedAt: at,
    }).run()
    db.insert(sales).values({
      id: 'sale-distinto',
      storeId: STORE_ID,
      shiftId: 'shift-distinto',
      total: 1000,
      status: 'confirmed',
      createdAt: at,
      createdBy: USER_ID,
    }).run()
    db.insert(salePayments).values({
      id: 'pay-distinto',
      saleId: 'sale-distinto',
      paymentMethod: 'debit',
      amount: 1000,
      createdAt: at,
      createdBy: USER_ID,
    }).run()

    const res = await getHandler()(null, { storeId: STORE_ID, startIso: week.startIso, endIso: week.endIso })
    expect(res.ok).toBe(true)
    const distinto = res.data?.shifts.find(shift => shift.id === 'shift-distinto')
    const solo = res.data?.shifts.find(shift => shift.id === 'shift-solo')
    expect(distinto?.cardWalletTotal).toBe(5000)
    expect(distinto?.paymentSplit).toEqual({ debit: 1000, wallet: 0, credit: 0 })
    expect(solo?.cardWalletTotal).toBe(2000)
    expect(solo?.paymentSplit).toBeNull()
  })

  it('devuelve los gastos de los turnos del rango y no arma filas que no están', async () => {
    const week = mondayWeekRange(-30)
    const at = week.startIso
    db.insert(shifts).values({
      id: 'shift-gastos',
      storeId: STORE_ID,
      userId: USER_ID,
      shiftType: 'morning',
      startedAt: at,
      closedAt: at,
      openingCash: 0,
      soldTotal: 0,
      cashTotal: 0,
      cardWalletTotal: 0,
      debtTotal: 0,
      expenseTotal: 300,
      contributionTotal: 0,
      walletCashTotal: 0,
      moneySnapshottedAt: at,
    }).run()
    db.insert(shifts).values({
      id: 'shift-sin-filas',
      storeId: STORE_ID,
      userId: USER_ID,
      shiftType: 'evening',
      startedAt: at,
      closedAt: at,
      openingCash: 0,
      soldTotal: 0,
      cashTotal: 0,
      cardWalletTotal: 0,
      debtTotal: 0,
      expenseTotal: 800,
      contributionTotal: 0,
      walletCashTotal: 0,
      moneySnapshottedAt: at,
    }).run()
    db.insert(shifts).values({
      id: 'shift-otro-fuera',
      storeId: OTHER_STORE,
      userId: USER_ID,
      shiftType: 'morning',
      startedAt: at,
      openingCash: 0,
    }).run()
    db.insert(expenses).values([
      { id: 'exp-hielo', storeId: STORE_ID, shiftId: 'shift-gastos', concept: 'Hielo', amount: 100, kind: 'expense', createdAt: at, createdBy: USER_ID },
      { id: 'exp-vale', storeId: STORE_ID, shiftId: 'shift-gastos', concept: 'Vale: Ana', amount: 200, kind: 'expense', createdAt: at, createdBy: USER_ID },
      { id: 'exp-aporte', storeId: STORE_ID, shiftId: 'shift-gastos', concept: 'Aporte', amount: 999, kind: 'inject', injectReason: 'aporte', createdAt: at, createdBy: USER_ID },
      { id: 'exp-otro', storeId: OTHER_STORE, shiftId: 'shift-otro-fuera', concept: 'Ajeno', amount: 50, kind: 'expense', createdAt: at, createdBy: USER_ID },
    ]).run()

    const res = await getHandler()(null, { storeId: STORE_ID, startIso: week.startIso, endIso: week.endIso })
    expect(res.ok).toBe(true)
    expect(res.data?.expenses.map(row => row.id).sort()).toEqual(['exp-aporte', 'exp-hielo', 'exp-vale'])
    const view = summarizeExpenses(res.data?.expenses ?? [], res.data?.shifts ?? [])
    expect(view.rows.map(row => row.concept)).toEqual(['Hielo', 'Vale: Ana'])
    expect(view.rowTotal).toBe(300)
    expect(view.gap).toMatchObject({ difference: 800, shiftIds: ['shift-sin-filas'] })
  })

  it('la semana en curso se vuelve a pedir aunque ya esté marcada', async () => {
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    const week = mondayWeekRange(0)
    db.insert(merchWeekPulls).values({
      storeId: STORE_ID,
      weekStartIso: week.startIso,
      pulledAt: '2020-01-01T00:00:00.000Z',
    }).run()
    const res = await getHandler()(null, { storeId: STORE_ID, startIso: week.startIso, endIso: week.endIso })
    expect(res.ok).toBe(true)
    expect(pullMerchandiseIntakesForStoreWeek).toHaveBeenCalledWith(
      'tenant-test',
      STORE_ID,
      week.startIso,
      week.endIso,
    )
  })

  it('una semana cerrada ya marcada no se vuelve a bajar', async () => {
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    const week = mondayWeekRange(-30)
    db.insert(merchWeekPulls).values({
      storeId: STORE_ID,
      weekStartIso: week.startIso,
      pulledAt: '2020-01-01T00:00:00.000Z',
    }).run()
    const res = await getHandler()(null, { storeId: STORE_ID, startIso: week.startIso, endIso: week.endIso })
    expect(res.ok).toBe(true)
    expect(pullMerchandiseIntakesForStoreWeek).not.toHaveBeenCalled()
    const mark = db.select().from(merchWeekPulls).where(eq(merchWeekPulls.storeId, STORE_ID)).all()
    expect(mark).toHaveLength(1)
    expect(mark[0]?.pulledAt).toBe('2020-01-01T00:00:00.000Z')
  })

  it('octubre incluye el 21, el 22 y el 1/11, y deja afuera el 1 al 4', async () => {
    const october = summaryMonthSpan(2026, 10)
    const rows: { id: string; ymd: string; sold: number; shiftType: 'morning' | 'evening'; hour: number }[] = [
      { id: 'oct-01', ymd: '2026-10-01', sold: 1, shiftType: 'evening', hour: 18 },
      { id: 'oct-04', ymd: '2026-10-04', sold: 2, shiftType: 'evening', hour: 18 },
      { id: 'oct-21', ymd: '2026-10-21', sold: 2_853_219, shiftType: 'evening', hour: 18 },
      { id: 'oct-22-m', ymd: '2026-10-22', sold: 2_803_899, shiftType: 'morning', hour: 9 },
      { id: 'oct-22-t', ymd: '2026-10-22', sold: 2_141_692, shiftType: 'evening', hour: 18 },
      { id: 'nov-01', ymd: '2026-11-01', sold: 7, shiftType: 'morning', hour: 9 },
      { id: 'nov-02', ymd: '2026-11-02', sold: 9, shiftType: 'evening', hour: 18 },
    ]
    for (const row of rows) {
      const startedAt = new Date(`${row.ymd}T${String(row.hour).padStart(2, '0')}:00:00.000-03:00`).toISOString()
      db.insert(shifts).values({
        id: row.id,
        storeId: STORE_ID,
        userId: USER_ID,
        shiftType: row.shiftType,
        startedAt,
        closedAt: new Date(`${row.ymd}T21:00:00.000-03:00`).toISOString(),
        openingCash: 0,
        soldTotal: row.sold,
        cashTotal: row.sold,
        cardWalletTotal: 0,
        debtTotal: 0,
        expenseTotal: 0,
        contributionTotal: 0,
        walletCashTotal: 0,
        moneySnapshottedAt: startedAt,
        openedLocally: false,
      }).run()
    }

    const res = await getHandler()(null, {
      storeId: STORE_ID,
      startIso: october.startIso,
      endIso: october.endIso,
    })
    expect(res.ok).toBe(true)
    const ids = (res.data?.shifts ?? []).map(shift => shift.id).sort()
    expect(ids).toEqual(['nov-01', 'oct-21', 'oct-22-m', 'oct-22-t'])
    const view = summaryMoneyView(res.data?.shifts ?? [])
    expect(view.boxes).toHaveLength(4)
    expect(view.lines[0]?.amount).toBe(2_853_219 + 2_803_899 + 2_141_692 + 7)
    expect(new Set(view.boxes.map(row => row.cashierName))).toEqual(new Set(['Ana']))
  })

  it('suma los turnos remotos del mismo local aunque esta PC solo tenga uno', async () => {
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    const october = summaryMonthSpan(2026, 10)
    const startedAt = new Date('2026-10-22T18:00:00.000-03:00').toISOString()
    db.insert(shifts).values({
      id: 'oct-22-t',
      storeId: STORE_ID,
      userId: USER_ID,
      shiftType: 'evening',
      startedAt,
      closedAt: new Date('2026-10-22T21:00:00.000-03:00').toISOString(),
      openingCash: 0,
      soldTotal: 2_141_692,
      cashTotal: 2_141_692,
      cardWalletTotal: 0,
      debtTotal: 0,
      expenseTotal: 0,
      contributionTotal: 0,
      walletCashTotal: 0,
      moneySnapshottedAt: startedAt,
      openedLocally: false,
    }).run()
    vi.mocked(fetchRemoteSummaryShifts).mockResolvedValue([
      remoteCard('oct-22-t', '2026-10-22T18:00:00.000-03:00', 'evening', 2_141_692),
      remoteCard('oct-22-m', '2026-10-22T09:00:00.000-03:00', 'morning', 2_803_899),
      remoteCard('oct-21', '2026-10-21T18:00:00.000-03:00', 'evening', 2_853_219),
    ])

    const res = await getHandler()(null, {
      storeId: STORE_ID,
      startIso: october.startIso,
      endIso: october.endIso,
    })
    expect(res.ok).toBe(true)
    expect(res.data?.warning ?? '').not.toMatch(/Puede faltar plata/)
    const view = summaryMoneyView(res.data?.shifts ?? [])
    expect(view.boxes.map(row => row.id).sort()).toEqual(['oct-21', 'oct-22-m', 'oct-22-t'])
    expect(view.lines[0]?.amount).toBe(2_141_692 + 2_803_899 + 2_853_219)
  })

  it('completa la plata de ayer y no trata el turno de hoy sin ficha como cero', async () => {
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    const today = civilYmd(new Date())
    const yesterday = addDaysYmd(today, -1)
    const yStart = new Date(`${yesterday}T15:00:00.000-03:00`).toISOString()
    const yEnd = new Date(`${yesterday}T21:00:00.000-03:00`).toISOString()
    const tStart = new Date(`${today}T15:00:00.000-03:00`).toISOString()
    const tEnd = new Date(`${today}T21:00:00.000-03:00`).toISOString()
    vi.mocked(fetchRemoteSummaryShifts).mockResolvedValue([
      remoteCard('ayer', yStart, 'evening', null, yEnd),
      remoteCard('hoy', tStart, 'morning', null, tEnd),
    ])
    vi.mocked(fetchRemoteShiftMoney).mockResolvedValue(new Map([[
      'ayer',
      {
        ...parts(5_000),
        paymentSplit: { debit: 100, wallet: 0, credit: 0 },
        soldHoursJson: JSON.stringify([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      },
    ]]))

    const res = await getHandler()(null, {
      storeId: STORE_ID,
      startIso: new Date(`${yesterday}T00:00:00.000-03:00`).toISOString(),
      endIso: new Date(`${addDaysYmd(today, 1)}T00:00:00.000-03:00`).toISOString(),
    })
    expect(res.ok).toBe(true)
    const byId = new Map((res.data?.shifts ?? []).map(shift => [shift.id, shift]))
    expect(byId.get('ayer')?.soldTotal).toBe(5_000)
    expect(byId.get('ayer')?.cardWalletTotal).toBe(0)
    expect(byId.get('ayer')?.paymentSplit).toEqual({ debit: 100, wallet: 0, credit: 0 })
    expect(byId.get('hoy')?.soldTotal).toBeNull()
    expect(fetchRemoteShiftMoney).toHaveBeenCalledWith(['ayer'], { ayer: yStart })
    expect(writeRemoteShiftMoney).toHaveBeenCalledWith('ayer', expect.objectContaining({
      soldTotal: 5_000,
      cardWalletTotal: 0,
      paymentSplit: { debit: 100, wallet: 0, credit: 0 },
      soldHoursJson: JSON.stringify([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    }), expect.any(String))
    const view = summaryMoneyView(res.data?.shifts ?? [])
    expect(view.lines[0]?.amount).toBe(5_000)
    expect(view.boxes).toHaveLength(2)
    expect(view.boxes.find(row => row.id === 'hoy')?.box.kind).toBe('pending')
  })

  it('un mes con fichas completas no lee ventas ni gastos', async () => {
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    const october = summaryMonthSpan(2026, 10)
    vi.mocked(fetchRemoteSummaryShifts).mockImplementation(async (_store, start) => [
      remoteCard(`ficha-${start}`, start, 'morning', 1000),
    ])
    const res = await getHandler()(null, {
      storeId: STORE_ID,
      startIso: october.startIso,
      endIso: october.endIso,
    })
    expect(res.ok).toBe(true)
    expect(fetchRemoteShiftMoney).not.toHaveBeenCalled()
    expect(res.data?.shifts.length).toBeGreaterThan(0)
    expect(res.data?.shifts.every(shift => shift.paymentSplit == null)).toBe(true)
    expect(res.data?.shifts.every(shift => shift.cardWalletTotal === 0)).toBe(true)
  })

  it('usa el desglose de la ficha sin ajustarlo y sin leer las filas', async () => {
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    const week = mondayWeekRange(-8)
    vi.mocked(fetchRemoteSummaryShifts).mockResolvedValue([
      remoteCard('con-corte', week.startIso, 'morning', 5000, undefined, { debit: 1000, wallet: 0, credit: 0 }),
    ])
    const res = await getHandler()(null, { storeId: STORE_ID, startIso: week.startIso, endIso: week.endIso })
    expect(res.ok).toBe(true)
    expect(fetchRemoteShiftMoney).not.toHaveBeenCalled()
    const card = res.data?.shifts.find(shift => shift.id === 'con-corte')
    expect(card?.cardWalletTotal).toBe(0)
    expect(card?.paymentSplit).toEqual({ debit: 1000, wallet: 0, credit: 0 })
  })

  it('si no se pueden leer los turnos remotos no devuelve el total de uno solo', async () => {
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    const week = mondayWeekRange(0)
    db.insert(shifts).values({
      id: 'solo-local',
      storeId: STORE_ID,
      userId: USER_ID,
      shiftType: 'evening',
      startedAt: week.startIso,
      closedAt: week.startIso,
      openingCash: 0,
      soldTotal: 100,
      cashTotal: 100,
      cardWalletTotal: 0,
      debtTotal: 0,
      expenseTotal: 0,
      contributionTotal: 0,
      walletCashTotal: 0,
      moneySnapshottedAt: week.startIso,
      openedLocally: false,
    }).run()
    vi.mocked(fetchRemoteSummaryShifts).mockRejectedValue(new Error('failed-precondition'))
    const res = await getHandler()(null, { storeId: STORE_ID, startIso: week.startIso, endIso: week.endIso })
    expect(res.ok).toBe(false)
    expect(res.data).toBeUndefined()
  })

  it('una ficha ya escrita no se recalcula al abrir el resumen', async () => {
    const week = mondayWeekRange(-4)
    db.insert(shifts).values({
      id: 'viejo',
      storeId: STORE_ID,
      userId: USER_ID,
      shiftType: 'evening',
      startedAt: week.startIso,
      closedAt: week.startIso,
      openingCash: 0,
      soldTotal: 1000,
      cashTotal: 800,
      cardWalletTotal: 0,
      debtTotal: 190000,
      expenseTotal: 0,
      contributionTotal: 0,
      walletCashTotal: 0,
      moneySnapshottedAt: week.startIso,
      openedLocally: true,
    }).run()
    const res = await getHandler()(null, { storeId: STORE_ID, startIso: week.startIso, endIso: week.endIso })
    expect(res.ok).toBe(true)
    expect(res.data?.shifts[0]?.debtTotal).toBe(190000)
    const row = db.select().from(shifts).where(eq(shifts.id, 'viejo')).get()
    expect(row?.debtTotal).toBe(190000)
    expect(row?.soldTotal).toBe(1000)
  })

  it('el recálculo guarda las 24 horas sin leer ventas en Firestore', async () => {
    const week = mondayWeekRange(-4)
    db.insert(shifts).values({
      id: 'sin-ficha',
      storeId: STORE_ID,
      userId: USER_ID,
      shiftType: 'morning',
      startedAt: week.startIso,
      closedAt: week.startIso,
      openingCash: 0,
      openedLocally: true,
    }).run()
    db.insert(sales).values({
      id: 'sale-hora',
      storeId: STORE_ID,
      shiftId: 'sin-ficha',
      total: 1500,
      status: 'confirmed',
      createdAt: week.startIso,
      createdBy: USER_ID,
    }).run()

    const res = await getHandler()(null, { storeId: STORE_ID, startIso: week.startIso, endIso: week.endIso })
    expect(res.ok).toBe(true)
    expect(fetchRemoteShiftMoney).not.toHaveBeenCalled()
    expect(fetchRemoteSaleStamps).not.toHaveBeenCalled()
    const row = db.select().from(shifts).where(eq(shifts.id, 'sin-ficha')).get()
    const hours = JSON.parse(row?.soldHoursJson ?? 'null') as number[]
    expect(hours).toHaveLength(24)
    expect(hours.reduce((acc, amount) => acc + amount, 0)).toBe(1500)
    expect(row?.soldTotal).toBe(1500)
  })

  it('abrir dos veces una semana cerrada no vuelve a bajar los turnos, y corregir refresca solo esa semana', async () => {
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    const older = mondayWeekRange(-6)
    const newer = mondayWeekRange(-5)
    vi.mocked(fetchRemoteSummaryShifts).mockImplementation(async (_store, start) => {
      if (start === older.startIso) return [remoteCard('vieja', older.startIso, 'evening', 1000)]
      if (start === newer.startIso) return [remoteCard('menos-vieja', newer.startIso, 'morning', 2000)]
      return []
    })
    const range = { storeId: STORE_ID, startIso: older.startIso, endIso: newer.endIso }
    const first = await getHandler()(null, range)
    expect(first.ok).toBe(true)
    expect(fetchRemoteSummaryShifts).toHaveBeenCalledTimes(2)

    vi.mocked(fetchRemoteSummaryShifts).mockClear()
    const second = await getHandler()(null, range)
    expect(second.ok).toBe(true)
    expect(fetchRemoteSummaryShifts).not.toHaveBeenCalled()
    expect(summaryMoneyView(second.data?.shifts ?? []).lines[0]?.amount).toBe(3000)

    const { invalidateSummaryWeek } = await import('../../summary/summaryWeekCache')
    invalidateSummaryWeek(db as unknown as ReturnType<typeof getDb>, STORE_ID, older.startIso)
    vi.mocked(fetchRemoteSummaryShifts).mockClear()
    const third = await getHandler()(null, range)
    expect(third.ok).toBe(true)
    expect(vi.mocked(fetchRemoteSummaryShifts).mock.calls.map(call => call[1])).toEqual([older.startIso])
    expect(summaryMoneyView(third.data?.shifts ?? []).lines[0]?.amount).toBe(3000)
  })

  it('la semana en curso se vuelve a pedir al entrar', async () => {
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    const week = mondayWeekRange(0)
    vi.mocked(fetchRemoteSummaryShifts).mockResolvedValue([])
    const range = { storeId: STORE_ID, startIso: week.startIso, endIso: week.endIso }
    expect((await getHandler()(null, range)).ok).toBe(true)
    expect((await getHandler()(null, range)).ok).toBe(true)
    expect(fetchRemoteSummaryShifts).toHaveBeenCalledTimes(2)
    expect(fetchRemoteSummaryShifts).toHaveBeenCalledWith(STORE_ID, week.startIso, week.endIso)
  })

  it('los cobros salen de sqlite, incluido el que no tiene turno', async () => {
    const week = mondayWeekRange(-8)
    const now = week.startIso
    db.insert(shifts).values({
      id: 'shift-fiado',
      storeId: STORE_ID,
      userId: USER_ID,
      shiftType: 'morning',
      startedAt: week.startIso,
      closedAt: week.endInclusiveYmd + 'T18:00:00.000Z',
      openingCash: 0,
      soldTotal: 1000,
      cashTotal: 1000,
      cardWalletTotal: 0,
      debtTotal: 20_000,
      expenseTotal: 0,
      contributionTotal: 0,
      walletCashTotal: 0,
      moneySnapshottedAt: week.startIso,
      openedLocally: false,
    }).run()
    db.insert(customers).values({
      id: 'cust-fiado',
      storeId: STORE_ID,
      name: 'Cliente Fiado',
      active: true,
      createdAt: now,
      createdBy: USER_ID,
    }).run()
    db.insert(customers).values({
      id: 'cust-otro',
      storeId: STORE_ID,
      name: 'Cliente Anulado',
      active: true,
      createdAt: now,
      createdBy: USER_ID,
    }).run()
    db.insert(debtEvents).values([
      {
        id: 'de-created',
        customerId: 'cust-fiado',
        storeId: STORE_ID,
        eventType: 'created',
        amount: 20_000,
        createdAt: week.startIso,
        createdBy: USER_ID,
      },
      {
        id: 'de-paid',
        customerId: 'cust-fiado',
        storeId: STORE_ID,
        eventType: 'paid',
        amount: -5_000,
        shiftId: 'shift-fiado',
        createdAt: week.startIso,
        createdBy: USER_ID,
      },
      {
        id: 'de-partial',
        customerId: 'cust-fiado',
        storeId: STORE_ID,
        eventType: 'partial_payment',
        amount: -3_000,
        shiftId: null,
        createdAt: week.startIso,
        createdBy: USER_ID,
      },
      {
        id: 'de-fuera',
        customerId: 'cust-fiado',
        storeId: STORE_ID,
        eventType: 'paid',
        amount: -1_000,
        shiftId: null,
        createdAt: '2020-01-01T00:00:00.000Z',
        createdBy: USER_ID,
      },
      {
        id: 'de-cancel-local',
        customerId: 'cust-otro',
        storeId: STORE_ID,
        eventType: 'created',
        amount: 8_000,
        createdAt: week.startIso,
        createdBy: USER_ID,
      },
      {
        id: 'de-cancel-otro',
        customerId: 'cust-otro',
        storeId: OTHER_STORE,
        eventType: 'cancelled',
        amount: -8_000,
        createdAt: week.startIso,
        createdBy: USER_ID,
      },
    ]).run()

    const res = await getHandler()(null, {
      storeId: STORE_ID,
      startIso: week.startIso,
      endIso: week.endIso,
    })
    expect(res.ok).toBe(true)
    expect(res.data?.shifts[0]?.soldTotal).toBe(1000)
    expect(res.data?.fiado.debtNow).toBe(11_000)
    const collections = sumCollections(res.data?.fiado.payments ?? [])
    expect(collections.total).toBe(8_000)
    expect(collections.unshifted).toBe(3_000)
    expect(summaryMoneyView(res.data?.shifts ?? []).lines[0]?.amount).toBe(1000)

    db.insert(stores).values({
      id: 'vacio',
      name: 'Vacío',
      address: 'Calle 3',
      createdAt: now,
    }).run()
    const empty = await getHandler()(null, {
      storeId: 'vacio',
      startIso: week.startIso,
      endIso: week.endIso,
    })
    expect(empty.ok).toBe(true)
    expect(empty.data?.fiado).toEqual({ debtNow: null, payments: null })
  })

  describe('get-summary-expenses', () => {
    const visible = '11111111-1111-4111-8111-111111111111'
    const alsoVisible = '22222222-2222-4222-8222-222222222222'
    const notOnScreen = '33333333-3333-4333-8333-333333333333'

    it('rechaza un payload malformado', async () => {
      const res = await getExpenseHandler()(null, { shifts: [{ id: 'no-es-uuid', storeId: STORE_ID, startedAt: '2026-10-01T12:00:00.000Z' }] })
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })

    it('apretar el botón lee solo expenses de los turnos visibles', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      const week = mondayWeekRange(-8)
      vi.mocked(fetchRemoteExpenseLines).mockResolvedValue([
        {
          id: 'hielo',
          shiftId: visible,
          createdAt: week.startIso,
          concept: 'Hielo',
          providerName: null,
          amount: 100,
          notes: null,
          kind: 'expense',
        },
      ])

      const res = await getExpenseHandler()(null, {
        shifts: [
          { id: visible, storeId: STORE_ID, startedAt: week.startIso },
          { id: alsoVisible, storeId: STORE_ID, startedAt: week.startIso },
        ],
      })

      expect(res.ok).toBe(true)
      expect(fetchRemoteExpenseLines).toHaveBeenCalledTimes(1)
      expect(fetchRemoteExpenseLines).toHaveBeenCalledWith([visible, alsoVisible])
      expect(fetchRemoteExpenseLines).not.toHaveBeenCalledWith(expect.arrayContaining([notOnScreen]))
      expect(res.data?.map(row => row.id)).toEqual(['hielo'])
    })

    it('una semana cerrada no vuelve a leer los gastos', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      const week = mondayWeekRange(-8)
      vi.mocked(fetchRemoteExpenseLines).mockResolvedValue([])
      const payload = { shifts: [{ id: visible, storeId: STORE_ID, startedAt: week.startIso }] }

      await getExpenseHandler()(null, payload)
      await getExpenseHandler()(null, payload)

      expect(fetchRemoteExpenseLines).toHaveBeenCalledTimes(1)
    })

    it('la semana en curso se lee de nuevo al apretar', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      const week = mondayWeekRange(0)
      vi.mocked(fetchRemoteExpenseLines).mockResolvedValue([])
      const payload = { shifts: [{ id: visible, storeId: STORE_ID, startedAt: week.startIso }] }

      await getExpenseHandler()(null, payload)
      await getExpenseHandler()(null, payload)

      expect(fetchRemoteExpenseLines).toHaveBeenCalledTimes(2)
      expect(fetchRemoteExpenseLines).toHaveBeenNthCalledWith(1, [visible])
      expect(fetchRemoteExpenseLines).toHaveBeenNthCalledWith(2, [visible])
    })

    it('la PC del local no lee gastos en Firestore', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      const week = mondayWeekRange(-8)
      db.insert(shifts).values({
        id: visible,
        storeId: STORE_ID,
        userId: USER_ID,
        shiftType: 'morning',
        startedAt: week.startIso,
        openingCash: 0,
        source: 'desktop',
        openedLocally: true,
      }).run()
      db.insert(expenses).values([
        {
          id: 'hielo',
          storeId: STORE_ID,
          shiftId: visible,
          concept: 'Hielo',
          amount: 100,
          kind: 'expense',
          createdAt: week.startIso,
          createdBy: USER_ID,
        },
        {
          id: 'aporte',
          storeId: STORE_ID,
          shiftId: visible,
          concept: 'Aporte',
          amount: 999,
          kind: 'inject',
          injectReason: 'aporte',
          createdAt: week.startIso,
          createdBy: USER_ID,
        },
      ]).run()

      const res = await getExpenseHandler()(null, {
        shifts: [{ id: visible, storeId: STORE_ID, startedAt: week.startIso }],
      })

      expect(res.ok).toBe(true)
      expect(fetchRemoteExpenseLines).not.toHaveBeenCalled()
      expect(res.data?.map(row => row.id)).toEqual(['hielo'])
    })
  })

  describe('get-summary-sale-hours', () => {
    const visible = '11111111-1111-4111-8111-111111111111'
    const alsoVisible = '22222222-2222-4222-8222-222222222222'
    const notOnScreen = '33333333-3333-4333-8333-333333333333'
    const ymd = '2026-11-18'

    it('rechaza un día mal escrito', async () => {
      const res = await getSaleHourHandler()(null, {
        ymd: 'hoy',
        shifts: [{ id: visible, storeId: STORE_ID, startedAt: '2026-11-18T15:00:00.000Z' }],
      })
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })

    it('Hoy lee solo las ventas de los turnos que están en pantalla', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(fetchRemoteSaleStamps).mockResolvedValue([
        { createdAt: '2026-11-18T15:00:00.000Z', total: 1000 },
        { createdAt: '2026-11-18T22:30:00.000Z', total: 800 },
      ])

      const res = await getSaleHourHandler()(null, {
        ymd,
        shifts: [
          { id: visible, storeId: STORE_ID, startedAt: '2026-11-18T11:00:00.000Z' },
          { id: alsoVisible, storeId: STORE_ID, startedAt: '2026-11-18T21:00:00.000Z' },
        ],
      })

      expect(res.ok).toBe(true)
      expect(fetchRemoteSaleStamps).toHaveBeenCalledTimes(1)
      expect(fetchRemoteSaleStamps).toHaveBeenCalledWith([visible, alsoVisible])
      expect(fetchRemoteSaleStamps).not.toHaveBeenCalledWith(expect.arrayContaining([notOnScreen]))
      expect(res.data?.[12]).toEqual({ hour: 12, amount: 1000, saleCount: 1 })
      expect(res.data?.[19]).toEqual({ hour: 19, amount: 800, saleCount: 1 })
      expect(res.data).toHaveLength(24)
    })

    it('la PC del local no lee ventas en Firestore', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      db.insert(shifts).values({
        id: visible,
        storeId: STORE_ID,
        userId: USER_ID,
        shiftType: 'morning',
        startedAt: '2026-11-18T11:00:00.000Z',
        openingCash: 0,
        source: 'desktop',
        openedLocally: true,
      }).run()
      db.insert(sales).values([
        {
          id: 'mediodia',
          storeId: STORE_ID,
          shiftId: visible,
          total: 1000,
          status: 'confirmed',
          createdAt: '2026-11-18T15:00:00.000Z',
          createdBy: USER_ID,
        },
        {
          id: 'otra',
          storeId: STORE_ID,
          shiftId: visible,
          total: 500,
          status: 'confirmed',
          createdAt: '2026-11-18T15:40:00.000Z',
          createdBy: USER_ID,
        },
        {
          id: 'anulada',
          storeId: STORE_ID,
          shiftId: visible,
          total: 9000,
          status: 'cancelled',
          createdAt: '2026-11-18T15:20:00.000Z',
          createdBy: USER_ID,
        },
        {
          id: 'noche',
          storeId: STORE_ID,
          shiftId: visible,
          total: 800,
          status: 'confirmed',
          createdAt: '2026-11-18T22:30:00.000Z',
          createdBy: USER_ID,
        },
      ]).run()

      const res = await getSaleHourHandler()(null, {
        ymd,
        shifts: [{ id: visible, storeId: STORE_ID, startedAt: '2026-11-18T11:00:00.000Z' }],
      })

      expect(res.ok).toBe(true)
      expect(fetchRemoteSaleStamps).not.toHaveBeenCalled()
      expect(res.data?.[12]).toEqual({ hour: 12, amount: 1500, saleCount: 2 })
      expect(res.data?.[19]).toEqual({ hour: 19, amount: 800, saleCount: 1 })
      expect(res.data?.[15]).toEqual({ hour: 15, amount: 0, saleCount: 0 })
    })
  })
})

function parts(sold: number): ShiftMoneyParts {
  return {
    soldTotal: sold,
    cashTotal: sold,
    cardWalletTotal: 0,
    debtTotal: 0,
    expenseTotal: 0,
    contributionTotal: 0,
    walletCashTotal: 0,
  }
}

function remoteCard(
  id: string,
  startedAt: string,
  shiftType: 'morning' | 'evening',
  sold: number | null,
  closedAt?: string,
  split?: { debit: number; wallet: number; credit: number } | null,
): RemoteSummaryShift {
  const at = new Date(startedAt).toISOString()
  return {
    id,
    cashierName: 'Admin Prueba',
    shiftType,
    startedAt: at,
    closedAt: closedAt ? new Date(closedAt).toISOString() : at,
    openingCash: 0,
    cashLeft: null,
    deliveredAmount: null,
    soldTotal: sold,
    cashTotal: sold,
    cardWalletTotal: sold == null ? null : 0,
    debtTotal: sold == null ? null : 0,
    expenseTotal: sold == null ? null : 0,
    contributionTotal: sold == null ? null : 0,
    walletCashTotal: sold == null ? null : 0,
    debitTotal: split?.debit ?? null,
    walletTotal: split?.wallet ?? null,
    creditTotal: split?.credit ?? null,
    moneySnapshottedAt: sold == null ? null : at,
  }
}
