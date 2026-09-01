export type StaffKind = 'cashier' | 'butcher'

export interface StaffCashierInput {
  uid: string
  displayName: string
  email: string
  active: boolean
}

export interface StaffEmployeeInput {
  id: string
  name: string
  weeklyWage: number
  active: boolean
  kind?: string
  homeStoreId?: string | null
}

export interface StaffMember {
  key: string
  name: string
  weeklyWage: number
  kind: StaffKind
  /** Cuenta de app activa (cajera) o ficha de sueldo activa (carnicero / cajera sin login). */
  active: boolean
  email: string | null
  cashierUid: string | null
  employeeId: string | null
  homeStoreId: string | null
}

function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

function isCashierKind(kind: string | undefined): boolean {
  return kind === 'cashier'
}

/**
 * Une cuentas de login (cajeras) con fichas de sueldo. El match es por nombre
 * (sin distinguir mayúsculas). Un carnicero nunca se mezcla con una cajera.
 */
export function buildStaffRoster(
  cashiers: StaffCashierInput[],
  employees: StaffEmployeeInput[],
): { cashiers: StaffMember[]; butchers: StaffMember[] } {
  const cashierEmps = employees.filter(e => isCashierKind(e.kind))
  const butcherEmps = employees.filter(e => !isCashierKind(e.kind))
  const usedEmpIds = new Set<string>()
  const cashierMembers: StaffMember[] = []

  for (const c of cashiers) {
    const match = cashierEmps.find(
      e => nameKey(e.name) === nameKey(c.displayName) && !usedEmpIds.has(e.id),
    )
    if (match) usedEmpIds.add(match.id)
    cashierMembers.push({
      key: c.uid,
      name: c.displayName,
      weeklyWage: match?.weeklyWage ?? 0,
      kind: 'cashier',
      active: c.active,
      email: c.email || null,
      cashierUid: c.uid,
      employeeId: match?.id ?? null,
      homeStoreId: match?.homeStoreId ?? null,
    })
  }

  for (const e of cashierEmps) {
    if (usedEmpIds.has(e.id)) continue
    cashierMembers.push({
      key: e.id,
      name: e.name,
      weeklyWage: e.weeklyWage,
      kind: 'cashier',
      active: e.active,
      email: null,
      cashierUid: null,
      employeeId: e.id,
      homeStoreId: e.homeStoreId ?? null,
    })
  }

  const butcherMembers: StaffMember[] = butcherEmps.map(e => ({
    key: e.id,
    name: e.name,
    weeklyWage: e.weeklyWage,
    kind: 'butcher' as const,
    active: e.active,
    email: null,
    cashierUid: null,
    employeeId: e.id,
    homeStoreId: e.homeStoreId ?? null,
  }))

  const byName = (a: StaffMember, b: StaffMember) => a.name.localeCompare(b.name, 'es')
  return {
    cashiers: cashierMembers.sort(byName),
    butchers: butcherMembers.sort(byName),
  }
}
