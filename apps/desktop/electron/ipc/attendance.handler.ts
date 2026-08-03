/**
 * IPC de asistencia de empleados.
 *
 * Canales:
 *   RECORD_ATTENDANCE  — upsert por (employeeId, date); cajera o admin
 *   UPDATE_ATTENDANCE  — actualiza status/note por id
 *   LIST_ATTENDANCE    — rango de fechas + join a empleados
 */
import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { and, eq, gte, lte } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { attendance, employees } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { pushUnsyncedAttendance } from '../licensing/employeeSync'
import type { AttendanceRow, AttendanceStatus, IpcResult } from '../../src/types/hw-api'

const STATUS_VALUES = ['present', 'absent', 'late', 'early_departure'] as const

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)')

const recordSchema = z.object({
  employeeId: z.string().min(1),
  date: dateSchema,
  status: z.enum(STATUS_VALUES),
  note: z.string().max(500).transform(s => s.trim()).optional().nullable(),
})

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(STATUS_VALUES).optional(),
  note: z.string().max(500).transform(s => s.trim()).optional().nullable(),
})

const listSchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
  employeeId: z.string().min(1).optional(),
})

function toRow(
  row: typeof attendance.$inferSelect,
  employeeName: string,
): AttendanceRow {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName,
    date: row.date,
    status: row.status as AttendanceStatus,
    note: row.note ?? null,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt,
  }
}

export function registerAttendanceHandlers(): void {
  // --------------------------------------------------------------------------
  // RECORD_ATTENDANCE — upsert (employeeId, date)
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.RECORD_ATTENDANCE, (_event, payload: unknown): IpcResult<AttendanceRow> => {
    const parsed = recordSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:record-attendance] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { employeeId, date, status } = parsed.data
    const note = parsed.data.note === undefined ? null : (parsed.data.note || null)

    try {
      const db = getDb()
      const employee = db.select().from(employees).where(eq(employees.id, employeeId)).all()[0]
      if (!employee) return { ok: false, error: 'Empleado no encontrado.', code: 'NOT_FOUND' }
      if (!employee.active) {
        return { ok: false, error: 'El empleado está archivado.', code: 'CONFLICT' }
      }

      const existing = db.select().from(attendance)
        .where(and(eq(attendance.employeeId, employeeId), eq(attendance.date, date)))
        .all()[0]

      const now = new Date().toISOString()

      if (existing) {
        db.update(attendance)
          .set({
            status,
            note,
            recordedBy: session.userId,
            syncedAt: null,
          })
          .where(eq(attendance.id, existing.id))
          .run()

        log.info('[ipc:record-attendance] Asistencia actualizada (upsert)', {
          id: existing.id,
          employeeId,
          date,
          status,
        })
        const config = getBusinessConfig()
        pushUnsyncedAttendance(config.tenant_id).catch(err =>
          log.warn('[ipc:record-attendance] pushUnsyncedAttendance falló (no bloqueante)', err),
        )
        return {
          ok: true,
          data: toRow(
            { ...existing, status, note, recordedBy: session.userId, syncedAt: null },
            employee.name,
          ),
        }
      }

      const id = uuidv4()
      db.insert(attendance).values({
        id,
        employeeId,
        date,
        status,
        note,
        recordedBy: session.userId,
        createdAt: now,
        syncedAt: null,
      }).run()

      log.info('[ipc:record-attendance] Asistencia registrada', { id, employeeId, date, status })
      {
        const config = getBusinessConfig()
        pushUnsyncedAttendance(config.tenant_id).catch(err =>
          log.warn('[ipc:record-attendance] pushUnsyncedAttendance falló (no bloqueante)', err),
        )
      }
      return {
        ok: true,
        data: {
          id,
          employeeId,
          employeeName: employee.name,
          date,
          status,
          note,
          recordedBy: session.userId,
          createdAt: now,
        },
      }
    } catch (err) {
      log.error('[ipc:record-attendance] Error inesperado', err)
      return { ok: false, error: 'Error al registrar la asistencia.' }
    }
  })

  // --------------------------------------------------------------------------
  // UPDATE_ATTENDANCE
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.UPDATE_ATTENDANCE, (_event, payload: unknown): IpcResult<AttendanceRow> => {
    const parsed = updateSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:update-attendance] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { id, status } = parsed.data
    if (status === undefined && parsed.data.note === undefined) {
      return { ok: false, error: 'No hay campos para actualizar.', code: 'INVALID_PAYLOAD' }
    }

    try {
      const db = getDb()
      const existing = db.select().from(attendance).where(eq(attendance.id, id)).all()[0]
      if (!existing) return { ok: false, error: 'Registro de asistencia no encontrado.', code: 'NOT_FOUND' }

      const employee = db.select().from(employees).where(eq(employees.id, existing.employeeId)).all()[0]
      const employeeName = employee?.name ?? existing.employeeId

      const nextStatus = status ?? existing.status
      const nextNote = parsed.data.note === undefined
        ? existing.note
        : (parsed.data.note || null)

      db.update(attendance)
        .set({
          status: nextStatus,
          note: nextNote,
          recordedBy: session.userId,
          syncedAt: null,
        })
        .where(eq(attendance.id, id))
        .run()

      log.info('[ipc:update-attendance] Asistencia actualizada', { id, status: nextStatus })
      {
        const config = getBusinessConfig()
        pushUnsyncedAttendance(config.tenant_id).catch(err =>
          log.warn('[ipc:update-attendance] pushUnsyncedAttendance falló (no bloqueante)', err),
        )
      }
      return {
        ok: true,
        data: toRow(
          {
            ...existing,
            status: nextStatus,
            note: nextNote,
            recordedBy: session.userId,
            syncedAt: null,
          },
          employeeName,
        ),
      }
    } catch (err) {
      log.error('[ipc:update-attendance] Error inesperado', err)
      return { ok: false, error: 'Error al actualizar la asistencia.' }
    }
  })

  // --------------------------------------------------------------------------
  // LIST_ATTENDANCE
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.LIST_ATTENDANCE, (_event, payload: unknown): IpcResult<AttendanceRow[]> => {
    const parsed = listSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:list-attendance] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { startDate, endDate, employeeId } = parsed.data
    if (startDate > endDate) {
      return { ok: false, error: 'startDate no puede ser posterior a endDate.', code: 'INVALID_PAYLOAD' }
    }

    try {
      const db = getDb()
      const conditions = [
        gte(attendance.date, startDate),
        lte(attendance.date, endDate),
      ]
      if (employeeId) conditions.push(eq(attendance.employeeId, employeeId))

      const rows = db
        .select({
          attendance,
          employeeName: employees.name,
        })
        .from(attendance)
        .leftJoin(employees, eq(attendance.employeeId, employees.id))
        .where(and(...conditions))
        .all()

      const result = rows
        .map(r => toRow(r.attendance, r.employeeName ?? r.attendance.employeeId))
        .sort((a, b) => {
          const byDate = a.date.localeCompare(b.date)
          if (byDate !== 0) return byDate
          return a.employeeName.localeCompare(b.employeeName, 'es')
        })

      return { ok: true, data: result }
    } catch (err) {
      log.error('[ipc:list-attendance] Error inesperado', err)
      return { ok: false, error: 'Error al listar la asistencia.' }
    }
  })
}
