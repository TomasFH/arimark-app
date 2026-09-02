/**
 * IPC de empleados / carniceros (ABM admin).
 *
 * Canales:
 *   LIST_EMPLOYEES    — activos (o todos si includeArchived)
 *   CREATE_EMPLOYEE   — admin; nombre único
 *   UPDATE_EMPLOYEE   — admin; nombre y/o sueldo
 *   ARCHIVE_EMPLOYEE  — admin; soft-delete (active=false)
 *   UNARCHIVE_EMPLOYEE — admin; reactive (active=true)
 *   GRANT_BUTCHER_ACCESS  — admin; crea cuenta Firebase para carnicero (email obligatorio)
 *   REVOKE_BUTCHER_ACCESS — admin; desactiva cuenta Firebase del carnicero
 */
import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq } from 'drizzle-orm'
import { IPC } from './channels'
import { namesMatch } from '@carniceria/shared'
import { getDb } from '../db/client'
import { employees, stores, users } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { pushUnsyncedEmployees } from '../licensing/employeeSync'
import { createTenantAuthUser } from '../licensing/tenantAuth'
import { getFirebaseApp, isFirebaseAvailable } from '../licensing/firebase'
import type { IpcResult, EmployeeRow } from '../../src/types/hw-api'

const listSchema = z.object({
  includeArchived: z.boolean().optional(),
}).optional()

const createSchema = z.object({
  name: z.string().min(1).max(100).transform(s => s.trim()),
  weeklyWage: z.number().int().min(0).max(999_999_999),
  kind: z.enum(['butcher', 'cashier']).default('butcher'),
  homeStoreId: z.string().min(1).max(80).nullable().optional(),
})

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).transform(s => s.trim()).optional(),
  weeklyWage: z.number().int().min(0).max(999_999_999).optional(),
  homeStoreId: z.string().min(1).max(80).nullable().optional(),
})

const archiveSchema = z.object({
  id: z.string().min(1),
})

function toRow(row: typeof employees.$inferSelect): EmployeeRow {
  return {
    id: row.id,
    name: row.name,
    weeklyWage: row.weeklyWage,
    active: row.active,
    createdAt: row.createdAt,
    kind: row.kind === 'cashier' ? 'cashier' : 'butcher',
    homeStoreId: row.homeStoreId ?? null,
    firebaseUid: row.firebaseUid ?? null,
  }
}

function resolveHomeStoreId(
  db: ReturnType<typeof getDb>,
  homeStoreId: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (homeStoreId == null) return { ok: true, value: null }
  const store = db.select().from(stores).where(eq(stores.id, homeStoreId)).get()
  if (!store || store.archivedAt) {
    return { ok: false, error: 'El local habitual no existe o está eliminado.' }
  }
  return { ok: true, value: homeStoreId }
}

/** Busca otro empleado activo/inactivo con el mismo nombre (case-insensitive). */
function findNameConflict(
  db: ReturnType<typeof getDb>,
  name: string,
  excludeId?: string,
): boolean {
  const normalized = name.toLowerCase()
  const rows = db.select({ id: employees.id, name: employees.name }).from(employees).all()
  return rows.some(r => {
    if (excludeId && r.id === excludeId) return false
    return r.name.toLowerCase() === normalized
  })
}

function scheduleEmployeePush(context: string): void {
  try {
    const config = getBusinessConfig()
    pushUnsyncedEmployees(config.tenant_id).catch(err =>
      log.warn(`[${context}] pushUnsyncedEmployees falló (no bloqueante)`, err),
    )
  } catch (err) {
    log.warn(`[${context}] getBusinessConfig/push falló (no bloqueante)`, err)
  }
}

function requireAdmin(): IpcResult<never> | null {
  const session = getActiveSession()
  if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
  if (session.role !== 'admin') {
    return { ok: false, error: 'Solo los administradores pueden gestionar empleados.', code: 'FORBIDDEN' }
  }
  return null
}

/**
 * Login de cajera activo + ficha de sueldo dada de baja (desfasaje de sync).
 * Personal muestra la cuenta de Firebase; vales miraba employees.active.
 */
function restoreOwnCashierFicha(
  db: ReturnType<typeof getDb>,
  session: NonNullable<ReturnType<typeof getActiveSession>>,
): void {
  if (session.role !== 'cashier') return
  const userRow = db.select({ name: users.name }).from(users).where(eq(users.id, session.userId)).get()
  const aliases = [session.displayName, userRow?.name]
    .map(n => n?.trim() ?? '')
    .filter(Boolean)
  if (aliases.length === 0) return

  const own = db.select().from(employees).all().find(row =>
    row.kind === 'cashier' && aliases.some(a => namesMatch(row.name, a)),
  )
  if (!own || own.active) return

  db.update(employees).set({ active: true, syncedAt: null }).where(eq(employees.id, own.id)).run()
  log.info('[ipc:list-employees] Restauré ficha de cajera en sesión', { id: own.id, name: own.name })
  scheduleEmployeePush('ipc:list-employees:heal-own-ficha')
}

export function registerEmployeesHandlers(): void {
  // --------------------------------------------------------------------------
  // LIST_EMPLOYEES
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.LIST_EMPLOYEES, (_event, payload: unknown): IpcResult<EmployeeRow[]> => {
    const parsed = listSchema.safeParse(payload ?? {})
    if (!parsed.success) {
      log.error('[ipc:list-employees] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      restoreOwnCashierFicha(db, session)
      const includeArchived = parsed.data?.includeArchived === true
      const rows = includeArchived
        ? db.select().from(employees).all()
        : db.select().from(employees).where(eq(employees.active, true)).all()

      rows.sort((a, b) => a.name.localeCompare(b.name, 'es'))
      return { ok: true, data: rows.map(toRow) }
    } catch (err) {
      log.error('[ipc:list-employees] Error inesperado', err)
      return { ok: false, error: 'Error al listar empleados.' }
    }
  })

  // --------------------------------------------------------------------------
  // CREATE_EMPLOYEE — solo admin
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.CREATE_EMPLOYEE, (_event, payload: unknown): IpcResult<EmployeeRow> => {
    const parsed = createSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:create-employee] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const denied = requireAdmin()
    if (denied) return denied

    const { name, weeklyWage, kind } = parsed.data

    try {
      const db = getDb()
      const homeResolved = resolveHomeStoreId(db, parsed.data.homeStoreId ?? null)
      if (!homeResolved.ok) return { ok: false, error: homeResolved.error, code: 'INVALID_PAYLOAD' }

      if (findNameConflict(db, name)) {
        const archived = db.select().from(employees).all().find(
          r => r.name.toLowerCase() === name.toLowerCase() && !r.active,
        )
        if (archived) {
          return {
            ok: false,
            error: `Ya existe un empleado eliminado llamado "${name}". Restauralo desde “Ver eliminados”.`,
            code: 'CONFLICT',
          }
        }
        return { ok: false, error: `Ya existe un empleado con el nombre "${name}".`, code: 'CONFLICT' }
      }

      const id = uuidv4()
      const createdAt = new Date().toISOString()
      db.insert(employees).values({
        id,
        name,
        weeklyWage,
        kind,
        homeStoreId: homeResolved.value,
        active: true,
        createdAt,
        syncedAt: null,
      }).run()

      log.info('[ipc:create-employee] Empleado creado', { id, name })
      scheduleEmployeePush('ipc:create-employee')
      const created = db.select().from(employees).where(eq(employees.id, id)).all()[0]
      if (!created) return { ok: false, error: 'Error al crear el empleado.' }
      return { ok: true, data: toRow(created) }
    } catch (err) {
      log.error('[ipc:create-employee] Error inesperado', err)
      return { ok: false, error: 'Error al crear el empleado.' }
    }
  })

  // --------------------------------------------------------------------------
  // UPDATE_EMPLOYEE — solo admin
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.UPDATE_EMPLOYEE, (_event, payload: unknown): IpcResult<EmployeeRow> => {
    const parsed = updateSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:update-employee] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const denied = requireAdmin()
    if (denied) return denied

    const { id, name, weeklyWage, homeStoreId } = parsed.data
    if (name === undefined && weeklyWage === undefined && homeStoreId === undefined) {
      return { ok: false, error: 'No hay campos para actualizar.', code: 'INVALID_PAYLOAD' }
    }

    try {
      const db = getDb()
      const existing = db.select().from(employees).where(eq(employees.id, id)).all()[0]
      if (!existing) return { ok: false, error: 'Empleado no encontrado.', code: 'NOT_FOUND' }

      if (name !== undefined && findNameConflict(db, name, id)) {
        return { ok: false, error: `Ya existe un empleado con el nombre "${name}".`, code: 'CONFLICT' }
      }

      const updatedName = name ?? existing.name
      const updatedWage = weeklyWage ?? existing.weeklyWage
      let updatedHome = existing.homeStoreId ?? null
      if (homeStoreId !== undefined) {
        const homeResolved = resolveHomeStoreId(db, homeStoreId)
        if (!homeResolved.ok) return { ok: false, error: homeResolved.error, code: 'INVALID_PAYLOAD' }
        updatedHome = homeResolved.value
      }

      db.update(employees)
        .set({
          name: updatedName,
          weeklyWage: updatedWage,
          homeStoreId: updatedHome,
          syncedAt: null,
        })
        .where(eq(employees.id, id))
        .run()

      log.info('[ipc:update-employee] Empleado actualizado', { id, name: updatedName })
      scheduleEmployeePush('ipc:update-employee')
      const updated = db.select().from(employees).where(eq(employees.id, id)).all()[0]
      if (!updated) return { ok: false, error: 'Error al actualizar el empleado.' }
      return { ok: true, data: toRow(updated) }
    } catch (err) {
      log.error('[ipc:update-employee] Error inesperado', err)
      return { ok: false, error: 'Error al actualizar el empleado.' }
    }
  })

  // --------------------------------------------------------------------------
  // ARCHIVE_EMPLOYEE — solo admin (soft-delete)
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.ARCHIVE_EMPLOYEE, (_event, payload: unknown): IpcResult<EmployeeRow> => {
    const parsed = archiveSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:archive-employee] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const denied = requireAdmin()
    if (denied) return denied

    const { id } = parsed.data

    try {
      const db = getDb()
      const existing = db.select().from(employees).where(eq(employees.id, id)).all()[0]
      if (!existing) return { ok: false, error: 'Empleado no encontrado.', code: 'NOT_FOUND' }
      if (!existing.active) {
        return { ok: false, error: 'El empleado ya está eliminado.', code: 'CONFLICT' }
      }

      db.update(employees).set({ active: false, syncedAt: null }).where(eq(employees.id, id)).run()

      log.info('[ipc:archive-employee] Empleado archivado', { id, name: existing.name })
      scheduleEmployeePush('ipc:archive-employee')
      return { ok: true, data: toRow({ ...existing, active: false }) }
    } catch (err) {
      log.error('[ipc:archive-employee] Error inesperado', err)
      return { ok: false, error: 'Error al eliminar el empleado.' }
    }
  })

  // --------------------------------------------------------------------------
  // UNARCHIVE_EMPLOYEE — solo admin
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.UNARCHIVE_EMPLOYEE, (_event, payload: unknown): IpcResult<EmployeeRow> => {
    const parsed = archiveSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:unarchive-employee] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const denied = requireAdmin()
    if (denied) return denied

    const { id } = parsed.data

    try {
      const db = getDb()
      const existing = db.select().from(employees).where(eq(employees.id, id)).all()[0]
      if (!existing) return { ok: false, error: 'Empleado no encontrado.', code: 'NOT_FOUND' }
      if (existing.active) {
        return { ok: false, error: 'El empleado ya está activo.', code: 'CONFLICT' }
      }

      db.update(employees).set({ active: true, syncedAt: null }).where(eq(employees.id, id)).run()

      log.info('[ipc:unarchive-employee] Empleado restaurado', { id, name: existing.name })
      scheduleEmployeePush('ipc:unarchive-employee')
      return { ok: true, data: toRow({ ...existing, active: true }) }
    } catch (err) {
      log.error('[ipc:unarchive-employee] Error inesperado', err)
      return { ok: false, error: 'Error al restaurar el empleado.' }
    }
  })

  // --------------------------------------------------------------------------
  // GRANT_BUTCHER_ACCESS — solo admin
  // Crea Auth user + perfil Firestore para el carnicero, guarda UID en SQLite.
  // El email es obligatorio: sin él no hay cuenta de acceso al celu.
  // --------------------------------------------------------------------------
  const grantButcherSchema = z.object({
    employeeId: z.string().min(1),
    email: z.string().email('El email es obligatorio y debe ser válido.'),
  })

  ipcMain.handle(IPC.GRANT_BUTCHER_ACCESS, async (_event, payload: unknown): Promise<IpcResult<{ uid: string }>> => {
    const parsed = grantButcherSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('[ipc:grant-butcher-access] Payload inválido', parsed.error.flatten())
      return { ok: false, error: parsed.error.errors[0]?.message ?? 'Datos inválidos.', code: 'INVALID_PAYLOAD' }
    }

    const denied = requireAdmin()
    if (denied) return denied

    const { employeeId, email } = parsed.data

    const db = getDb()
    const existing = db.select().from(employees).where(eq(employees.id, employeeId)).get()
    if (!existing) return { ok: false, error: 'Empleado no encontrado.', code: 'NOT_FOUND' }
    if (existing.kind !== 'butcher') {
      return { ok: false, error: 'Solo los carniceros pueden recibir acceso celular.', code: 'INVALID_PAYLOAD' }
    }
    if (existing.firebaseUid) {
      return { ok: false, error: 'Este carnicero ya tiene acceso al celular.', code: 'ALREADY_EXISTS' }
    }

    if (!isFirebaseAvailable()) {
      return { ok: false, error: 'Firebase no disponible. Verificar conexión.', code: 'UNAVAILABLE' }
    }

    let licenseKey: string
    try {
      licenseKey = getBusinessConfig().tenant_id
    } catch (err) {
      return { ok: false, error: 'Configuración del negocio no disponible.', code: 'UNAVAILABLE' }
    }

    // Resolvemos todos los locales activos como authorizedStores (igual que cajeras)
    const { getFirestore, collection, getDocs } = await import('firebase/firestore')
    const app = getFirebaseApp()
    const fsDb = getFirestore(app)
    const storesSnap = await getDocs(collection(fsDb, 'licenses', licenseKey, 'stores'))
    const authorizedStores = storesSnap.docs
      .filter(d => !d.data()['archivedAt'])
      .map(d => d.id)

    const result = await createTenantAuthUser({
      licenseKey,
      email,
      displayName: existing.name,
      role: 'butcher',
      authorizedStores: authorizedStores.length > 0 ? authorizedStores : [existing.homeStoreId ?? 'default'],
      employeeId,
    })

    if (!result.ok) return result

    // Guardar el UID en SQLite para vinculación
    db.update(employees)
      .set({ firebaseUid: result.data.uid, syncedAt: null })
      .where(eq(employees.id, employeeId))
      .run()

    log.info('[ipc:grant-butcher-access] Acceso celular otorgado', { employeeId, email, uid: result.data.uid })
    scheduleEmployeePush('ipc:grant-butcher-access')
    return { ok: true, data: { uid: result.data.uid } }
  })

  // --------------------------------------------------------------------------
  // REVOKE_BUTCHER_ACCESS — solo admin
  // Desactiva la cuenta Firebase y borra firebaseUid en SQLite.
  // --------------------------------------------------------------------------
  const revokeButcherSchema = z.object({
    employeeId: z.string().min(1),
  })

  ipcMain.handle(IPC.REVOKE_BUTCHER_ACCESS, async (_event, payload: unknown): Promise<IpcResult> => {
    const parsed = revokeButcherSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const denied = requireAdmin()
    if (denied) return denied

    const { employeeId } = parsed.data

    const db = getDb()
    const existing = db.select().from(employees).where(eq(employees.id, employeeId)).get()
    if (!existing) return { ok: false, error: 'Empleado no encontrado.', code: 'NOT_FOUND' }
    if (!existing.firebaseUid) {
      return { ok: false, error: 'Este carnicero no tiene acceso al celular.', code: 'NOT_FOUND' }
    }

    if (isFirebaseAvailable()) {
      try {
        const licenseKey = getBusinessConfig().tenant_id
        const { getFirestore, doc, updateDoc } = await import('firebase/firestore')
        const fsDb = getFirestore(getFirebaseApp())
        await updateDoc(doc(fsDb, 'licenses', licenseKey, 'users', existing.firebaseUid), {
          active: false,
        })
      } catch (err) {
        log.warn('[ipc:revoke-butcher-access] No se pudo desactivar en Firestore (continúa)', err)
      }
    }

    // Limpiar el vínculo local independientemente de si Firebase respondió
    db.update(employees)
      .set({ firebaseUid: null, syncedAt: null })
      .where(eq(employees.id, employeeId))
      .run()

    log.info('[ipc:revoke-butcher-access] Acceso revocado', { employeeId })
    scheduleEmployeePush('ipc:revoke-butcher-access')
    return { ok: true, data: undefined }
  })
}
