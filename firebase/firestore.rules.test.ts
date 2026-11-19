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
  setDoc,
  updateDoc,
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
      moneySnapshottedAt: SEAL,
    }))
    await assertFails(updateDoc(shift(cashier, 'sealed'), { soldTotal: 1 }))
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
})
