import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HistoryShiftRow } from '../../../src/types/hw-api'

vi.mock('../firebase', () => ({
  isFirebaseAvailable: vi.fn(() => false),
  getFirebaseApp: vi.fn(),
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn(() => ({ tenant_id: 'tenant-test' })),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((...args: unknown[]) => args),
  orderBy: vi.fn((...args: unknown[]) => args),
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import {
  mergeHistoryShiftRows,
  fetchHistoryShiftsFromFirestore,
  fetchEmployeeValesFromFirestore,
  sortHistoryShiftRowsNewestFirst,
  historyShiftDetailIsEmpty,
} from '../historyFirestore'
import { getDocs, where } from 'firebase/firestore'
import { isFirebaseAvailable } from '../firebase'
import type { HistoryShiftDetail } from '../../../src/types/hw-api'

function row(partial: Partial<HistoryShiftRow> & { id: string; startedAt: string }): HistoryShiftRow {
  return {
    shiftType: 'morning',
    closedAt: '2026-07-01T16:00:00.000Z',
    cashierName: 'c1',
    salesCount: null,
    totalRevenue: 0,
    totalCashSales: null,
    totalExpenses: 0,
    cashInHand: 0,
    totalDeposits: null,
    totalsSealed: false,
    ...partial,
  }
}

describe('historyFirestore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isFirebaseAvailable).mockReturnValue(false)
  })

  describe('mergeHistoryShiftRows', () => {
    it('prefer local si tiene igual o más movimiento que el remoto', () => {
      const local = [row({ id: 'a', startedAt: '2026-07-01T08:00:00.000Z', totalRevenue: 100, cashierName: 'Local' })]
      const remote = [row({ id: 'a', startedAt: '2026-07-01T08:00:00.000Z', totalRevenue: 50, cashierName: 'Remote' })]
      const merged = mergeHistoryShiftRows(local, remote)
      expect(merged).toHaveLength(1)
      expect(merged[0].cashierName).toBe('Local')
      expect(merged[0].totalRevenue).toBe(100)
    })

    it('en empate de movimiento se queda con el local', () => {
      const local = [row({ id: 'a', startedAt: '2026-07-01T08:00:00.000Z', salesCount: 2, totalRevenue: 50, cashierName: 'Local' })]
      const remote = [row({ id: 'a', startedAt: '2026-07-01T08:00:00.000Z', salesCount: 2, totalRevenue: 50, cashierName: 'Remote' })]
      const merged = mergeHistoryShiftRows(local, remote)
      expect(merged[0].cashierName).toBe('Local')
    })

    it('prefer remoto si el local es un stub sin ventas', () => {
      const local = [row({ id: 'a', startedAt: '2026-07-01T08:00:00.000Z', salesCount: 0, totalRevenue: 0, cashierName: 'Local' })]
      const remote = [row({
        id: 'a',
        startedAt: '2026-07-01T08:00:00.000Z',
        salesCount: 3,
        totalRevenue: 149620,
        cashierName: 'Remote',
      })]
      const merged = mergeHistoryShiftRows(local, remote)
      expect(merged).toHaveLength(1)
      expect(merged[0].cashierName).toBe('Remote')
      expect(merged[0].salesCount).toBe(3)
      expect(merged[0].totalRevenue).toBe(149620)
    })

    it('una ficha sellada gana a un local sin sellar aunque el vendido sea cero', () => {
      const local = [row({ id: 'a', startedAt: '2026-07-01T08:00:00.000Z', totalsSealed: false, totalRevenue: null })]
      const remote = [row({
        id: 'a',
        startedAt: '2026-07-01T08:00:00.000Z',
        totalsSealed: true,
        totalRevenue: 0,
        cashierName: 'Remote',
      })]
      const merged = mergeHistoryShiftRows(local, remote)
      expect(merged[0].cashierName).toBe('Remote')
      expect(merged[0].totalsSealed).toBe(true)
    })

    it('incluye turnos solo remotos', () => {
      const local = [row({ id: 'b', startedAt: '2026-07-02T08:00:00.000Z' })]
      const remote = [row({ id: 'a', startedAt: '2026-07-01T08:00:00.000Z' })]
      const merged = mergeHistoryShiftRows(local, remote)
      expect(merged.map(r => r.id).sort()).toEqual(['a', 'b'])
    })
  })

  describe('sortHistoryShiftRowsNewestFirst', () => {
    it('pone abiertos primero y después los más recientes', () => {
      const rows = [
        row({ id: 'old', startedAt: '2026-08-01T08:00:00.000Z', closedAt: '2026-08-01T16:00:00.000Z' }),
        row({ id: 'open', startedAt: '2026-08-10T08:00:00.000Z', closedAt: null }),
        row({ id: 'new', startedAt: '2026-08-20T08:00:00.000Z', closedAt: '2026-08-20T16:00:00.000Z' }),
      ]
      expect(sortHistoryShiftRowsNewestFirst(rows).map(r => r.id)).toEqual(['open', 'new', 'old'])
    })
  })

  describe('historyShiftDetailIsEmpty', () => {
    function detail(partial: Partial<HistoryShiftDetail> = {}): HistoryShiftDetail {
      return {
        shift: {
          id: 's1',
          shiftType: 'morning',
          startedAt: '2026-07-01T08:00:00.000Z',
          closedAt: '2026-07-01T16:00:00.000Z',
          cashierName: 'c1',
          openingCash: 1000,
          closingCash: 1000,
          deliveredAmount: 1000,
          deliveredTo: 'Admin',
          notes: null,
        },
        sales: [],
        expenses: [],
        debts: [],
        deposits: [],
        vales: [],
        summary: {
          salesCount: 0,
          totalRevenue: 0,
          totalCashSales: 0,
          totalDebitSales: 0,
          totalWalletSales: 0,
          totalCreditSales: 0,
          totalExpenses: 0,
          totalCashInjects: 0,
          cashDeposits: 0,
          digitalDeposits: 0,
          cashInHand: 1000,
          debtsCount: 0,
          totalDebts: 0,
        },
        ...partial,
      }
    }

    it('es true si no hay movimientos', () => {
      expect(historyShiftDetailIsEmpty(detail())).toBe(true)
    })

    it('es false si hay ventas', () => {
      expect(historyShiftDetailIsEmpty(detail({
        sales: [{
          id: 'sale-1',
          createdAt: '2026-07-01T10:00:00.000Z',
          total: 5000,
          status: 'confirmed',
          cashAmount: 5000,
          digitalAmount: 0,
          paymentMethods: ['cash'],
          manualEntry: false,
          isDebt: false,
          customerName: null,
          items: [],
        }],
      }))).toBe(false)
    })
  })

  describe('fetchHistoryShiftsFromFirestore', () => {
    it('retorna [] si Firebase no está disponible', async () => {
      const rows = await fetchHistoryShiftsFromFirestore({ effectiveStoreId: null })
      expect(rows).toEqual([])
    })

    it('pide solo las fichas del rango', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(getDocs).mockResolvedValue({
        docs: [
          {
            id: 'sealed',
            data: () => ({
              shiftType: 'morning',
              startedAt: '2026-11-20T11:00:00.000Z',
              closedAt: '2026-11-20T16:00:00.000Z',
              openingCash: 1000,
              cashierName: 'Ana',
              userId: 'uid-ana',
              soldTotal: 500_000,
              cashTotal: 400_000,
              cardWalletTotal: 100_000,
              debtTotal: 0,
              expenseTotal: 20_000,
              contributionTotal: 5_000,
              walletCashTotal: 0,
              moneySnapshottedAt: '2026-11-20T16:00:00.000Z',
            }),
          },
          {
            id: 'open',
            data: () => ({
              shiftType: 'evening',
              startedAt: '2026-11-20T20:00:00.000Z',
              closedAt: null,
              openingCash: 2000,
              cashierName: 'Ana',
              userId: 'uid-ana',
            }),
          },
        ],
      } as never)

      const rows = await fetchHistoryShiftsFromFirestore({
        fromDate: '2026-11-18',
        toDate: '2026-11-25',
        effectiveStoreId: null,
      })

      expect(getDocs).toHaveBeenCalledTimes(1)
      expect(where).not.toHaveBeenCalledWith('shiftId', 'in', expect.anything())
      expect(where).not.toHaveBeenCalledWith('depositShiftId', 'in', expect.anything())
      const sealed = rows.find(item => item.id === 'sealed')
      expect(sealed?.totalsSealed).toBe(true)
      expect(sealed?.totalRevenue).toBe(500_000)
      expect(sealed?.salesCount).toBeNull()
      expect(sealed?.cashInHand).toBe(1000 + 400_000 + 5_000 - 20_000)
      const open = rows.find(item => item.id === 'open')
      expect(open?.totalsSealed).toBe(false)
      expect(open?.totalRevenue).toBeNull()
    })
  })

  describe('fetchEmployeeValesFromFirestore', () => {
    it('con local la consulta también lleva el piso de fecha', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never)
      await fetchEmployeeValesFromFirestore('a497ca07-3777-4855-be66-b6e47950886b', '2026-11-18T03:00:00.000Z')
      expect(where).toHaveBeenCalledWith('storeId', '==', 'a497ca07-3777-4855-be66-b6e47950886b')
      expect(where).toHaveBeenCalledWith('createdAt', '>=', '2026-11-18T03:00:00.000Z')
    })
  })
})
