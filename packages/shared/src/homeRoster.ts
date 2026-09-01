/**
 * Filtro de lista operativa por local habitual (BLOQUE H).
 *
 * Un empleado es el mismo perfil en todos los locales. Asistencia/vales/sueldo
 * se acumulan por employeeId. El habitual solo decide quién aparece en la lista
 * del local actual, con un opt-in de “visitante”.
 */
export interface HomeRosterPerson {
  id: string
  name: string
  homeStoreId: string | null
  kind?: string
  /** false = ficha dada de baja. Ausente = activa. */
  active?: boolean
}

/** Compara nombres de sesión vs ficha: minúsculas, sin acentos, espacios colapsados. */
export function namesMatch(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b) && nameKey(a) !== ''
}

function nameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

/** Ficha de sueldo de cajera (no carnicero). */
export function isCashierKind(kind: string | undefined): boolean {
  return kind === 'cashier'
}

/**
 * En vales: el admin no ve cajeras (no tiene sueldo propio).
 * Una cajera solo se ve a sí misma (mismo nombre que la sesión).
 */
export function passesValeCashierPrivacy(opts: {
  personKind?: string
  personName: string
  viewerRole: 'admin' | 'cashier'
  viewerName: string
}): boolean {
  if (!isCashierKind(opts.personKind)) return true
  if (opts.viewerRole === 'admin') return false
  if (!opts.viewerName.trim()) return false
  return namesMatch(opts.personName, opts.viewerName)
}

export interface TodayAttendanceMark {
  employeeId: string
  /** Local donde se registró. null = fila anterior a la migración. */
  storeId: string | null
}

function isUnassigned(homeStoreId: string | null | undefined): boolean {
  return homeStoreId == null || homeStoreId === ''
}

/** Visible en vales / lista base: habitual de este local, sin asignar, o visitante. */
export function isOnHomeRoster(opts: {
  personId: string
  homeStoreId: string | null
  currentStoreId: string
  visitorIds: ReadonlySet<string>
}): boolean {
  if (opts.visitorIds.has(opts.personId)) return true
  if (isUnassigned(opts.homeStoreId)) return true
  return opts.homeStoreId === opts.currentStoreId
}

/**
 * Asistencia del local actual.
 * Oculta a quien ya tiene marca hoy en otro local.
 * Muestra a quien ya fue marcado hoy en este local (aunque sea visitante).
 */
export function isVisibleForAttendance(opts: {
  personId: string
  homeStoreId: string | null
  currentStoreId: string
  visitorIds: ReadonlySet<string>
  todayMark: TodayAttendanceMark | undefined
}): boolean {
  const mark = opts.todayMark
  if (mark?.storeId && mark.storeId !== opts.currentStoreId) return false
  if (mark?.storeId === opts.currentStoreId) return true
  return isOnHomeRoster(opts)
}

/** Carniceros de otro habitual que todavía se pueden sumar como visitante. */
export function visitorCandidates(opts: {
  people: HomeRosterPerson[]
  currentStoreId: string
  visitorIds: ReadonlySet<string>
  todayMarks?: TodayAttendanceMark[]
  /** En asistencia: no ofrecer a quien ya marcó hoy en cualquier local. */
  hideIfMarkedToday?: boolean
}): HomeRosterPerson[] {
  const marked = new Set(
    (opts.todayMarks ?? [])
      .filter(m => m.storeId != null || opts.hideIfMarkedToday)
      .map(m => m.employeeId),
  )
  return opts.people.filter(p => {
    if (p.active === false) return false
    if (opts.visitorIds.has(p.id)) return false
    if (isUnassigned(p.homeStoreId)) return false
    if (p.homeStoreId === opts.currentStoreId) return false
    if (opts.hideIfMarkedToday && marked.has(p.id)) return false
    if (opts.todayMarks) {
      const mark = opts.todayMarks.find(m => m.employeeId === p.id)
      if (mark?.storeId && mark.storeId !== opts.currentStoreId) return false
    }
    return true
  })
}

function allViewerNames(viewerName: string, extras?: readonly string[]): string[] {
  return [...new Set(
    [viewerName, ...(extras ?? [])]
      .map(n => n.trim())
      .filter(Boolean),
  )]
}

function matchesViewer(personName: string, viewerName: string, extras?: readonly string[]): boolean {
  return allViewerNames(viewerName, extras).some(n => namesMatch(personName, n))
}

/**
 * Lista de vales: habitual/visitante para carniceros + privacidad de cajeras.
 * La cajera con sesión abierta siempre ve SU ficha, en cualquier local:
 * el habitual no aplica a quien está logueada.
 */
export function isVisibleForVales(opts: {
  personId: string
  personName: string
  personKind?: string
  homeStoreId: string | null
  currentStoreId: string
  visitorIds: ReadonlySet<string>
  viewerRole: 'admin' | 'cashier'
  viewerName: string
  /** Nombres extra de la misma persona (caché SQLite, turno, etc.). */
  viewerNames?: readonly string[]
  /** false = ficha dada de baja. La propia cajera igual se ve. */
  personActive?: boolean
}): boolean {
  if (opts.viewerRole === 'cashier' && matchesViewer(opts.personName, opts.viewerName, opts.viewerNames)) {
    return true
  }
  if (opts.personActive === false) return false
  if (!passesValeCashierPrivacy({
    personKind: opts.personKind,
    personName: opts.personName,
    viewerRole: opts.viewerRole,
    viewerName: allViewerNames(opts.viewerName, opts.viewerNames)[0] ?? opts.viewerName,
  })) return false
  return isOnHomeRoster({
    personId: opts.personId,
    homeStoreId: opts.homeStoreId,
    currentStoreId: opts.currentStoreId,
    visitorIds: opts.visitorIds,
  })
}

export function valeVisitorCandidates(opts: {
  people: HomeRosterPerson[]
  currentStoreId: string
  visitorIds: ReadonlySet<string>
  viewerRole: 'admin' | 'cashier'
  viewerName: string
  viewerNames?: readonly string[]
}): HomeRosterPerson[] {
  return visitorCandidates({
    people: opts.people,
    currentStoreId: opts.currentStoreId,
    visitorIds: opts.visitorIds,
  }).filter(p => {
    if (opts.viewerRole === 'cashier' && matchesViewer(p.name, opts.viewerName, opts.viewerNames)) {
      return false
    }
    const full = opts.people.find(x => x.id === p.id)
    const primary = allViewerNames(opts.viewerName, opts.viewerNames)[0] ?? opts.viewerName
    return passesValeCashierPrivacy({
      personKind: full?.kind,
      personName: p.name,
      viewerRole: opts.viewerRole,
      viewerName: primary,
    })
  })
}
