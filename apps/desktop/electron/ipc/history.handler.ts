import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { eq, and, sum, count, gte, lte, asc, desc } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import {
  shifts, sales, salePayments, saleItems, expenses,
  debtEvents, orders, users, products, providers, customers,
  employeeVales, employees,
} from '../db/schema'
import { getActiveSession } from '../activeSession'
import { isFirebaseAvailable } from '../licensing/firebase'
import {
  fetchHistoryShiftsFromFirestore,
  fetchHistoryShiftDetailFromFirestore,
  fetchEmployeeValesFromFirestore,
  mergeHistoryShiftRows,
  sortHistoryShiftRowsNewestFirst,
  historyShiftDetailIsEmpty,
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
  // GET_HISTORY_SHIFTS — lista de turnos (abiertos y cerrados) con resumen (solo admin)
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.GET_HISTORY_SHIFTS, async (_event, payload: unknown): Promise<IpcResult<HistoryShiftRow[]>> => {
    const parsed = getHistoryShiftsSchema.safeParse(payload ?? {})
    if (!parsed.success) {
      log.error('[ipc:get-history-shifts] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo los administradores pueden ver el historial.', code: 'FORBIDDEN' }

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

      const conditions = [
        eq(shifts.source, 'desktop'),
      ] as ReturnType<typeof eq>[]
      if (effectiveStoreId !== null) conditions.push(eq(shifts.storeId, effectiveStoreId))
      if (filter.fromDate) conditions.push(gte(shifts.startedAt, filter.fromDate))
      if (filter.toDate) conditions.push(lte(shifts.startedAt, filter.toDate + 'T23:59:59.999Z'))

      const shiftRows = db
        .select()
        .from(shifts)
        .where(and(...conditions))
        .orderBy(desc(shifts.startedAt))
        .limit(500)
        .all()

      if (shiftRows.length === 0 && !useRemote) return { ok: true, data: [] }

      const shiftIds = shiftRows.map(s => s.id)
      const userIds = [...new Set(shiftRows.map(s => s.userId))]

      // Nombres de cajeras
      const userRows = userIds.length > 0
        ? db.select({ id: users.id, name: users.name }).from(users).all().filter(u => userIds.includes(u.id))
        : []
      const userMap = new Map(userRows.map(u => [u.id, u.name]))

      // Ventas por turno (solo confirmed)
      const salesByShift = new Map<string, { count: number; total: number; cash: number }>()
      const salesData = db
        .select({
          shiftId: sales.shiftId,
          salesCount: count(sales.id),
          totalRevenue: sum(sales.total),
        })
        .from(sales)
        .where(and(
          eq(sales.status, 'confirmed'),
          // Filter by shiftIds - we'll post-filter since drizzle inArray may not exist at runtime
        ))
        .groupBy(sales.shiftId)
        .all()
        .filter(r => shiftIds.includes(r.shiftId))

      for (const r of salesData) {
        salesByShift.set(r.shiftId, {
          count: r.salesCount,
          total: Number(r.totalRevenue ?? 0),
          cash: 0,
        })
      }

      // Efectivo por turno
      const cashData = db
        .select({
          shiftId: sales.shiftId,
          totalCash: sum(salePayments.amount),
        })
        .from(salePayments)
        .innerJoin(sales, eq(salePayments.saleId, sales.id))
        .where(and(
          eq(sales.status, 'confirmed'),
          eq(salePayments.paymentMethod, 'cash'),
        ))
        .groupBy(sales.shiftId)
        .all()
        .filter(r => shiftIds.includes(r.shiftId))

      for (const r of cashData) {
        const entry = salesByShift.get(r.shiftId)
        if (entry) entry.cash = Number(r.totalCash ?? 0)
      }

      // Gastos por turno
      const expensesByShift = new Map<string, number>()
      const expData = db
        .select({
          shiftId: expenses.shiftId,
          total: sum(expenses.amount),
        })
        .from(expenses)
        .groupBy(expenses.shiftId)
        .all()
        .filter(r => shiftIds.includes(r.shiftId))

      for (const r of expData) {
        expensesByShift.set(r.shiftId, Number(r.total ?? 0))
      }

      // Señas en efectivo por turno (parsea depositPayments mixto, igual que el cierre)
      const depositsByShift = new Map<string, number>()
      if (shiftIds.length > 0) {
        const depositRows = db
          .select({
            shiftId: orders.depositShiftId,
            depositAmount: orders.depositAmount,
            depositMethod: orders.depositMethod,
            depositPayments: orders.depositPayments,
          })
          .from(orders)
          .all()
          .filter(r => r.shiftId && shiftIds.includes(r.shiftId) && r.depositAmount > 0)

        for (const r of depositRows) {
          if (!r.shiftId) continue
          depositsByShift.set(r.shiftId, (depositsByShift.get(r.shiftId) ?? 0) + cashAmountFromDeposit(r))
        }
      }

      // Cobranzas de fiado en efectivo por turno (amount negativo en ledger)
      const cashDebtByShift = new Map<string, number>()
      const cashDebtData = db
        .select({
          shiftId: debtEvents.shiftId,
          total: sum(debtEvents.amount),
        })
        .from(debtEvents)
        .where(eq(debtEvents.paymentMethod, 'cash'))
        .groupBy(debtEvents.shiftId)
        .all()
        .filter(r => r.shiftId && shiftIds.includes(r.shiftId))

      for (const r of cashDebtData) {
        if (r.shiftId) cashDebtByShift.set(r.shiftId, Math.abs(Number(r.total ?? 0)))
      }

      const localResult: HistoryShiftRow[] = shiftRows.map(s => {
        const sv = salesByShift.get(s.id) ?? { count: 0, total: 0, cash: 0 }
        const exp = expensesByShift.get(s.id) ?? 0
        const dep = depositsByShift.get(s.id) ?? 0
        const debtCash = cashDebtByShift.get(s.id) ?? 0
        return {
          id: s.id,
          shiftType: s.shiftType,
          startedAt: s.startedAt,
          closedAt: s.closedAt ?? null,
          cashierName: userMap.get(s.userId) ?? s.userId,
          salesCount: sv.count,
          totalRevenue: sv.total,
          totalCashSales: sv.cash,
          totalExpenses: exp,
          cashInHand: s.openingCash + sv.cash + dep + debtCash - exp,
          totalDeposits: dep,
        }
      })

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
    if (session.role !== 'admin') return { ok: false, error: 'Solo los administradores pueden ver el historial.', code: 'FORBIDDEN' }

    const { shiftId } = parsed.data

    try {
      const db = getDb()

      const shift = db.select().from(shifts).where(eq(shifts.id, shiftId)).all()[0]
      if (!shift) {
        // PC sin SQLite del local: intentar Firestore
        if (isFirebaseAvailable()) {
          try {
            const remoteDetail = await fetchHistoryShiftDetailFromFirestore(shiftId)
            if (remoteDetail) return { ok: true, data: remoteDetail }
          } catch (fbErr) {
            log.warn('[ipc:get-history-shift-detail] Firestore no disponible', fbErr)
          }
        }
        return { ok: false, error: 'Turno no encontrado.', code: 'NOT_FOUND' }
      }

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
      const paymentsMap = new Map<string, { cash: number; digital: number; methods: Array<'cash' | 'debit' | 'wallet' | 'credit'> }>()
      if (saleIdList.length > 0) {
        const payRows = db
          .select({ saleId: salePayments.saleId, method: salePayments.paymentMethod, amount: salePayments.amount })
          .from(salePayments)
          .all()
          .filter(r => saleIdList.includes(r.saleId))

        for (const p of payRows) {
          if (!paymentsMap.has(p.saleId)) paymentsMap.set(p.saleId, { cash: 0, digital: 0, methods: [] })
          const entry = paymentsMap.get(p.saleId)!
          if (p.method === 'cash') entry.cash += p.amount
          else entry.digital += p.amount
          if (!entry.methods.includes(p.method as 'cash' | 'debit' | 'wallet' | 'credit')) {
            entry.methods.push(p.method as 'cash' | 'debit' | 'wallet' | 'credit')
          }
        }
      }

      // Clientes con deuda (para resolución de nombre)
      const historySales = salesRows.map(s => {
        const pay = paymentsMap.get(s.id) ?? { cash: 0, digital: 0, methods: [] }
        return {
          id: s.id,
          createdAt: s.createdAt,
          total: s.total,
          status: s.status as 'confirmed' | 'cancelled',
          cashAmount: pay.cash,
          digitalAmount: pay.digital,
          paymentMethods: pay.methods,
          manualEntry: s.manualEntry,
          isDebt: s.isDebt,
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

      const historyExpenses = expRows.map(r => ({
        id: r.id,
        createdAt: r.createdAt,
        concept: r.concept ?? undefined,
        provider: r.providerId ? (expProviderMap.get(r.providerId) ?? undefined) : undefined,
        amount: r.amount,
        notes: r.notes,
        createdBy: expUserMap.get(r.createdBy) ?? r.createdBy,
      }))

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
      const totalExpenses = historyExpenses.reduce((a, e) => a + e.amount, 0)
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
      const cashInHand = shift.openingCash + totalCashSales + cashDeposits + cashDebtPayments - totalExpenses

      const localDetail: HistoryShiftDetail = {
        shift: {
          id: shift.id,
          shiftType: shift.shiftType,
          startedAt: shift.startedAt,
          closedAt: shift.closedAt ?? null,
          cashierName,
          openingCash: shift.openingCash,
          closingCash: shift.closingCash,
          deliveredAmount: shift.deliveredAmount,
          deliveredTo: shift.deliveredTo,
          notes: shift.notes,
        },
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
          cashDeposits,
          digitalDeposits,
          cashInHand,
          debtsCount: historyDebts.length,
          totalDebts: historyDebts.reduce((a, d) => a + d.amount, 0),
        },
      }

      // SQLite remoto a menudo tiene el turno (reconcile) pero no las ventas.
      // Si no hay movimientos locales, el detalle sale de Firestore.
      if (isFirebaseAvailable() && historyShiftDetailIsEmpty(localDetail)) {
        try {
          const remoteDetail = await fetchHistoryShiftDetailFromFirestore(shiftId)
          if (remoteDetail) return { ok: true, data: remoteDetail }
        } catch (fbErr) {
          log.warn('[ipc:get-history-shift-detail] Firestore no disponible; se usa detalle local', fbErr)
        }
      }

      return { ok: true, data: localDetail }
    } catch (err) {
      log.error('[ipc:get-history-shift-detail] Error inesperado', err)
      return { ok: false, error: 'Error al obtener el detalle del turno.' }
    }
  })

  // --------------------------------------------------------------------------
  // GET_REMOTE_EMPLOYEE_VALES — vales desde Firestore (admin remoto)
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
        const rows = await fetchEmployeeValesFromFirestore(storeIdFilter)
        return { ok: true, data: rows }
      } catch (err) {
        log.error('[ipc:get-remote-employee-vales] Error inesperado', err)
        return { ok: false, error: 'Error al obtener vales remotos.' }
      }
    },
  )
}
