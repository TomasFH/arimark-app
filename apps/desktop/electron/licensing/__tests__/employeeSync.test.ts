/**
 * Tests del outbox de empleados / asistencia / vales / salarios (employeeSync).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, employees, attendance, employeeVales, salaryPayments, shifts } from '../../db/schema'
import { isNull, isNotNull } from 'drizzle-orm'

const { mockSetDoc, mockDoc, mockGetDocs, mockOnSnapshot } = vi.hoisted(() => ({
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockDoc: vi.fn(),
  mockGetDocs: vi.fn().mockResolvedValue({ size: 0, docs: [] }),
  mockOnSnapshot: vi.fn().mockReturnValue(vi.fn()),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: (...args: unknown[]) => { mockDoc(...args); return { path: args.join('/') } },
  collection: vi.fn(() => ({})),
  setDoc: mockSetDoc,
  getDocs: mockGetDocs,
  onSnapshot: mockOnSnapshot,
}))

vi.mock('../firebase', () => ({
  getFirebaseApp: vi.fn(() => ({})),
  isFirebaseAvailable: vi.fn(() => true),
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

import { getDb } from '../../db/client'
import { isFirebaseAvailable } from '../firebase'
import {
  pushUnsyncedAttendance,
  pushUnsyncedVales,
  pushUnsyncedSalaryPayments,
  pushUnsyncedEmployees,
  pushUnsyncedEmployeeOps,
  pullEmployeesFromFirestore,
  ensureEmployeesSynced,
  stopEmployeeSyncListener,
} from '../employeeSync'

const TENANT = 'test-tenant'

describe('employeeSync', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    stopEmployeeSyncListener()
    mockOnSnapshot.mockReturnValue(vi.fn())
    mockGetDocs.mockResolvedValue({ size: 0, docs: [] })
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    const instance = await createInMemoryDb()
    db = instance.db

    const now = new Date().toISOString()
    db.insert(stores).values({ id: 'store-001', name: 'Local A', createdAt: now }).run()
    db.insert(users).values({
      id: 'user-001',
      name: 'Cajera',
      storeId: 'store-001',
      role: 'cashier',
      active: true,
      createdAt: now,
    }).run()
    db.insert(employees).values({
      id: 'emp-001',
      name: 'Carnicero Uno',
      weeklyWage: 100000,
      active: true,
      createdAt: now,
      syncedAt: now, // ya sincronizado — no interferir en tests de eventos
    }).run()
    db.insert(shifts).values({
      id: 'shift-001',
      storeId: 'store-001',
      userId: 'user-001',
      shiftType: 'morning',
      startedAt: now,
      openingCash: 0,
      source: 'desktop',
    }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
  })

  describe('pushUnsyncedEmployees', () => {
    it('pushea empleados con syncedAt=null', async () => {
      const now = new Date().toISOString()
      db.insert(employees).values({
        id: 'emp-pending',
        name: 'Nuevo',
        weeklyWage: 50000,
        active: true,
        createdAt: now,
        syncedAt: null,
      }).run()

      await pushUnsyncedEmployees(TENANT)

      expect(mockSetDoc).toHaveBeenCalledTimes(1)
      expect(mockDoc).toHaveBeenCalledWith(
        expect.anything(),
        'licenses',
        TENANT,
        'employees',
        'emp-pending',
      )
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'emp-pending',
          name: 'Nuevo',
          weeklyWage: 50000,
          active: true,
          deleted: false,
        }),
        { merge: true },
      )
      expect(db.select().from(employees).where(isNull(employees.syncedAt)).all()).toHaveLength(0)
    })
  })

  describe('pullEmployeesFromFirestore', () => {
    it('upsertea empleados remotos en SQLite', async () => {
      const createdAt = new Date().toISOString()
      mockGetDocs.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'emp-remote',
            data: () => ({
              id: 'emp-remote',
              name: 'Remoto',
              weeklyWage: 80000,
              active: true,
              createdAt,
            }),
          },
        ],
      })

      await pullEmployeesFromFirestore(TENANT)
      const row = db.select().from(employees).all().find(e => e.id === 'emp-remote')
      expect(row).toBeDefined()
      expect(row!.name).toBe('Remoto')
      expect(row!.weeklyWage).toBe(80000)
    })

    it('aplica homeStoreId remoto', async () => {
      mockGetDocs.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'emp-home',
            data: () => ({
              id: 'emp-home',
              name: 'Con casa',
              weeklyWage: 1,
              active: true,
              homeStoreId: 'store-001',
            }),
          },
        ],
      })
      await pullEmployeesFromFirestore(TENANT)
      const row = db.select().from(employees).all().find(e => e.id === 'emp-home')
      expect(row?.homeStoreId).toBe('store-001')
    })

    it('acepta salary y createdAt omitido (docs móviles)', async () => {
      mockGetDocs.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'emp-mobile',
            data: () => ({
              id: 'emp-mobile',
              name: 'Desde Celu',
              salary: 55000,
              archivedAt: null,
            }),
          },
        ],
      })

      await pullEmployeesFromFirestore(TENANT)
      const row = db.select().from(employees).all().find(e => e.id === 'emp-mobile')
      expect(row).toBeDefined()
      expect(row!.weeklyWage).toBe(55000)
      expect(row!.active).toBe(true)
      expect(row!.createdAt).toBeTruthy()
    })
  })

  describe('ensureEmployeesSynced', () => {
    it('pushea, hace pull y arranca listener', async () => {
      const now = new Date().toISOString()
      db.insert(employees).values({
        id: 'emp-x',
        name: 'X',
        weeklyWage: 1,
        active: true,
        createdAt: now,
        syncedAt: null,
      }).run()

      await ensureEmployeesSynced(TENANT)
      expect(mockSetDoc).toHaveBeenCalled()
      expect(mockGetDocs).toHaveBeenCalled()
      expect(mockOnSnapshot).toHaveBeenCalled()
    })
  })

  describe('pushUnsyncedAttendance', () => {
    it('pushea solo syncedAt=null e incluye employeeName', async () => {
      const now = new Date().toISOString()
      db.insert(attendance).values({
        id: 'att-pending',
        employeeId: 'emp-001',
        date: '2026-08-02',
        status: 'present',
        note: null,
        recordedBy: 'user-001',
        createdAt: now,
        syncedAt: null,
      }).run()
      db.insert(attendance).values({
        id: 'att-synced',
        employeeId: 'emp-001',
        date: '2026-08-01',
        status: 'absent',
        note: 'viaje',
        recordedBy: 'user-001',
        createdAt: now,
        syncedAt: now,
      }).run()

      await pushUnsyncedAttendance(TENANT)

      expect(mockSetDoc).toHaveBeenCalledTimes(1)
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'att-pending',
          employeeName: 'Carnicero Uno',
          status: 'present',
          deleted: false,
        }),
        { merge: true },
      )

      expect(db.select().from(attendance).where(isNull(attendance.syncedAt)).all()).toHaveLength(0)
      expect(db.select().from(attendance).where(isNotNull(attendance.syncedAt)).all()).toHaveLength(2)
    })

    it('no-op si Firebase no está disponible', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      db.insert(attendance).values({
        id: 'att-1',
        employeeId: 'emp-001',
        date: '2026-08-02',
        status: 'late',
        recordedBy: 'user-001',
        createdAt: new Date().toISOString(),
        syncedAt: null,
      }).run()

      await pushUnsyncedAttendance(TENANT)
      expect(mockSetDoc).not.toHaveBeenCalled()
      expect(db.select().from(attendance).where(isNull(attendance.syncedAt)).all()).toHaveLength(1)
    })
  })

  describe('pushUnsyncedVales', () => {
    it('pushea vales pendientes a employeeVales', async () => {
      const now = new Date().toISOString()
      db.insert(employeeVales).values({
        id: 'vale-1',
        employeeId: 'emp-001',
        shiftId: 'shift-001',
        amount: 5000,
        description: 'adelanto',
        paidAt: now,
        recordedBy: 'user-001',
        createdAt: now,
        syncedAt: null,
      }).run()

      await pushUnsyncedVales(TENANT)

      expect(mockSetDoc).toHaveBeenCalledTimes(1)
      expect(mockDoc).toHaveBeenCalledWith(
        expect.anything(),
        'licenses',
        TENANT,
        'employeeVales',
        'vale-1',
      )
      expect(mockSetDoc.mock.calls[0]?.[1]).toMatchObject({
        storeId: 'store-001',
        employeeName: 'Carnicero Uno',
        amount: 5000,
        description: 'adelanto',
        cancelledAt: null,
      })
      expect(db.select().from(employeeVales).where(isNull(employeeVales.syncedAt)).all()).toHaveLength(0)
    })
  })

  describe('pushUnsyncedSalaryPayments', () => {
    it('pushea pagos pendientes a salaryPayments', async () => {
      const now = new Date().toISOString()
      db.insert(salaryPayments).values({
        id: 'pay-1',
        employeeId: 'emp-001',
        shiftId: 'shift-001',
        amount: 100000,
        weekStart: '2026-07-27',
        valesDeducted: 5000,
        netPaid: 95000,
        recordedBy: 'user-001',
        paidAt: now,
        syncedAt: null,
      }).run()

      await pushUnsyncedSalaryPayments(TENANT)

      expect(mockSetDoc).toHaveBeenCalledTimes(1)
      expect(mockDoc).toHaveBeenCalledWith(
        expect.anything(),
        'licenses',
        TENANT,
        'salaryPayments',
        'pay-1',
      )
      expect(db.select().from(salaryPayments).where(isNull(salaryPayments.syncedAt)).all()).toHaveLength(0)
    })
  })

  describe('pushUnsyncedEmployeeOps', () => {
    it('drena maestro + las tres colas de eventos', async () => {
      const now = new Date().toISOString()
      db.insert(employees).values({
        id: 'emp-ops',
        name: 'Ops',
        weeklyWage: 1,
        active: true,
        createdAt: now,
        syncedAt: null,
      }).run()
      db.insert(attendance).values({
        id: 'a1',
        employeeId: 'emp-001',
        date: '2026-08-02',
        status: 'present',
        recordedBy: 'user-001',
        createdAt: now,
        syncedAt: null,
      }).run()
      db.insert(employeeVales).values({
        id: 'v1',
        employeeId: 'emp-001',
        amount: 1000,
        paidAt: now,
        recordedBy: 'user-001',
        createdAt: now,
        syncedAt: null,
      }).run()
      db.insert(salaryPayments).values({
        id: 'p1',
        employeeId: 'emp-001',
        amount: 10000,
        weekStart: '2026-07-27',
        valesDeducted: 0,
        netPaid: 10000,
        recordedBy: 'user-001',
        paidAt: now,
        syncedAt: null,
      }).run()

      await pushUnsyncedEmployeeOps(TENANT)
      expect(mockSetDoc).toHaveBeenCalledTimes(4)
    })
  })
})
