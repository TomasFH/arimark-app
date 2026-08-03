import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { eq, and, sum, count, isNotNull, gte, lte, asc } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import {
  shifts, sales, salePayments, saleItems, expenses,
  debtEvents, orders, users, products, providers,
} from '../db/schema'
import { getActiveSession } from '../activeSession'
import { isFirebaseAvailable } from '../licensing/firebase'
import {
  fetchHistoryShiftsFromFirestore,
  fetchHistoryShiftDetailFromFirestore,
  mergeHistoryShiftRows,
} from '../licensing/historyFirestore'
import type {
  IpcResult,
  HistoryShiftRow,
  HistoryShiftDetail,
} from '../../src/types/hw-api'

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

export function registerHistoryHandlers(): void {
  // --------------------------------------------------------------------------
  // GET_HISTORY_SHIFTS — lista de turnos cerrados con resumen (solo admin)
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
        isNotNull(shifts.closedAt),
        eq(shifts.source, 'desktop'),
      ] as ReturnType<typeof eq>[]
      if (effectiveStoreId !== null) conditions.push(eq(shifts.storeId, effectiveStoreId))
      if (filter.fromDate) conditions.push(gte(shifts.startedAt, filter.fromDate))
      if (filter.toDate) conditions.push(lte(shifts.startedAt, filter.toDate + 'T23:59:59.999Z'))

      // Con Firebase: traer más filas locales y paginar después del merge
      const shiftRows = db
        .select()
        .from(shifts)
        .where(and(...conditions))
        .orderBy(asc(shifts.startedAt))
        .limit(useRemote ? 500 : pageLimit)
        .offset(useRemote ? 0 : pageOffset)
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

      // Señas en efectivo por turno
      const depositsByShift = new Map<string, number>()
      const depositData = db
        .select({
          shiftId: orders.depositShiftId,
          total: sum(orders.depositAmount),
        })
        .from(orders)
        .where(eq(orders.depositMethod, 'cash'))
        .groupBy(orders.depositShiftId)
        .all()
        .filter(r => r.shiftId && shiftIds.includes(r.shiftId))

      for (const r of depositData) {
        if (r.shiftId) depositsByShift.set(r.shiftId, Number(r.total ?? 0))
      }

      const localResult: HistoryShiftRow[] = shiftRows.map(s => {
        const sv = salesByShift.get(s.id) ?? { count: 0, total: 0, cash: 0 }
        const exp = expensesByShift.get(s.id) ?? 0
        const dep = depositsByShift.get(s.id) ?? 0
        return {
          id: s.id,
          shiftType: s.shiftType,
          startedAt: s.startedAt,
          closedAt: s.closedAt!,
          cashierName: userMap.get(s.userId) ?? s.userId,
          salesCount: sv.count,
          totalRevenue: sv.total,
          totalCashSales: sv.cash,
          totalExpenses: exp,
          cashInHand: s.openingCash + sv.cash + dep - exp,
          totalDeposits: dep,
        }
      })

      if (!useRemote) return { ok: true, data: localResult }

      try {
        const remote = await fetchHistoryShiftsFromFirestore({
          fromDate: filter.fromDate,
          toDate: filter.toDate,
          effectiveStoreId,
        })
        const merged = mergeHistoryShiftRows(localResult, remote)
        return { ok: true, data: merged.slice(pageOffset, pageOffset + pageLimit) }
      } catch (fbErr) {
        log.warn('[ipc:get-history-shifts] Firestore no disponible; se usa solo local', fbErr)
        return { ok: true, data: localResult.slice(pageOffset, pageOffset + pageLimit) }
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

      // ---- Fiados del turno ----
      const debtRows = db
        .select({
          id: debtEvents.id,
          createdAt: debtEvents.createdAt,
          eventType: debtEvents.eventType,
          amount: debtEvents.amount,
          notes: debtEvents.notes,
          saleId: debtEvents.saleId,
        })
        .from(debtEvents)
        .innerJoin(sales, eq(debtEvents.saleId, sales.id))
        .where(and(
          eq(sales.shiftId, shiftId),
          eq(debtEvents.eventType, 'created'),
        ))
        .orderBy(asc(debtEvents.createdAt))
        .all()

      // Resolver nombres de clientes de fiados
      const debtSaleIds = debtRows.map(r => r.saleId).filter(Boolean) as string[]
      const saleCustomerMap = new Map<string, string | null>()
      if (debtSaleIds.length > 0) {
        const saleCustRows = db
          .select({ id: sales.id, customerId: sales.customerId })
          .from(sales)
          .all()
          .filter(r => debtSaleIds.includes(r.id))
        for (const r of saleCustRows) saleCustomerMap.set(r.id, r.customerId)
      }

      const historyDebts = debtRows.map(r => ({
        id: r.id,
        createdAt: r.createdAt,
        customerName: '(cliente)', // se resuelve abajo
        amount: r.amount,
        eventType: r.eventType as 'created',
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
        })
        .from(orders)
        .where(and(
          eq(orders.depositShiftId, shiftId),
        ))
        .orderBy(asc(orders.createdAt))
        .all()

      const historyDeposits = depositRows
        .filter(r => r.depositAmount > 0)
        .map(r => {
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
          }
        })

      // ---- Resumen ----
      const confirmedSales = historySales.filter(s => s.status === 'confirmed')
      const totalRevenue = confirmedSales.reduce((a, s) => a + s.total, 0)
      const totalCashSales = confirmedSales.reduce((a, s) => a + s.cashAmount, 0)
      const totalDebitSales = confirmedSales.reduce((a, s) => a + (s.paymentMethods.includes('debit') ? s.digitalAmount : 0), 0)
      const totalWalletSales = confirmedSales.reduce((a, s) => a + (s.paymentMethods.includes('wallet') ? s.digitalAmount : 0), 0)
      const totalCreditSales = confirmedSales.reduce((a, s) => a + (s.paymentMethods.includes('credit') ? s.digitalAmount : 0), 0)
      const totalExpenses = historyExpenses.reduce((a, e) => a + e.amount, 0)
      const cashDeposits = historyDeposits.filter(d => d.depositMethod === 'cash').reduce((a, d) => a + d.depositAmount, 0)
      const digitalDeposits = historyDeposits.filter(d => d.depositMethod && d.depositMethod !== 'cash').reduce((a, d) => a + d.depositAmount, 0)
      const cashInHand = shift.openingCash + totalCashSales + cashDeposits - totalExpenses

      return {
        ok: true,
        data: {
          shift: {
            id: shift.id,
            shiftType: shift.shiftType,
            startedAt: shift.startedAt,
            closedAt: shift.closedAt!,
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
        },
      }
    } catch (err) {
      log.error('[ipc:get-history-shift-detail] Error inesperado', err)
      return { ok: false, error: 'Error al obtener el detalle del turno.' }
    }
  })
}
