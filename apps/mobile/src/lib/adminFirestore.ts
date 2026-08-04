/**
 * Capa de datos admin: tipos Firestore + helpers CRUD para todas las
 * colecciones del panel de administración móvil.
 *
 * Convención de lectura: getDocs sobre la colección completa y filtro en
 * memoria, siguiendo el patrón de adminHistory.ts. No hay índices compuestos
 * requeridos y simplifica el código.
 */
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
  setDoc,
} from 'firebase/firestore'
import { firebaseApp, LICENSE_KEY } from '../firebase'

const firestore = getFirestore(firebaseApp)
const col = (name: string) =>
  collection(firestore, 'licenses', LICENSE_KEY, name)
const docRef = (colName: string, id: string) =>
  doc(firestore, 'licenses', LICENSE_KEY, colName, id)

// ---------------------------------------------------------------------------
// Utilidades de formato (exportadas para UI)
// ---------------------------------------------------------------------------

export function formatMoney(n: number): string {
  return `$${n.toLocaleString('es-AR')}`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso ?? '—'
  }
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type OrderStatus = 'pending' | 'ready' | 'delivered' | 'cancelled'
export type OrderPriority = 'normal' | 'high'

export interface Order {
  id: string
  storeId: string
  customerName: string
  phone: string | null
  items: string
  pickupDate: string
  timeSlot: string | null
  pickupTime: string | null
  priority: OrderPriority
  status: OrderStatus
  depositAmount: number
  depositPayments: number
  notes: string | null
  deleted: boolean
  createdAt: string
  updatedAt: string
}

export interface Customer {
  id: string
  name: string
  phone: string | null
  dni: string | null
  storeId: string
  active: boolean
}

export type DebtEventType = 'debt' | 'partial_payment' | 'paid' | 'cancelled'

export interface CustomerDebtEvent {
  id: string
  customerId: string
  storeId: string
  eventType: DebtEventType
  amount: number
  notes: string | null
  dueDate: string | null
  createdAt: string
  createdBy: string
}

export interface Provider {
  id: string
  name: string
  archivedAt: string | null
  deleted: boolean
}

export interface ProviderDebtEvent {
  id: string
  providerId: string
  storeId: string
  type: 'debt' | 'payment'
  amount: number
  description: string | null
  date: string
  deleted: boolean
}

export interface SpecialCustomer {
  id: string
  name: string
  notes: string | null
  storeId: string | null
  active: boolean
}

export interface SpecialCustomerPrice {
  id: string
  specialCustomerId: string
  productId: string
  productName: string
  specialPrice: number
  storeId: string
}

export interface Employee {
  id: string
  name: string
  salary: number
  storeId: string
  archivedAt: string | null
  deleted: boolean
}

export interface EmployeeVale {
  id: string
  employeeId: string
  storeId: string | null
  amount: number
  description: string | null
  paidAt: string
  deleted: boolean
}

export interface AdminUser {
  uid: string
  displayName: string
  email: string
  role: 'cashier' | 'admin'
  authorizedStores: string[]
  active: boolean
}

export interface StoreDoc {
  id: string
  name: string
  address: string | null
  archivedAt: string | null
  createdAt: string
}

export interface Expense {
  id: string
  storeId: string
  shiftId: string
  category: string
  description: string | null
  amount: number
  providerId: string | null
  providerName: string | null
  paymentMethod: string
  createdAt: string
  deleted: boolean
}

// ---------------------------------------------------------------------------
// Helpers de saldo (puros, testeables)
// ---------------------------------------------------------------------------

/** Saldo activo de un cliente: positivo = debe, negativo = a favor. */
export function calcCustomerBalance(events: CustomerDebtEvent[]): number {
  return events.reduce((bal, e) => {
    if (e.eventType === 'debt') return bal + e.amount
    return bal - e.amount
  }, 0)
}

/** Saldo activo hacia un proveedor: positivo = le debemos. */
export function calcProviderBalance(events: ProviderDebtEvent[]): number {
  return events.reduce((bal, e) => {
    if (e.type === 'debt') return bal + e.amount
    return bal - e.amount
  }, 0)
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function fetchOrders(storeId?: string): Promise<Order[]> {
  const snap = await getDocs(col('orders'))
  const orders: Order[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<Order>
    if (data.deleted === true) continue
    if (storeId && data.storeId !== storeId) continue
    orders.push({
      id: data.id ?? d.id,
      storeId: data.storeId ?? '',
      customerName: data.customerName ?? '',
      phone: data.phone ?? null,
      items: data.items ?? '',
      pickupDate: data.pickupDate ?? '',
      timeSlot: data.timeSlot ?? null,
      pickupTime: data.pickupTime ?? null,
      priority: data.priority ?? 'normal',
      status: data.status ?? 'pending',
      depositAmount: data.depositAmount ?? 0,
      depositPayments: data.depositPayments ?? 0,
      notes: data.notes ?? null,
      deleted: false,
      createdAt: data.createdAt ?? '',
      updatedAt: data.updatedAt ?? '',
    })
  }
  orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return orders
}

export async function createOrder(data: Omit<Order, 'id'>): Promise<void> {
  const id = crypto.randomUUID()
  await setDoc(docRef('orders', id), { ...data, id })
}

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<void> {
  await updateDoc(docRef('orders', id), {
    status,
    updatedAt: new Date().toISOString(),
  })
}

export async function softDeleteOrder(id: string): Promise<void> {
  await updateDoc(docRef('orders', id), {
    deleted: true,
    updatedAt: new Date().toISOString(),
  })
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function fetchCustomers(storeId?: string): Promise<Customer[]> {
  const snap = await getDocs(col('customers'))
  const list: Customer[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<Customer>
    if (storeId && data.storeId !== storeId) continue
    list.push({
      id: data.id ?? d.id,
      name: data.name ?? '',
      phone: data.phone ?? null,
      dni: data.dni ?? null,
      storeId: data.storeId ?? '',
      active: data.active !== false,
    })
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return list
}

export async function createCustomer(data: Omit<Customer, 'id'>): Promise<string> {
  const id = crypto.randomUUID()
  await setDoc(docRef('customers', id), { ...data, id })
  return id
}

// ---------------------------------------------------------------------------
// CustomerDebtEvents
// ---------------------------------------------------------------------------

export async function fetchCustomerDebtEvents(
  customerId: string,
): Promise<CustomerDebtEvent[]> {
  const snap = await getDocs(col('customerDebtEvents'))
  const list: CustomerDebtEvent[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<CustomerDebtEvent>
    if (data.customerId !== customerId) continue
    list.push({
      id: data.id ?? d.id,
      customerId,
      storeId: data.storeId ?? '',
      eventType: data.eventType ?? 'debt',
      amount: data.amount ?? 0,
      notes: data.notes ?? null,
      dueDate: data.dueDate ?? null,
      createdAt: data.createdAt ?? '',
      createdBy: data.createdBy ?? '',
    })
  }
  list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return list
}

export async function fetchAllCustomerDebtEvents(
  storeId?: string,
): Promise<CustomerDebtEvent[]> {
  const snap = await getDocs(col('customerDebtEvents'))
  const list: CustomerDebtEvent[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<CustomerDebtEvent>
    if (storeId && data.storeId !== storeId) continue
    list.push({
      id: data.id ?? d.id,
      customerId: data.customerId ?? '',
      storeId: data.storeId ?? '',
      eventType: data.eventType ?? 'debt',
      amount: data.amount ?? 0,
      notes: data.notes ?? null,
      dueDate: data.dueDate ?? null,
      createdAt: data.createdAt ?? '',
      createdBy: data.createdBy ?? '',
    })
  }
  return list
}

export async function createCustomerDebtEvent(
  data: Omit<CustomerDebtEvent, 'id'>,
): Promise<void> {
  const id = crypto.randomUUID()
  await setDoc(docRef('customerDebtEvents', id), { ...data, id })
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export async function fetchProviders(): Promise<Provider[]> {
  const snap = await getDocs(col('providers'))
  const list: Provider[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<Provider>
    if (data.deleted === true) continue
    list.push({
      id: data.id ?? d.id,
      name: data.name ?? '',
      archivedAt: data.archivedAt ?? null,
      deleted: false,
    })
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return list
}

export async function fetchProviderDebtEvents(): Promise<ProviderDebtEvent[]> {
  const snap = await getDocs(col('providerDebtEvents'))
  const list: ProviderDebtEvent[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<ProviderDebtEvent>
    if (data.deleted === true) continue
    list.push({
      id: data.id ?? d.id,
      providerId: data.providerId ?? '',
      storeId: data.storeId ?? '',
      type: data.type ?? 'debt',
      amount: data.amount ?? 0,
      description: data.description ?? null,
      date: data.date ?? '',
      deleted: false,
    })
  }
  return list
}

export async function createProvider(name: string): Promise<void> {
  const id = crypto.randomUUID()
  await setDoc(docRef('providers', id), { id, name, archivedAt: null, deleted: false })
}

export async function updateProviderName(id: string, name: string): Promise<void> {
  await updateDoc(docRef('providers', id), { name })
}

export async function archiveProvider(id: string): Promise<void> {
  await updateDoc(docRef('providers', id), { archivedAt: new Date().toISOString() })
}

export async function restoreProvider(id: string): Promise<void> {
  await updateDoc(docRef('providers', id), { archivedAt: null })
}

export async function createProviderDebtEvent(
  data: Omit<ProviderDebtEvent, 'id'>,
): Promise<void> {
  const id = crypto.randomUUID()
  await setDoc(docRef('providerDebtEvents', id), { ...data, id })
}

// ---------------------------------------------------------------------------
// SpecialCustomers
// ---------------------------------------------------------------------------

export async function fetchSpecialCustomers(): Promise<SpecialCustomer[]> {
  const snap = await getDocs(col('specialCustomers'))
  const list: SpecialCustomer[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<SpecialCustomer>
    list.push({
      id: data.id ?? d.id,
      name: data.name ?? '',
      notes: data.notes ?? null,
      storeId: data.storeId ?? null,
      active: data.active !== false,
    })
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return list
}

export async function fetchSpecialCustomerPrices(
  specialCustomerId: string,
): Promise<SpecialCustomerPrice[]> {
  const snap = await getDocs(col('specialCustomerPrices'))
  const list: SpecialCustomerPrice[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<SpecialCustomerPrice> & { deleted?: boolean }
    if (data.deleted === true) continue
    if (data.specialCustomerId !== specialCustomerId) continue
    list.push({
      id: data.id ?? d.id,
      specialCustomerId,
      productId: data.productId ?? '',
      productName: data.productName ?? '',
      specialPrice: data.specialPrice ?? 0,
      storeId: data.storeId ?? '',
    })
  }
  list.sort((a, b) => a.productName.localeCompare(b.productName, 'es'))
  return list
}

export async function createSpecialCustomer(
  data: Omit<SpecialCustomer, 'id'>,
): Promise<string> {
  const id = crypto.randomUUID()
  await setDoc(docRef('specialCustomers', id), { ...data, id })
  return id
}

export async function updateSpecialCustomer(
  id: string,
  data: Partial<Pick<SpecialCustomer, 'name' | 'notes' | 'active'>>,
): Promise<void> {
  await updateDoc(docRef('specialCustomers', id), data)
}

export async function createSpecialCustomerPrice(
  data: Omit<SpecialCustomerPrice, 'id'>,
): Promise<void> {
  const id = crypto.randomUUID()
  await setDoc(docRef('specialCustomerPrices', id), { ...data, id, deleted: false })
}

export async function softDeleteSpecialCustomerPrice(id: string): Promise<void> {
  await updateDoc(docRef('specialCustomerPrices', id), { deleted: true })
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export async function fetchEmployees(storeId?: string): Promise<Employee[]> {
  const snap = await getDocs(col('employees'))
  const list: Employee[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<Employee>
    if (data.deleted === true) continue
    if (storeId && data.storeId !== storeId) continue
    list.push({
      id: data.id ?? d.id,
      name: data.name ?? '',
      salary: data.salary ?? 0,
      storeId: data.storeId ?? '',
      archivedAt: data.archivedAt ?? null,
      deleted: false,
    })
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return list
}

export async function fetchEmployeeValesForEmployee(
  employeeId: string,
): Promise<EmployeeVale[]> {
  const snap = await getDocs(col('employeeVales'))
  const list: EmployeeVale[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<EmployeeVale>
    if (data.deleted === true) continue
    if (data.employeeId !== employeeId) continue
    list.push({
      id: data.id ?? d.id,
      employeeId,
      storeId: data.storeId ?? null,
      amount: data.amount ?? 0,
      description: data.description ?? null,
      paidAt: data.paidAt ?? '',
      deleted: false,
    })
  }
  list.sort((a, b) => b.paidAt.localeCompare(a.paidAt))
  return list
}

export async function createEmployee(
  data: Pick<Employee, 'name' | 'salary' | 'storeId'>,
): Promise<void> {
  const id = crypto.randomUUID()
  await setDoc(docRef('employees', id), {
    id,
    name: data.name,
    salary: data.salary,
    storeId: data.storeId,
    archivedAt: null,
    deleted: false,
  })
}

export async function updateEmployee(
  id: string,
  data: Partial<Pick<Employee, 'name' | 'salary'>>,
): Promise<void> {
  await updateDoc(docRef('employees', id), data)
}

export async function archiveEmployee(id: string): Promise<void> {
  await updateDoc(docRef('employees', id), { archivedAt: new Date().toISOString() })
}

export async function unarchiveEmployee(id: string): Promise<void> {
  await updateDoc(docRef('employees', id), { archivedAt: null })
}

// ---------------------------------------------------------------------------
// Users (Cajeras)
// ---------------------------------------------------------------------------

export async function fetchCashierUsers(): Promise<AdminUser[]> {
  const snap = await getDocs(col('users'))
  const list: AdminUser[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<AdminUser>
    if (data.role !== 'cashier') continue
    list.push({
      uid: data.uid ?? d.id,
      displayName: data.displayName ?? '',
      email: data.email ?? '',
      role: 'cashier',
      authorizedStores: data.authorizedStores ?? [],
      active: data.active !== false,
    })
  }
  list.sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'))
  return list
}

export async function updateUserActive(uid: string, active: boolean): Promise<void> {
  await updateDoc(docRef('users', uid), { active })
}

export async function updateUserAuthorizedStores(
  uid: string,
  stores: string[],
): Promise<void> {
  await updateDoc(docRef('users', uid), { authorizedStores: stores })
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export async function fetchAllStores(): Promise<StoreDoc[]> {
  const snap = await getDocs(col('stores'))
  const list: StoreDoc[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<StoreDoc>
    list.push({
      id: data.id ?? d.id,
      name: data.name ?? '',
      address: data.address ?? null,
      archivedAt: data.archivedAt ?? null,
      createdAt: data.createdAt ?? '',
    })
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return list
}

export async function createStore(name: string, address: string | null): Promise<void> {
  const id = crypto.randomUUID()
  await setDoc(docRef('stores', id), {
    id,
    name,
    address,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  })
}

export async function updateStore(
  id: string,
  data: Partial<Pick<StoreDoc, 'name' | 'address'>>,
): Promise<void> {
  await updateDoc(docRef('stores', id), data)
}

export async function archiveStore(id: string): Promise<void> {
  await updateDoc(docRef('stores', id), { archivedAt: new Date().toISOString() })
}

export async function restoreStore(id: string): Promise<void> {
  await updateDoc(docRef('stores', id), { archivedAt: null })
}

// ---------------------------------------------------------------------------
// Expenses (para historial)
// ---------------------------------------------------------------------------

export async function fetchExpensesForShift(shiftId: string): Promise<Expense[]> {
  const snap = await getDocs(col('expenses'))
  const list: Expense[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<Expense>
    if (data.deleted === true) continue
    if (data.shiftId !== shiftId) continue
    list.push({
      id: data.id ?? d.id,
      storeId: data.storeId ?? '',
      shiftId: data.shiftId ?? '',
      category: data.category ?? '',
      description: data.description ?? null,
      amount: data.amount ?? 0,
      providerId: data.providerId ?? null,
      providerName: data.providerName ?? null,
      paymentMethod: data.paymentMethod ?? 'cash',
      createdAt: data.createdAt ?? '',
      deleted: false,
    })
  }
  list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return list
}
