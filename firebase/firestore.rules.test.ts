/**
 * Reglas por rol contra el emulador local.
 * No publica nada: corre solo con `pnpm test:rules` (Java 21).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore'

const rulesPath = fileURLToPath(new URL('./firestore.rules', import.meta.url))

const TENANT = 'lic-a'
const OTHER = 'lic-b'
const SEAL = '2026-11-19T12:00:00.000Z'

const sealedMoney = {
  soldTotal: 1000,
  cashTotal: 800,
  cardWalletTotal: 200,
  debitTotal: 100,
  walletTotal: 50,
  creditTotal: 50,
  debtTotal: 0,
  expenseTotal: 20,
  contributionTotal: 0,
  walletCashTotal: 10,
  soldHoursJson: '[]',
  moneySnapshottedAt: SEAL,
}

function shift(db: Firestore, id: string, license = TENANT) {
  return doc(db, 'licenses', license, 'shifts', id)
}

describe('reglas por rol', () => {
  let env: RulesTestEnvironment

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-carniceria',
      firestore: { rules: readFileSync(rulesPath, 'utf8') },
    })

    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await setDoc(doc(db, 'licenses', TENANT, 'users', 'cashier-a'), { role: 'cashier' })
      await setDoc(doc(db, 'licenses', TENANT, 'users', 'admin-a'), { role: 'admin', active: true })
      await setDoc(doc(db, 'licenses', TENANT, 'users', 'butcher-a'), { role: 'butcher', active: true })
      await setDoc(doc(db, 'licenses', TENANT, 'users', 'cashier-off'), { role: 'cashier', active: false })
      await setDoc(doc(db, 'licenses', OTHER, 'users', 'cashier-b'), { role: 'cashier', active: true })
      await setDoc(shift(db, 'sealed'), { storeId: 'local-1', notes: null, ...sealedMoney })
      await setDoc(shift(db, 'open'), { storeId: 'local-1', soldTotal: null, moneySnapshottedAt: null })
      await setDoc(doc(db, 'licenses', TENANT, 'salaryPayments', 'pay-seed'), {
        shiftId: 'shift-1',
        employeeId: 'emp-1',
        amount: 5000,
        weekStart: '2026-11-16',
      })
      await setDoc(doc(db, 'licenses', TENANT, 'employeeVales', 'vale-seed'), {
        shiftId: 'shift-1',
        employeeId: 'emp-1',
        amount: 200,
      })
    })
  })

  afterAll(async () => {
    await env.cleanup()
  })

  function db(uid: string | null): Firestore {
    if (uid == null) return env.unauthenticatedContext().firestore()
    return env.authenticatedContext(uid).firestore()
  }

  it('sin sesión no lee un turno', async () => {
    await assertFails(getDoc(shift(db(null), 'sealed')))
  })

  it('la sesión anónima no lee ni escribe datos operativos', async () => {
    const anon = db('anon-1')
    await assertFails(getDoc(shift(anon, 'sealed')))
    await assertFails(setDoc(doc(anon, 'licenses', TENANT, 'sales', 'sale-anon'), { total: 1 }))
  })

  it('una cajera de otra licencia no opera en esta', async () => {
    const other = db('cashier-b')
    await assertFails(getDoc(shift(other, 'sealed')))
    await assertFails(setDoc(doc(other, 'licenses', TENANT, 'sales', 'sale-other'), { total: 1 }))
    await assertSucceeds(setDoc(doc(other, 'licenses', OTHER, 'sales', 'sale-own'), { total: 1 }))
  })

  it('una cajera inactiva no opera', async () => {
    await assertFails(getDoc(shift(db('cashier-off'), 'sealed')))
  })

  it('la cajera de la licencia vende y anota gastos', async () => {
    const cashier = db('cashier-a')
    await assertSucceeds(setDoc(doc(cashier, 'licenses', TENANT, 'sales', 'sale-1'), {
      shiftId: 'open',
      storeId: 'local-2',
      total: 1500,
    }))
    await assertSucceeds(setDoc(doc(cashier, 'licenses', TENANT, 'expenses', 'exp-1'), {
      shiftId: 'open',
      storeId: 'local-2',
      amount: 200,
      concept: 'Hielo',
    }))
  })

  it('la cajera sella una ficha abierta y no puede cambiar la plata después', async () => {
    const cashier = db('cashier-a')
    await assertSucceeds(updateDoc(shift(cashier, 'open'), {
      soldTotal: 400,
      providerExpenseTotal: 0,
      moneySnapshottedAt: SEAL,
    }))
    await assertFails(updateDoc(shift(cashier, 'sealed'), { soldTotal: 1 }))
    await assertFails(updateDoc(shift(cashier, 'sealed'), { providerExpenseTotal: 99 }))
  })

  it('un reenvío con los mismos valores de plata no se rechaza', async () => {
    const cashier = db('cashier-a')
    await assertSucceeds(updateDoc(shift(cashier, 'sealed'), sealedMoney))
    await assertSucceeds(updateDoc(shift(cashier, 'sealed'), { cashLeft: 300, notes: 'queda en caja' }))
  })

  it('la cajera crea y lee sueldos y vales de su turno, y no lista la colección', async () => {
    const cashier = db('cashier-a')
    await assertSucceeds(setDoc(doc(cashier, 'licenses', TENANT, 'salaryPayments', 'pay-1'), {
      shiftId: 'shift-1',
      employeeId: 'emp-1',
      amount: 1000,
      weekStart: '2026-11-16',
    }))
    await assertSucceeds(setDoc(doc(cashier, 'licenses', TENANT, 'employeeVales', 'vale-1'), {
      shiftId: 'shift-1',
      employeeId: 'emp-1',
      amount: 100,
    }))
    await assertFails(setDoc(doc(cashier, 'licenses', TENANT, 'salaryPayments', 'pay-loose'), {
      employeeId: 'emp-1',
      amount: 1000,
      weekStart: '2026-11-16',
    }))
    await assertSucceeds(getDoc(doc(cashier, 'licenses', TENANT, 'salaryPayments', 'pay-seed')))
    await assertFails(getDocs(collection(cashier, 'licenses', TENANT, 'salaryPayments')))
    await assertFails(getDocs(collection(cashier, 'licenses', TENANT, 'employeeVales')))
  })

  it('el admin puede corregir la ficha y listar sueldos, y no puede borrar', async () => {
    const admin = db('admin-a')
    await assertSucceeds(updateDoc(shift(admin, 'sealed'), { soldTotal: 50 }))
    await assertSucceeds(getDocs(collection(admin, 'licenses', TENANT, 'salaryPayments')))
    await assertSucceeds(setDoc(doc(admin, 'licenses', TENANT, 'salaryPayments', 'pay-admin'), {
      employeeId: 'emp-1',
      amount: 1000,
      weekStart: '2026-11-16',
    }))
    await assertFails(deleteDoc(doc(admin, 'licenses', TENANT, 'sales', 'sale-1')))
    await assertFails(deleteDoc(shift(admin, 'sealed')))
  })

  it('el carnicero no accede a datos operativos y sí lee su perfil', async () => {
    const butcher = db('butcher-a')
    await assertFails(getDoc(shift(butcher, 'sealed')))
    await assertFails(setDoc(doc(butcher, 'licenses', TENANT, 'sales', 'sale-butcher'), { total: 1 }))
    await assertFails(getDoc(doc(butcher, 'licenses', TENANT, 'orders', 'order-1')))
    await assertFails(getDocs(collection(butcher, 'licenses', TENANT, 'salaryPayments')))
    await assertSucceeds(getDoc(doc(butcher, 'licenses', TENANT, 'users', 'butcher-a')))
  })

  it('la cajera no cambia su rol ni su active', async () => {
    const cashier = db('cashier-a')
    const profile = doc(cashier, 'licenses', TENANT, 'users', 'cashier-a')
    await assertFails(updateDoc(profile, { role: 'admin' }))
    await assertFails(updateDoc(profile, { active: false }))
  })

  it('un usuario autenticado sin documento no opera', async () => {
    const ghost = db('sin-ficha')
    await assertFails(getDoc(shift(ghost, 'sealed')))
    await assertFails(setDoc(doc(ghost, 'licenses', TENANT, 'expenses', 'exp-ghost'), { amount: 1 }))
  })

  it('el admin consulta turnos de la semana, ingresos y gastos por turno', async () => {
    const admin = db('admin-a')
    await setDoc(doc(admin, 'licenses', TENANT, 'shifts', 'week-shift'), {
      storeId: 'local-1',
      startedAt: '2026-11-18T12:00:00.000Z',
    })
    await setDoc(doc(admin, 'licenses', TENANT, 'expenses', 'week-exp'), {
      shiftId: 'week-shift',
      amount: 100,
      concept: 'Hielo',
    })
    await setDoc(doc(admin, 'licenses', TENANT, 'expenses', 'week-exp-2'), {
      shiftId: 'week-other',
      amount: 50,
    })
    await setDoc(doc(admin, 'licenses', TENANT, 'merchandiseIntakes', 'week-in'), {
      storeId: 'local-1',
      shiftId: 'week-shift',
      createdAt: '2026-11-18T15:00:00.000Z',
      lines: [{ productName: 'Asado', quantity: 10, unit: 'kg' }],
    })

    await assertSucceeds(getDocs(query(
      collection(admin, 'licenses', TENANT, 'shifts'),
      where('storeId', '==', 'local-1'),
      where('startedAt', '>=', '2026-11-16T00:00:00.000Z'),
      where('startedAt', '<', '2026-11-23T00:00:00.000Z'),
      orderBy('startedAt', 'desc'),
    )))
    await assertSucceeds(getDocs(query(
      collection(admin, 'licenses', TENANT, 'merchandiseIntakes'),
      where('storeId', '==', 'local-1'),
      where('createdAt', '>=', '2026-11-16T00:00:00.000Z'),
      where('createdAt', '<', '2026-11-23T00:00:00.000Z'),
    )))
    await assertSucceeds(getDocs(query(
      collection(admin, 'licenses', TENANT, 'expenses'),
      where('shiftId', 'in', ['week-shift', 'week-other']),
    )))
  })

  it('cajera y admin operan cada ruta que la app escribe', async () => {
    const routes: { path: string; body: Record<string, unknown>; patch: Record<string, unknown> }[] = [
      { path: 'stores/inv-store', body: { name: 'Local' }, patch: { name: 'Local centro' } },
      { path: 'catalog/local-1', body: { products: [] }, patch: { products: [{ name: 'Asado' }] } },
      { path: 'catalog/local-1/revisions/rev-1', body: { products: [] }, patch: { note: 'antes' } },
      { path: 'sync/local-1/shifts/sync-shift', body: { storeId: 'local-1' }, patch: { importedAt: null } },
      { path: 'sync/local-1/shifts/sync-shift/sales/s1', body: { total: 10 }, patch: { importedAt: null } },
      { path: 'sync/local-1/shifts/sync-shift/expenses/e1', body: { amount: 5 }, patch: { importedAt: null } },
      { path: 'sync/local-1/shifts/sync-shift/cebo/c1', body: { quantity: 1 }, patch: { importedAt: null } },
      { path: 'sync/local-1/shifts/sync-shift/merch/m1', body: { lines: [] }, patch: { importedAt: null } },
      { path: 'sync/local-1/shifts/sync-shift/vales/v1', body: { amount: 20 }, patch: { importedAt: null } },
      { path: 'sync/local-1/shifts/sync-shift/salaryPayments/p1', body: { amount: 1000 }, patch: { importedAt: null } },
      { path: 'providers/prov-1', body: { name: 'Frigorífico' }, patch: { name: 'Frigorífico Norte' } },
      { path: 'providerDebtEvents/evt-1', body: { providerId: 'prov-1', amount: 100 }, patch: { note: 'ajuste' } },
      { path: 'providerDebtCheckpoints/prov-1__local-1', body: { saldoAcumulado: 0 }, patch: { saldoAcumulado: 100 } },
      { path: 'shifts/inv-shift', body: { storeId: 'local-1', startedAt: '2026-11-18T08:00:00.000Z' }, patch: { notes: 'abierto' } },
      { path: 'sales/inv-sale', body: { shiftId: 'inv-shift', total: 1500 }, patch: { status: 'cancelled' } },
      { path: 'expenses/inv-exp', body: { shiftId: 'inv-shift', amount: 200 }, patch: { concept: 'Hielo' } },
      { path: 'ceboEntries/inv-cebo', body: { storeId: 'local-1', quantity: 2 }, patch: { quantity: 3 } },
      {
        path: 'merchandiseIntakes/inv-merch',
        body: {
          storeId: 'local-1',
          shiftId: 'inv-shift',
          createdAt: '2026-11-18T09:00:00.000Z',
          lines: [{ productName: 'Asado', quantity: 10, unit: 'kg' }],
        },
        patch: { notes: 'llegó a la mañana' },
      },
      { path: 'merchandiseIntakeRubros/rubro-1', body: { name: 'Vacuno' }, patch: { name: 'Vacuno fresco' } },
      { path: 'providerPurchasePrices/prov-1', body: { polloKg: 2500 }, patch: { polloKg: 2600 } },
      { path: 'employees/emp-inv', body: { name: 'Ana', active: true }, patch: { name: 'Ana María' } },
      { path: 'attendance/att-1', body: { employeeId: 'emp-inv', status: 'present' }, patch: { status: 'absent' } },
      { path: 'employeeVales/vale-inv', body: { shiftId: 'inv-shift', amount: 100 }, patch: { amount: 120 } },
      { path: 'salaryPayments/pay-inv', body: { shiftId: 'inv-shift', amount: 5000 }, patch: { amount: 4800 } },
      { path: 'orders/ord-1', body: { storeId: 'local-1', status: 'pending' }, patch: { status: 'ready' } },
      { path: 'customers/cus-1', body: { name: 'Cliente' }, patch: { name: 'Cliente fiel' } },
      { path: 'customerDebtEvents/cde-1', body: { customerId: 'cus-1', amount: 500 }, patch: { amount: 0 } },
      { path: 'customerDebtCheckpoints/cus-1__local-1', body: { saldoAcumulado: 0 }, patch: { saldoAcumulado: 500 } },
      { path: 'debtCheckpointTails/cus-1__local-1', body: { kind: 'customer', storeId: 'local-1' }, patch: { storeId: 'local-1' } },
      { path: 'ops/debtCheckpointJob', body: { running: false }, patch: { running: true } },
      { path: 'specialCustomers/sc-1', body: { name: 'Hotel' }, patch: { name: 'Hotel Centro' } },
      { path: 'specialCustomerPrices/scp-1', body: { productId: 'p1', price: 1000 }, patch: { price: 1100 } },
    ]

    for (const route of routes) {
      for (const uid of ['cashier-a', 'admin-a'] as const) {
        const database = db(uid)
        const ref = doc(database, `licenses/${TENANT}/${route.path}`)
        try {
          await assertSucceeds(setDoc(ref, route.body))
          await assertSucceeds(getDoc(ref))
          await assertSucceeds(updateDoc(ref, route.patch))
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          throw new Error(`${uid} no pudo operar ${route.path}: ${message}`)
        }
      }
    }
  }, 60_000)

  it('la cajera y el admin crean actividad, y solo el admin la lee', async () => {
    const cashier = db('cashier-a')
    const admin = db('admin-a')
    const cashierLog = doc(cashier, 'licenses', TENANT, 'activity_log', 'log-cashier')
    const adminLog = doc(admin, 'licenses', TENANT, 'activity_log', 'log-admin')
    await assertSucceeds(setDoc(cashierLog, { role: 'cashier', offline: false, store_id: 'local-1' }))
    await assertSucceeds(setDoc(adminLog, { role: 'admin', offline: true, store_id: 'local-1' }))
    await assertFails(getDoc(cashierLog))
    await assertFails(getDocs(collection(cashier, 'licenses', TENANT, 'activity_log')))
    await assertSucceeds(getDoc(doc(admin, 'licenses', TENANT, 'activity_log', 'log-cashier')))
    await assertSucceeds(getDocs(collection(admin, 'licenses', TENANT, 'activity_log')))
    await assertFails(updateDoc(cashierLog, { offline: true }))
    await assertFails(updateDoc(doc(admin, 'licenses', TENANT, 'activity_log', 'log-cashier'), { offline: true }))
    await assertFails(deleteDoc(cashierLog))
    await assertFails(deleteDoc(doc(admin, 'licenses', TENANT, 'activity_log', 'log-admin')))
    await assertFails(setDoc(doc(db('butcher-a'), 'licenses', TENANT, 'activity_log', 'log-butcher'), { role: 'butcher' }))
    await assertFails(setDoc(doc(db('cashier-off'), 'licenses', TENANT, 'activity_log', 'log-off'), { role: 'cashier' }))
    await assertFails(setDoc(doc(db('sin-ficha'), 'licenses', TENANT, 'activity_log', 'log-ghost'), { role: 'cashier' }))
  })

  it('la cajera y el admin leen la licencia y actualizan su instalación', async () => {
    await env.withSecurityRulesDisabled(async context => {
      const seed = context.firestore()
      await setDoc(doc(seed, 'licenses', TENANT, 'installations', 'cashier-a'), { status: 'active' })
      await setDoc(doc(seed, 'licenses', TENANT, 'installations', 'admin-a'), { status: 'active' })
    })

    for (const uid of ['cashier-a', 'admin-a'] as const) {
      const database = db(uid)
      await assertSucceeds(getDoc(doc(database, 'licenses', TENANT)))
      await assertFails(setDoc(doc(database, 'licenses', TENANT), { name: 'otro' }, { merge: true }))
      const install = doc(database, 'licenses', TENANT, 'installations', uid)
      await assertSucceeds(getDoc(install))
      await assertSucceeds(updateDoc(install, { last_seen: '2026-11-19T12:00:00.000Z' }))
      await assertFails(setDoc(doc(database, 'licenses', TENANT, 'installations', 'otro-equipo'), { status: 'active' }))
    }
  })
})
