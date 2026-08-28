/**
 * IPC de empleados / carniceros (ABM admin).
 *
 * Canales:
 *   LIST_EMPLOYEES    — activos (o todos si includeArchived)
 *   CREATE_EMPLOYEE   — admin; nombre único
 *   UPDATE_EMPLOYEE   — admin; nombre y/o sueldo
 *   ARCHIVE_EMPLOYEE  — admin; soft-delete (active=false)
 *   UNARCHIVE_EMPLOYEE — admin; reactive (active=true)
 */
import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { employees } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { pushUnsyncedEmployees } from '../licensing/employeeSync'
import type { IpcResult, EmployeeRow } from '../../src/types/hw-api'

const listSchema = z.object({
  includeArchived: z.boolean().optional(),
}).optional()

const createSchema = z.object({
  name: z.string().min(1).max(100).transform(s => s.trim()),
  weeklyWage: z.number().int().min(0).max(999_999_999),
  kind: z.enum(['butcher', 'cashier']).default('butcher'),
})

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).transform(s => s.trim()).optional(),
  weeklyWage: z.number().int().min(0).max(999_999_999).optional(),
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
  }
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

    const { id, name, weeklyWage } = parsed.data
    if (name === undefined && weeklyWage === undefined) {
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

      db.update(employees)
        .set({ name: updatedName, weeklyWage: updatedWage, syncedAt: null })
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
}
