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
import {
  parseDepositPayments,
  parseOrderPriority,
  parseTimeSlot,
  serializeDepositPayments,
} from './orderMapping'
import {
  asIsoTimestamp,
  calcCustomerBalance as calcCustomerBalanceLedger,
  calcProviderBalance as calcProviderBalanceLedger,
  normalizeDebtEventType,
  providerIdFromName,
  providerNameKey,
} from './adminLedger'
import { formatDisplayDate } from './week'

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
    return formatDisplayDate(iso)
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

export interface Order {
  id: string
  storeId: string
  customerName: string
  phone: string | null
  items: string
  pickupDate: string
  timeSlot: string | null
  pickupTime: string | null
  priority: boolean
  status: OrderStatus
  depositAmount: number
  depositPayments: string | null
  notes: string | null
  deleted: boolean
  createdAt: string
  createdBy: string
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

export type DebtEventType = 'created' | 'debt' | 'reopened' | 'partial_payment' | 'paid' | 'cancelled'

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
  paymentMethod?: 'cash' | 'debit' | 'wallet' | 'credit' | null
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
  createdBy?: string
  createdByName?: string
}

export interface SpecialCustomer {
  id: string
  name: string
  notes: string | null
  storeId: string | null
  active: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface SpecialCustomerPrice {
  id: string
  specialCustomerId: string
  productId: string
  productName: string
  specialPrice: number
  notes: string | null
  updatedAt: string | null
  storeId: string
}

export interface Employee {
  id: string
  name: string
  /** Semanal (desktop: weeklyWage). `salary` se conserva como alias de lectura. */
  salary: number
  weeklyWage: number
  storeId: string | null
  archivedAt: string | null
  deleted: boolean
  kind: 'butcher' | 'cashier'
  /** Local habitual. null = aparece en ambos. Distinto de storeId legado. */
  homeStoreId: string | null
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
  concept: string | null
  notes: string | null
  amount: number
  providerId: string | null
  providerName: string | null
  paymentMethod: string
  createdAt: string
  deleted: boolean
}

// ---------------------------------------------------------------------------
// Helpers de saldo (reexportados para no romper imports de UI)
// ---------------------------------------------------------------------------

/** Saldo activo de un cliente: positivo = debe, negativo = a favor. */
export function calcCustomerBalance(events: CustomerDebtEvent[]): number {
  return calcCustomerBalanceLedger(events)
}

/** Saldo activo hacia un proveedor: positivo = le debemos. */
export function calcProviderBalance(events: ProviderDebtEvent[]): number {
  return calcProviderBalanceLedger(events)
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
      timeSlot: parseTimeSlot(data.timeSlot),
      pickupTime: data.pickupTime ?? null,
      priority: parseOrderPriority(data.priority),
      status: data.status ?? 'pending',
      depositAmount: data.depositAmount ?? 0,
      depositPayments: serializeDepositPayments(parseDepositPayments(data.depositPayments) ?? []),
      notes: data.notes ?? null,
      deleted: false,
      createdAt: data.createdAt ?? '',
      createdBy: data.createdBy ?? '',
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

export async function createCustomer(
  data: Omit<Customer, 'id'> & { createdBy: string },
): Promise<string> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await setDoc(docRef('customers', id), {
    ...data,
    id,
    createdAt: now,
    createdBy: data.createdBy,
    deleted: false,
  })
  return id
}

// ---------------------------------------------------------------------------
// CustomerDebtEvents
// ---------------------------------------------------------------------------

function parseDebtPaymentMethod(
  raw: unknown,
): 'cash' | 'debit' | 'wallet' | 'credit' | null {
  if (raw === 'cash' || raw === 'debit' || raw === 'wallet' || raw === 'credit') return raw
  return null
}

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
      eventType: normalizeDebtEventType(data.eventType),
      amount: data.amount ?? 0,
      notes: data.notes ?? null,
      dueDate: data.dueDate ?? null,
      createdAt: data.createdAt ?? '',
      createdBy: data.createdBy ?? '',
      paymentMethod: parseDebtPaymentMethod(data.paymentMethod),
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
      eventType: normalizeDebtEventType(data.eventType),
      amount: data.amount ?? 0,
      notes: data.notes ?? null,
      dueDate: data.dueDate ?? null,
      createdAt: data.createdAt ?? '',
      createdBy: data.createdBy ?? '',
      paymentMethod: parseDebtPaymentMethod(data.paymentMethod),
    })
  }
  return list
}

export async function createCustomerDebtEvent(
  data: Omit<CustomerDebtEvent, 'id'>,
): Promise<void> {
  const id = crypto.randomUUID()
  const eventType = normalizeDebtEventType(data.eventType)
  const absAmount = Math.abs(data.amount)
  const amount = eventType === 'created' || eventType === 'reopened'
    ? absAmount
    : -absAmount
  await setDoc(docRef('customerDebtEvents', id), {
    ...data,
    id,
    eventType,
    amount,
    deleted: false,
  })
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
      archivedAt: asIsoTimestamp(data.archivedAt),
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
    const data = d.data() as Partial<ProviderDebtEvent> & {
      createdAt?: string
      deleted?: boolean
    }
    if (data.deleted === true) continue
    list.push({
      id: data.id ?? d.id,
      providerId: data.providerId ?? '',
      storeId: data.storeId ?? '',
      type: data.type ?? 'debt',
      amount: data.amount ?? 0,
      description: data.description ?? (data as { notes?: string | null }).notes ?? null,
      date: data.createdAt ?? data.date ?? '',
      deleted: false,
      createdBy: (data as { createdBy?: string }).createdBy,
      createdByName: (data as { createdByName?: string }).createdByName,
    })
  }
  return list
}

export async function createProvider(name: string, createdBy: string): Promise<void> {
  const trimmed = name.trim()
  const id = providerIdFromName(trimmed)
  const now = new Date().toISOString()
  await setDoc(docRef('providers', id), {
    id,
    name: trimmed,
    nameKey: providerNameKey(trimmed),
    archivedAt: null,
    deleted: false,
    createdAt: now,
    createdBy,
  }, { merge: true })
}

export async function updateProviderName(id: string, name: string): Promise<void> {
  await updateDoc(docRef('providers', id), { name })
}

export async function archiveProvider(id: string): Promise<void> {
  await updateDoc(docRef('providers', id), { archivedAt: new Date().toISOString() })
}

export async function restoreProvider(id: string): Promise<void> {
  await updateDoc(docRef('providers', id), { archivedAt: null })
  const snap = await getDocs(col('providerDebtEvents'))
  for (const d of snap.docs) {
    const data = d.data() as { providerId?: string; deleted?: boolean }
    if (data.providerId !== id) continue
    if (data.deleted !== true) continue
    await updateDoc(d.ref, { deleted: false, deletedAt: null })
  }
}

/**
 * @deprecated No usar al eliminar. El alta/baja de proveedores es soft-delete
 * (archiveProvider) y debe conservar el historial. Se deja por si hace falta
 * una limpieza excepcional a mano.
 */
export async function purgeProviderLedger(providerId: string): Promise<void> {
  const snap = await getDocs(col('providerDebtEvents'))
  const now = new Date().toISOString()
  for (const d of snap.docs) {
    const data = d.data() as { providerId?: string; deleted?: boolean }
    if (data.providerId !== providerId) continue
    if (data.deleted === true) continue
    await updateDoc(d.ref, { deleted: true, deletedAt: now })
  }
  await archiveProvider(providerId)
}

export async function createProviderDebtEvent(
  data: Omit<ProviderDebtEvent, 'id'> & { providerName: string; createdBy: string; createdByName?: string },
): Promise<void> {
  const id = crypto.randomUUID()
  const now = data.date || new Date().toISOString()
  await setDoc(docRef('providerDebtEvents', id), {
    id,
    providerId: data.providerId,
    provider: data.providerName,
    storeId: data.storeId,
    type: data.type,
    amount: Math.abs(data.amount),
    description: data.description,
    notes: data.description,
    date: now,
    createdAt: now,
    createdBy: data.createdBy,
    createdByName: data.createdByName ?? null,
    expenseId: null,
    shiftId: null,
    deleted: false,
  })
}

// ---------------------------------------------------------------------------
// SpecialCustomers
// ---------------------------------------------------------------------------

function mapSpecialCustomerPrice(
  id: string,
  raw: Record<string, unknown>,
): SpecialCustomerPrice | null {
  const data = raw as Partial<SpecialCustomerPrice> & {
    deleted?: boolean
    price?: number
  }
  if (data.deleted === true) return null
  return {
    id: data.id ?? id,
    specialCustomerId: data.specialCustomerId ?? '',
    productId: data.productId ?? '',
    productName: data.productName ?? '',
    specialPrice: data.price ?? data.specialPrice ?? 0,
    notes: data.notes ?? null,
    updatedAt: data.updatedAt ?? null,
    storeId: data.storeId ?? '',
  }
}

export async function fetchSpecialCustomers(): Promise<SpecialCustomer[]> {
  const snap = await getDocs(col('specialCustomers'))
  const list: SpecialCustomer[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<SpecialCustomer> & { deleted?: boolean }
    if (data.deleted === true) continue
    if (!data.name) continue
    list.push({
      id: data.id ?? d.id,
      name: data.name ?? '',
      notes: data.notes ?? null,
      storeId: data.storeId ?? null,
      active: data.active !== false,
      createdAt: data.createdAt ?? null,
      updatedAt: data.updatedAt ?? null,
    })
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return list
}

export async function fetchAllSpecialCustomerPrices(): Promise<Record<string, SpecialCustomerPrice[]>> {
  const snap = await getDocs(col('specialCustomerPrices'))
  const byCustomer: Record<string, SpecialCustomerPrice[]> = {}
  for (const d of snap.docs) {
    const row = mapSpecialCustomerPrice(d.id, d.data() as Record<string, unknown>)
    if (!row) continue
    const list = byCustomer[row.specialCustomerId] ?? []
    list.push(row)
    byCustomer[row.specialCustomerId] = list
  }
  for (const list of Object.values(byCustomer)) {
    list.sort((a, b) => a.productName.localeCompare(b.productName, 'es'))
  }
  return byCustomer
}

export async function fetchSpecialCustomerPrices(
  specialCustomerId: string,
): Promise<SpecialCustomerPrice[]> {
  const all = await fetchAllSpecialCustomerPrices()
  return all[specialCustomerId] ?? []
}

export async function createSpecialCustomer(
  data: { name: string; notes?: string | null; createdBy: string },
): Promise<string> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await setDoc(docRef('specialCustomers', id), {
    id,
    name: data.name,
    notes: data.notes ?? null,
    storeId: null,
    active: true,
    createdAt: now,
    createdBy: data.createdBy,
    updatedAt: null,
    updatedBy: null,
    deleted: false,
  })
  return id
}

export async function updateSpecialCustomer(
  id: string,
  data: Partial<Pick<SpecialCustomer, 'name' | 'notes'>> & { updatedBy?: string },
): Promise<void> {
  const now = new Date().toISOString()
  await updateDoc(docRef('specialCustomers', id), {
    ...data,
    updatedAt: now,
  })
}

export async function upsertSpecialCustomerPrice(data: {
  id?: string
  specialCustomerId: string
  productId: string
  productName: string
  specialPrice: number
  notes?: string | null
  updatedBy: string
}): Promise<void> {
  const id = data.id ?? crypto.randomUUID()
  const now = new Date().toISOString()
  await setDoc(docRef('specialCustomerPrices', id), {
    id,
    specialCustomerId: data.specialCustomerId,
    productId: data.productId,
    productName: data.productName,
    price: data.specialPrice,
    specialPrice: data.specialPrice,
    storeId: null,
    notes: data.notes ?? null,
    updatedAt: now,
    updatedBy: data.updatedBy,
    deleted: false,
  }, { merge: true })
}

export async function softDeleteSpecialCustomerPrice(id: string): Promise<void> {
  await updateDoc(docRef('specialCustomerPrices', id), {
    deleted: true,
    deletedAt: new Date().toISOString(),
  })
}

export async function softDeleteSpecialCustomer(id: string): Promise<void> {
  const now = new Date().toISOString()
  const prices = await fetchSpecialCustomerPrices(id)
  await updateDoc(docRef('specialCustomers', id), { deleted: true, deletedAt: now })
  for (const p of prices) {
    await softDeleteSpecialCustomerPrice(p.id)
  }
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export async function fetchEmployees(): Promise<Employee[]> {
  const snap = await getDocs(col('employees'))
  const list: Employee[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<Employee> & {
      weeklyWage?: number
      active?: boolean
      deleted?: boolean
      archivedAt?: string | null
      createdAt?: string
    }
    if (data.deleted === true) continue
    const weeklyWage = data.weeklyWage ?? data.salary ?? 0
    const archivedAt = asIsoTimestamp(data.archivedAt)
    const inactive = data.active === false || Boolean(archivedAt)
    list.push({
      id: data.id ?? d.id,
      name: data.name ?? '',
      salary: weeklyWage,
      weeklyWage,
      storeId: data.storeId ?? null,
      archivedAt: inactive ? (archivedAt ?? data.createdAt ?? 'inactive') : null,
      deleted: false,
      kind: data.kind === 'cashier' ? 'cashier' : 'butcher',
      homeStoreId: typeof data.homeStoreId === 'string' && data.homeStoreId.trim()
        ? data.homeStoreId.trim()
        : null,
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
  data: {
    name: string
    weeklyWage: number
    createdBy: string
    kind?: 'butcher' | 'cashier'
    homeStoreId?: string | null
  },
): Promise<void> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const kind = data.kind === 'cashier' ? 'cashier' : 'butcher'
  const homeStoreId = data.homeStoreId && data.homeStoreId.trim() ? data.homeStoreId.trim() : null
  await setDoc(docRef('employees', id), {
    id,
    name: data.name,
    weeklyWage: data.weeklyWage,
    salary: data.weeklyWage,
    kind,
    homeStoreId,
    active: true,
    archivedAt: null,
    deleted: false,
    createdAt: now,
    createdBy: data.createdBy,
  })
}

export async function updateEmployee(
  id: string,
  data: Partial<{ name: string; weeklyWage: number; homeStoreId: string | null }>,
): Promise<void> {
  const payload: Record<string, string | number | null> = {}
  if (data.name !== undefined) payload.name = data.name
  if (data.weeklyWage !== undefined) {
    payload.weeklyWage = data.weeklyWage
    payload.salary = data.weeklyWage
  }
  if (data.homeStoreId !== undefined) {
    payload.homeStoreId = data.homeStoreId && data.homeStoreId.trim() ? data.homeStoreId.trim() : null
  }
  await updateDoc(docRef('employees', id), payload)
}

export async function archiveEmployee(id: string): Promise<void> {
  await updateDoc(docRef('employees', id), {
    archivedAt: new Date().toISOString(),
    active: false,
  })
}

export async function unarchiveEmployee(id: string): Promise<void> {
  await updateDoc(docRef('employees', id), { archivedAt: null, active: true })
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
    if ((data as { deleted?: boolean }).deleted === true) continue
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

export async function updateUserDisplayName(uid: string, displayName: string): Promise<void> {
  await updateDoc(docRef('users', uid), { displayName })
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
    const data = d.data() as Partial<StoreDoc> & { archivedAt?: unknown }
    list.push({
      id: data.id ?? d.id,
      name: data.name ?? '',
      address: data.address ?? null,
      archivedAt: asIsoTimestamp(data.archivedAt),
      createdAt: asIsoTimestamp(data.createdAt) ?? '',
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
    const data = d.data() as Partial<Expense> & {
      concept?: string | null
      notes?: string | null
      deleted?: boolean
    }
    if (data.deleted === true) continue
    if (data.shiftId !== shiftId) continue
    const concept = data.concept ?? data.description ?? null
    list.push({
      id: data.id ?? d.id,
      storeId: data.storeId ?? '',
      shiftId: data.shiftId ?? '',
      category: data.category ?? '',
      description: concept,
      concept,
      notes: data.notes ?? null,
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
