import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { eq, and, gte, lte, asc, desc, inArray } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import {
  shifts, sales, salePayments, saleItems, expenses,
  debtEvents, orders, users, products, providers, customers,
  employeeVales, employees, merchandiseIntakes, merchandiseIntakeLines,
} from '../db/schema'
import { readBillLines } from '../db/billCountStore'
import { getActiveSession } from '../activeSession'
import { isFirebaseAvailable } from '../licensing/firebase'
import {
  fetchHistoryShiftsFromFirestore,
  fetchHistoryShiftDetailFromFirestore,
  fetchEmployeeValesFromFirestore,
  defaultHistoryFromDate,
  mergeHistoryShiftRows,
  mergeHistoryShiftDetails,
  sortHistoryShiftRowsNewestFirst,
} from '../licensing/historyFirestore'
import type {
  IpcResult,
  HistoryShiftRow,
  HistoryShiftDetail,
  HistoryValeRow,
  RemoteEmployeeValeRow,
  ValeItem,
} from '../../src/types/hw-api'
import { cashAmountFromDeposit, digitalAmountFromDeposit } from '../lib/depositPayments'
import { buildCashHandoverAudit, cashierHistoryWindow, civilYmd } from '@carniceria/shared'
import { merchDbLineToSnapshot } from '../licensing/merchIntakeDb'
import { historyListRowFromFicha } from '../licensing/historyListRow'
import { historyVisitLinesFromSnapshots, unpaidArrivalFromIntake, type HistoryUnpaidArrival } from '../licensing/historyVisitLines'

const getHistoryShiftsSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  /** Admin: 'all' = todos los locales; storeId específico = ese local */
  storeIdFilter: z.string().optional(),
}).optional()

const getHistoryShiftDetailSchema = z.object({
  shiftId: z.string().uuid(),
})

const getRemoteEmployeeValesSchema = z.object({
  storeIdFilter: z.string().optional(),
}).optional()

export function registerHistoryHandlers(): void {
  // --------------------------------------------------------------------------
  // GET_HISTORY_SHIFTS — lista de fichas. El detalle baja ventas y gastos al abrir un turno.
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.GET_HISTORY_SHIFTS, async (_event, payload: unknown): Promise<IpcResult<HistoryShiftRow[]>> => {
    const parsed = getHistoryShiftsSchema.safeParse(payload ?? {})
    if (!parsed.success) {
      log.error('[ipc:get-history-shifts] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role === 'cashier' && cashierListOutsideWindow(parsed.data?.fromDate, parsed.data?.toDate)) {
      return CASHIER_WINDOW_DENIED
    }
    if (session.role !== 'admin' && session.role !== 'cashier') {
      return { ok: false, error: 'Solo los administradores pueden ver el historial.', code: 'FORBIDDEN' }
    }

    const filter = parsed.data ?? { limit: 50, offset: 0 }
    const pageLimit = filter.limit ?? 50
    const pageOffset = filter.offset ?? 0
    const useRemote = isFirebaseAvailable()

    try {
      const db = getDb()

      // Determinar filtro de local
      const effectiveStoreId: string | null =
        filter.storeIdFilter === 'all'
          ? null
          : filter.storeIdFilter ?? session.storeId

      const conditions = [] as ReturnType<typeof eq>[]
      if (effectiveStoreId !== null) conditions.push(eq(shifts.storeId, effectiveStoreId))
      if (filter.fromDate) conditions.push(gte(shifts.startedAt, filter.fromDate))
      if (filter.toDate) conditions.push(lte(shifts.startedAt, filter.toDate + 'T23:59:59.999Z'))

      const shiftQuery = db.select().from(shifts)
      const shiftRows = (
        conditions.length > 0
          ? shiftQuery.where(and(...conditions))
          : shiftQuery
      )
        .orderBy(desc(shifts.startedAt))
        .limit(500)
        .all()

      if (shiftRows.length === 0 && !useRemote) return { ok: true, data: [] }

      const userIds = [...new Set(shiftRows.map(s => s.userId))]

      // Nombres de cajeras
      const userRows = userIds.length > 0
        ? db.select({ id: users.id, name: users.name }).from(users).all().filter(u => userIds.includes(u.id))
        : []
      const userMap = new Map(userRows.map(u => [u.id, u.name]))

      const localResult: HistoryShiftRow[] = shiftRows.map(s => historyListRowFromFicha({
        id: s.id,
        shiftType: s.shiftType,
        startedAt: s.startedAt,
        closedAt: s.closedAt ?? null,
        cashierName: userMap.get(s.userId) ?? s.userId,
        storeId: s.storeId,
        openingCash: s.openingCash,
        source: s.source,
        soldTotal: s.soldTotal,
        cashTotal: s.cashTotal,
        cardWalletTotal: s.cardWalletTotal,
        debtTotal: s.debtTotal,
        expenseTotal: s.expenseTotal,
        contributionTotal: s.contributionTotal,
        walletCashTotal: s.walletCashTotal,
        moneySnapshottedAt: s.moneySnapshottedAt,
      }))

      if (!useRemote) {
        return {
          ok: true,
          data: sortHistoryShiftRowsNewestFirst(localResult).slice(pageOffset, pageOffset + pageLimit),
        }
      }

      try {
        const remote = await fetchHistoryShiftsFromFirestore({
          fromDate: filter.fromDate,
          toDate: filter.toDate,
          effectiveStoreId,
        })
        const merged = sortHistoryShiftRowsNewestFirst(mergeHistoryShiftRows(localResult, remote))
        return { ok: true, data: merged.slice(pageOffset, pageOffset + pageLimit) }
      } catch (fbErr) {
        log.warn('[ipc:get-history-shifts] Firestore no disponible; se usa solo local', fbErr)
        return {
          ok: true,
          data: sortHistoryShiftRowsNewestFirst(localResult).slice(pageOffset, pageOffset + pageLimit),
        }
      }
    } catch (err) {
      log.error('[ipc:get-history-shifts] Error inesperado', err)
      return { ok: false, error: 'Error al obtener el historial de turnos.' }
    }
  })

  // --------------------------------------------------------------------------
  // GET_HISTORY_SHIFT_DETAIL — detalle completo de un turno (solo admin)
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.GET_HISTORY_SHIFT_DETAIL, async (_event, payload: unknown): Promise<IpcResult<HistoryShiftDetail>> => {
    const parsed = getHistoryShiftDetailSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:get-history-shift-detail] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin' && session.role !== 'cashier') {
      return { ok: false, error: 'Solo los administradores pueden ver el historial.', code: 'FORBIDDEN' }
    }

    const { shiftId } = parsed.data

    try {
      const db = getDb()

      const shift = db.select().from(shifts).where(eq(shifts.id, shiftId)).all()[0]
      if (!shift) {
        // PC sin SQLite del local: intentar Firestore
        if (isFirebaseAvailable()) {
          try {
            const remoteDetail = await fetchHistoryShiftDetailFromFirestore(shiftId, session.role === 'cashier')
            if (remoteDetail && cashierShiftOutsideWindow(session.role, remoteDetail.shift.startedAt)) {
              return CASHIER_WINDOW_DENIED
            }
            if (remoteDetail) {
              return { ok: true, data: finishHistoryDetail(db, remoteDetail, session.role === 'cashier') }
            }
          } catch (fbErr) {
            log.warn('[ipc:get-history-shift-detail] Firestore no disponible', fbErr)
          }
        }
        return { ok: false, error: 'Turno no encontrado.', code: 'NOT_FOUND' }
      }
      if (cashierShiftOutsideWindow(session.role, shift.startedAt)) return CASHIER_WINDOW_DENIED

      const cashierRow = db.select({ name: users.name }).from(users).where(eq(users.id, shift.userId)).all()[0]
      const cashierName = cashierRow?.name ?? shift.userId

      // ---- Ventas ----
      const salesRows = db
        .select({
          id: sales.id,
          createdAt: sales.createdAt,
          total: sales.total,
          status: sales.status,
          manualEntry: sales.manualEntry,
          isDebt: sales.isDebt,
          discountException: sales.discountException,
          discountPercent: sales.discountPercent,
          discountAmount: sales.discountAmount,
          customerId: sales.customerId,
        })
        .from(sales)
        .where(eq(sales.shiftId, shiftId))
        .orderBy(asc(sales.createdAt))
        .all()

      // Ítems de ventas
      const saleIdList = salesRows.map(s => s.id)

      // Items
      type ItemMap = Map<string, Array<{ productName: string; quantity: number; unit: 'kg' | 'unit'; unitPrice: number; subtotal: number }>>
      const itemsMap: ItemMap = new Map()
      if (saleIdList.length > 0) {
        const itemRows = db
          .select({
            saleId: saleItems.saleId,
            quantity: saleItems.quantity,
            unitPrice: saleItems.unitPrice,
            subtotal: saleItems.subtotal,
            productId: saleItems.productId,
          })
          .from(saleItems)
          .all()
          .filter(r => saleIdList.includes(r.saleId))

        const productIds = [...new Set(itemRows.map(r => r.productId).filter(Boolean))] as string[]
        const productRows = productIds.length > 0
          ? db.select({ id: products.id, name: products.name, unit: products.unit }).from(products).all().filter(p => productIds.includes(p.id))
          : []
        const productMap = new Map(productRows.map(p => [p.id, p]))

        for (const item of itemRows) {
          if (!itemsMap.has(item.saleId)) itemsMap.set(item.saleId, [])
          const prod = productMap.get(item.productId ?? '')
          itemsMap.get(item.saleId)!.push({
            productName: prod?.name ?? '(producto eliminado)',
            quantity: item.quantity,
            unit: (prod?.unit ?? 'kg') as 'kg' | 'unit',
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
          })
        }
      }

      // Pagos por venta
      const paymentsMap = new Map<string, {
        cash: number
        digital: number
        methods: Array<'cash' | 'debit' | 'wallet' | 'credit'>
        byMethod: Array<{ method: 'cash' | 'debit' | 'wallet' | 'credit'; amount: number }>
      }>()
      if (saleIdList.length > 0) {
        const payRows = db
          .select({ saleId: salePayments.saleId, method: salePayments.paymentMethod, amount: salePayments.amount })
          .from(salePayments)
          .all()
          .filter(r => saleIdList.includes(r.saleId))

        for (const p of payRows) {
          const method = p.method as 'cash' | 'debit' | 'wallet' | 'credit'
          if (!paymentsMap.has(p.saleId)) {
            paymentsMap.set(p.saleId, { cash: 0, digital: 0, methods: [], byMethod: [] })
          }
          const entry = paymentsMap.get(p.saleId)!
          if (method === 'cash') entry.cash += p.amount
          else entry.digital += p.amount
          if (!entry.methods.includes(method)) entry.methods.push(method)
          const slice = entry.byMethod.find(row => row.method === method)
          if (slice) slice.amount += p.amount
          else entry.byMethod.push({ method, amount: p.amount })
        }
      }

      // Clientes con deuda (para resolución de nombre)
      const historySales = salesRows.map(s => {
        const pay = paymentsMap.get(s.id) ?? { cash: 0, digital: 0, methods: [], byMethod: [] }
        return {
          id: s.id,
          createdAt: s.createdAt,
          total: s.total,
          status: s.status as 'confirmed' | 'cancelled',
          cashAmount: pay.cash,
          digitalAmount: pay.digital,
          paymentMethods: pay.methods,
          payments: pay.byMethod,
          manualEntry: s.manualEntry,
          isDebt: s.isDebt,
          discountException: s.discountException,
          discountPercent: s.discountPercent,
          discountAmount: s.discountAmount,
          customerName: null as string | null,
          items: itemsMap.get(s.id) ?? [],
        }
      })

      // ---- Gastos ----
      const expRows = db
        .select({
          id: expenses.id,
          createdAt: expenses.createdAt,
          concept: expenses.concept,
          providerId: expenses.providerId,
          amount: expenses.amount,
          notes: expenses.notes,
          createdBy: expenses.createdBy,
          kind: expenses.kind,
          injectReason: expenses.injectReason,
        })
        .from(expenses)
        .where(eq(expenses.shiftId, shiftId))
        .orderBy(asc(expenses.createdAt))
        .all()

      const expUserIds = [...new Set(expRows.map(r => r.createdBy))]
      const expUserRows = expUserIds.length > 0
        ? db.select({ id: users.id, name: users.name }).from(users).all().filter(u => expUserIds.includes(u.id))
        : []
      const expUserMap = new Map(expUserRows.map(u => [u.id, u.name]))

      // Resolver nombres de proveedor
      const expProviderIds = [...new Set(expRows.map(r => r.providerId).filter(Boolean) as string[])]
      const expProviderRows = expProviderIds.length > 0
        ? db.select({ id: providers.id, name: providers.name }).from(providers).all()
            .filter(p => expProviderIds.includes(p.id))
        : []
      const expProviderMap = new Map(expProviderRows.map(p => [p.id, p.name]))
      const visitsByExpense = intakeVisitsByExpense(db, expRows.map(r => r.id), session.role === 'cashier')

      const historyExpenses = expRows.map(r => {
        const visit = visitsByExpense.get(r.id)
        return {
          id: r.id,
          createdAt: r.createdAt,
          concept: r.concept ?? undefined,
          provider: r.providerId ? (expProviderMap.get(r.providerId) ?? undefined) : undefined,
          amount: r.amount,
          notes: r.notes,
          createdBy: expUserMap.get(r.createdBy) ?? r.createdBy,
          kind: r.kind === 'inject' ? 'inject' as const : 'expense' as const,
          injectReason: r.kind === 'inject'
            ? (r.injectReason === 'wallet_cash' ? 'wallet_cash' as const : 'aporte' as const)
            : undefined,
          ...(visit && visit.lines.length > 0 ? {
            lineNames: visit.lines.map(line => line.name),
            visitLines: visit.lines,
            intakeId: visit.intakeId,
            intakeCreatedAt: visit.createdAt,
          } : {}),
        }
      })

      // ---- Fiados del turno (eventos con shiftId + fiados creados desde ventas del turno) ----
      type DebtRow = {
        id: string
        createdAt: string
        eventType: string
        amount: number
        notes: string | null
        customerId: string
      }
      const debtById = new Map<string, DebtRow>()

      const byShiftDebt = db
        .select({
          id: debtEvents.id,
          createdAt: debtEvents.createdAt,
          eventType: debtEvents.eventType,
          amount: debtEvents.amount,
          notes: debtEvents.notes,
          customerId: debtEvents.customerId,
        })
        .from(debtEvents)
        .where(eq(debtEvents.shiftId, shiftId))
        .all()
      for (const r of byShiftDebt) debtById.set(r.id, r)

      const bySaleDebt = db
        .select({
          id: debtEvents.id,
          createdAt: debtEvents.createdAt,
          eventType: debtEvents.eventType,
          amount: debtEvents.amount,
          notes: debtEvents.notes,
          customerId: debtEvents.customerId,
        })
        .from(debtEvents)
        .innerJoin(sales, eq(debtEvents.saleId, sales.id))
        .where(and(
          eq(sales.shiftId, shiftId),
          eq(debtEvents.eventType, 'created'),
        ))
        .all()
      for (const r of bySaleDebt) {
        if (!debtById.has(r.id)) debtById.set(r.id, r)
      }

      const customerNameById = new Map<string, string>()
      const customerIds = [...new Set([...debtById.values()].map(r => r.customerId))]
      if (customerIds.length > 0) {
        const custRows = db.select({ id: customers.id, name: customers.name }).from(customers).all()
        for (const c of custRows) {
          if (customerIds.includes(c.id)) customerNameById.set(c.id, c.name)
        }
      }

      const historyDebts = [...debtById.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(r => ({
          id: r.id,
          createdAt: r.createdAt,
          customerName: customerNameById.get(r.customerId) ?? '(cliente)',
          amount: r.amount,
          eventType: r.eventType as HistoryShiftDetail['debts'][number]['eventType'],
          notes: r.notes,
        }))

      // ---- Señas del turno ----
      const depositRows = db
        .select({
          id: orders.id,
          customerName: orders.customerName,
          phone: orders.phone,
          items: orders.items,
          depositAmount: orders.depositAmount,
          depositMethod: orders.depositMethod,
          depositPayments: orders.depositPayments,
          createdAt: orders.createdAt,
          status: orders.status,
        })
        .from(orders)
        .where(and(
          eq(orders.depositShiftId, shiftId),
        ))
        .orderBy(asc(orders.createdAt))
        .all()

      const depositRowsWithAmount = depositRows.filter(r => r.depositAmount > 0)

      const historyDeposits = depositRowsWithAmount.map(r => {
          let parsedPayments: import('../../src/types/hw-api').DepositPayment[] | null = null
          if (r.depositPayments) {
            try { parsedPayments = JSON.parse(r.depositPayments) } catch { /* ignore */ }
          }
          return {
            id: r.id,
            customerName: r.customerName,
            phone: r.phone,
            items: r.items,
            depositAmount: r.depositAmount,
            depositPayments: parsedPayments,
            depositMethod: r.depositMethod as HistoryShiftDetail['deposits'][number]['depositMethod'],
            createdAt: r.createdAt,
            status: r.status as HistoryShiftDetail['deposits'][number]['status'],
          }
        })

      // ---- Vales del turno ----
      const valeRows = db
        .select()
        .from(employeeVales)
        .where(eq(employeeVales.shiftId, shiftId))
        .all()
      const employeeIds = [...new Set(valeRows.map(v => v.employeeId))]
      const employeeNameById = new Map<string, string>()
      if (employeeIds.length > 0) {
        const empRows = db.select({ id: employees.id, name: employees.name }).from(employees).all()
        for (const e of empRows) {
          if (employeeIds.includes(e.id)) employeeNameById.set(e.id, e.name)
        }
      }
      const historyVales: HistoryValeRow[] = valeRows
        .map(r => {
          let parsedItems: ValeItem[] | null = null
          if (r.items) {
            try { parsedItems = JSON.parse(r.items) as ValeItem[] } catch { parsedItems = null }
          }
          return {
            id: r.id,
            employeeName: employeeNameById.get(r.employeeId) ?? '(empleado)',
            amount: r.amount,
            description: r.description ?? null,
            items: parsedItems,
            cancelledAt: r.cancelledAt ?? null,
            createdAt: r.createdAt,
          }
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

      // ---- Resumen ----
      const confirmedSales = historySales.filter(s => s.status === 'confirmed')
      const totalRevenue = confirmedSales.reduce((a, s) => a + s.total, 0)
      const totalCashSales = confirmedSales.reduce((a, s) => a + s.cashAmount, 0)
      const totalDebitSales = confirmedSales.reduce((a, s) => a + (s.paymentMethods.includes('debit') ? s.digitalAmount : 0), 0)
      const totalWalletSales = confirmedSales.reduce((a, s) => a + (s.paymentMethods.includes('wallet') ? s.digitalAmount : 0), 0)
      const totalCreditSales = confirmedSales.reduce((a, s) => a + (s.paymentMethods.includes('credit') ? s.digitalAmount : 0), 0)
      const totalExpenses = historyExpenses
        .filter(e => e.kind !== 'inject')
        .reduce((a, e) => a + e.amount, 0)
      const totalCashInjects = historyExpenses
        .filter(e => e.kind === 'inject')
        .reduce((a, e) => a + e.amount, 0)
      const cashDeposits = depositRowsWithAmount.reduce((a, r) => a + cashAmountFromDeposit(r), 0)
      const digitalDeposits = depositRowsWithAmount.reduce((a, r) => a + digitalAmountFromDeposit(r), 0)
      const cashDebtRows = db
        .select({ amount: debtEvents.amount })
        .from(debtEvents)
        .where(and(
          eq(debtEvents.shiftId, shiftId),
          eq(debtEvents.paymentMethod, 'cash'),
        ))
        .all()
      const cashDebtPayments = cashDebtRows.reduce((a, r) => a + Math.abs(Number(r.amount)), 0)
      const cashInHand = shift.openingCash + totalCashSales + cashDeposits + cashDebtPayments + totalCashInjects - totalExpenses

      const localDetail: HistoryShiftDetail = {
        shift: {
          id: shift.id,
          shiftType: shift.shiftType,
          startedAt: shift.startedAt,
          closedAt: shift.closedAt ?? null,
          cashierName,
          openingCash: shift.openingCash,
          closingCash: shift.closingCash,
          cashLeft: shift.cashLeft,
          deliveredAmount: shift.deliveredAmount,
          deliveredTo: shift.deliveredTo,
          notes: shift.notes,
          source: shift.source === 'mobile' ? 'mobile' : 'desktop',
        },
        cashHandover: buildCashHandoverAudit({
          cashierName,
          startedAt: shift.startedAt,
          closedAt: shift.closedAt ?? null,
          openingBills: readBillLines(db, shift.id, 'opening'),
          closingBills: readBillLines(db, shift.id, 'closing'),
          openingCounted: Boolean(shift.openingCounted),
          closingCounted: Boolean(shift.closingCounted),
          handover: {
            fromShiftId: shift.handoverFromShiftId,
            fromCashierName: shift.handoverFromCashierName,
            fromClosedAt: shift.handoverFromClosedAt,
            expectedBills: readBillLines(db, shift.id, 'expected'),
          },
        }),
        sales: historySales,
        expenses: historyExpenses,
        debts: historyDebts,
        deposits: historyDeposits,
        vales: historyVales,
        summary: {
          salesCount: confirmedSales.length,
          totalRevenue,
          totalCashSales,
          totalDebitSales,
          totalWalletSales,
          totalCreditSales,
          totalExpenses,
          totalCashInjects,
          cashDeposits,
          digitalDeposits,
          cashInHand,
          debtsCount: historyDebts.length,
          totalDebts: historyDebts.reduce((a, d) => a + d.amount, 0),
        },
      }

      // Esta PC no es el local. Lo que falta en SQLite se completa desde Firestore
      // (ventas, gastos, fiados, señas y vales). Un dato local no tapa al resto.
      if (isFirebaseAvailable()) {
        try {
          const remoteDetail = await fetchHistoryShiftDetailFromFirestore(shiftId, session.role === 'cashier')
          if (remoteDetail) {
            return {
              ok: true,
              data: finishHistoryDetail(db, mergeHistoryShiftDetails(localDetail, remoteDetail), session.role === 'cashier'),
            }
          }
        } catch (fbErr) {
          log.warn('[ipc:get-history-shift-detail] Firestore no disponible; se usa detalle local', fbErr)
        }
      }

      return { ok: true, data: finishHistoryDetail(db, localDetail, session.role === 'cashier') }
    } catch (err) {
      log.error('[ipc:get-history-shift-detail] Error inesperado', err)
      return { ok: false, error: 'Error al obtener el detalle del turno.' }
    }
  })

  // --------------------------------------------------------------------------
  // GET_REMOTE_EMPLOYEE_VALES — vales desde Firestore (solo admin)
  // La cajera no tiene pantalla que lo use. La consulta siempre lleva fecha,
  // también cuando pide un local: no se bajan todos los vales de ese local.
  // --------------------------------------------------------------------------
  ipcMain.handle(
    IPC.GET_REMOTE_EMPLOYEE_VALES,
    async (_event, payload: unknown): Promise<IpcResult<RemoteEmployeeValeRow[]>> => {
      const parsed = getRemoteEmployeeValesSchema.safeParse(payload ?? {})
      if (!parsed.success) {
        log.error('[ipc:get-remote-employee-vales] Payload inválido', parsed.error)
        return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
      }

      const session = getActiveSession()
      if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
      if (session.role !== 'admin') {
        return { ok: false, error: 'Solo los administradores pueden ver vales remotos.', code: 'FORBIDDEN' }
      }

      if (!isFirebaseAvailable()) {
        return {
          ok: false,
          error: 'Firebase no disponible. Usá modo producción o conéctate a internet.',
          code: 'UNAVAILABLE',
        }
      }

      try {
        const filter = parsed.data?.storeIdFilter
        const storeIdFilter =
          !filter || filter === 'all' ? null : filter
        const rows = await fetchEmployeeValesFromFirestore(
          storeIdFilter,
          `${defaultHistoryFromDate()}T03:00:00.000Z`,
        )
        return { ok: true, data: rows }
      } catch (err) {
        log.error('[ipc:get-remote-employee-vales] Error inesperado', err)
        return { ok: false, error: 'Error al obtener vales remotos.' }
      }
    },
  )
}

const CASHIER_WINDOW_DENIED = {
  ok: false as const,
  error: 'Solo podés ver la semana en curso y la anterior.',
  code: 'FORBIDDEN' as const,
}

function finishHistoryDetail(
  db: ReturnType<typeof getDb>,
  detail: HistoryShiftDetail,
  hideMediaResPrice: boolean,
): HistoryShiftDetail {
  return withLocalUnpaid(db, withLocalVisits(db, detail, hideMediaResPrice))
}

function withLocalUnpaid(
  db: ReturnType<typeof getDb>,
  detail: HistoryShiftDetail,
): HistoryShiftDetail {
  const local = unpaidArrivalsForShift(db, detail.shift.id)
  const unpaidArrivals = unionUnpaid(detail.unpaidArrivals, local)
  if (unpaidArrivals.length === 0) return detail
  return { ...detail, unpaidArrivals }
}

function unionUnpaid(
  remote: HistoryUnpaidArrival[] | undefined,
  local: HistoryUnpaidArrival[],
): HistoryUnpaidArrival[] {
  const byId = new Map<string, HistoryUnpaidArrival>()
  for (const row of remote ?? []) byId.set(row.intakeId, row)
  for (const row of local) byId.set(row.intakeId, row)
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function unpaidArrivalsForShift(
  db: ReturnType<typeof getDb>,
  shiftId: string,
): HistoryUnpaidArrival[] {
  const intakes = db
    .select({
      id: merchandiseIntakes.id,
      createdAt: merchandiseIntakes.createdAt,
      providerName: merchandiseIntakes.providerName,
      paymentKind: merchandiseIntakes.paymentKind,
      status: merchandiseIntakes.status,
    })
    .from(merchandiseIntakes)
    .where(and(
      eq(merchandiseIntakes.shiftId, shiftId),
      eq(merchandiseIntakes.status, 'confirmed'),
      eq(merchandiseIntakes.paymentKind, 'none'),
    ))
    .all()
  if (intakes.length === 0) return []
  const lines = db
    .select()
    .from(merchandiseIntakeLines)
    .where(inArray(merchandiseIntakeLines.intakeId, intakes.map(intake => intake.id)))
    .all()
  const linesByIntake = new Map<string, typeof lines>()
  for (const line of lines) {
    const list = linesByIntake.get(line.intakeId) ?? []
    list.push(line)
    linesByIntake.set(line.intakeId, list)
  }
  const arrivals: HistoryUnpaidArrival[] = []
  for (const intake of intakes) {
    const arrival = unpaidArrivalFromIntake({
      intakeId: intake.id,
      createdAt: intake.createdAt,
      providerName: intake.providerName,
      paymentKind: intake.paymentKind,
      status: intake.status,
      lines: (linesByIntake.get(intake.id) ?? []).map(merchDbLineToSnapshot),
    })
    if (arrival) arrivals.push(arrival)
  }
  return arrivals
}

function withLocalVisits(
  db: ReturnType<typeof getDb>,
  detail: HistoryShiftDetail,
  hideMediaResPrice: boolean,
): HistoryShiftDetail {
  const missing = detail.expenses.filter(row => !row.visitLines || row.visitLines.length === 0)
  if (missing.length === 0) return detail
  const visits = intakeVisitsByExpense(db, missing.map(row => row.id), hideMediaResPrice)
  return {
    ...detail,
    expenses: detail.expenses.map(row => {
      if (row.visitLines && row.visitLines.length > 0) return row
      const visit = visits.get(row.id)
      if (!visit || visit.lines.length === 0) return row
      return {
        ...row,
        lineNames: visit.lines.map(line => line.name),
        visitLines: visit.lines,
        intakeId: visit.intakeId,
        intakeCreatedAt: visit.createdAt,
      }
    }),
  }
}

function cashierListOutsideWindow(fromDate?: string, toDate?: string): boolean {
  if (!fromDate) return true
  const window = cashierHistoryWindow()
  if (fromDate < window.fromYmd || fromDate > window.toYmd) return true
  if (toDate !== undefined && (toDate < window.fromYmd || toDate > window.toYmd || toDate < fromDate)) return true
  return false
}

function cashierShiftOutsideWindow(role: string, startedAt: string): boolean {
  if (role !== 'cashier') return false
  const ymd = civilYmd(new Date(startedAt))
  const window = cashierHistoryWindow()
  return ymd < window.fromYmd || ymd > window.toYmd
}

function intakeVisitsByExpense(
  db: ReturnType<typeof getDb>,
  expenseIds: string[],
  hideMediaResPrice: boolean,
): Map<string, { intakeId: string; createdAt: string; lines: ReturnType<typeof historyVisitLinesFromSnapshots> }> {
  const visits = new Map<string, { intakeId: string; createdAt: string; lines: ReturnType<typeof historyVisitLinesFromSnapshots> }>()
  if (expenseIds.length === 0) return visits
  const intakes = db
    .select({
      id: merchandiseIntakes.id,
      expenseId: merchandiseIntakes.expenseId,
      createdAt: merchandiseIntakes.createdAt,
      status: merchandiseIntakes.status,
    })
    .from(merchandiseIntakes)
    .where(inArray(merchandiseIntakes.expenseId, expenseIds))
    .all()
  const confirmed = intakes.filter(intake => intake.expenseId && intake.status === 'confirmed')
  if (confirmed.length === 0) return visits
  const lines = db
    .select()
    .from(merchandiseIntakeLines)
    .where(inArray(merchandiseIntakeLines.intakeId, confirmed.map(intake => intake.id)))
    .all()
  const linesByIntake = new Map<string, typeof lines>()
  for (const line of lines) {
    const list = linesByIntake.get(line.intakeId) ?? []
    list.push(line)
    linesByIntake.set(line.intakeId, list)
  }
  for (const intake of confirmed) {
    if (!intake.expenseId) continue
    const snapshots = (linesByIntake.get(intake.id) ?? []).map(merchDbLineToSnapshot)
    visits.set(intake.expenseId, {
      intakeId: intake.id,
      createdAt: intake.createdAt,
      lines: historyVisitLinesFromSnapshots(snapshots, hideMediaResPrice),
    })
  }
  return visits
}
