import fs from 'fs'
import path from 'path'
import log from 'electron-log'

const MAX_PRE_MIGRATION_BACKUPS = 3
const MAX_DAILY_BACKUPS = 30
const COMPRESS_AFTER_DAYS = 7

export interface BackupResult {
  ok: boolean
  backupPath?: string
  error?: string
}

/**
 * Copia la DB a `backups/` junto al archivo, antes de migrar.
 * El nombre lleva la fecha local y el número de la migración ya aplicada.
 * Quedan solo las últimas 3 copias. Si la copia falla, no lanza: el llamador sigue.
 */
export function backupBeforeMigration(dbPath: string, previousMigration = 'ninguna'): BackupResult {
  if (!fs.existsSync(dbPath)) {
    return { ok: true }
  }

  const backupsDir = path.join(path.dirname(dbPath), 'backups')
  const migrationNumber = /^\d+$/.test(previousMigration) ? previousMigration : 'ninguna'

  try {
    ensureDir(backupsDir)
    const backupPath = uniqueBackupPath(backupsDir, migrationNumber)
    fs.copyFileSync(dbPath, backupPath)
    log.info('[backup] Backup pre-migración creado', backupPath)
    pruneOldBackups(backupsDir, 'pre-migration-', MAX_PRE_MIGRATION_BACKUPS)
    return { ok: true, backupPath }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.error('[backup] Error al crear backup pre-migración', error)
    return { ok: false, error }
  }
}

/**
 * Crea una copia diaria de la DB al cierre del último turno.
 * Mantiene los últimos MAX_DAILY_BACKUPS días.
 * Comprime (renombra a .bak) los backups con más de COMPRESS_AFTER_DAYS días.
 */
export function backupDaily(dbPath: string): BackupResult {
  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: 'La base de datos no existe en la ruta indicada.' }
  }

  const backupsDir = path.join(path.dirname(dbPath), 'backups')
  ensureDir(backupsDir)

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const backupPath = path.join(backupsDir, `daily-${today}.sqlite`)

  if (fs.existsSync(backupPath)) {
    log.info('[backup] Backup diario ya existe para hoy', backupPath)
    return { ok: true, backupPath }
  }

  try {
    fs.copyFileSync(dbPath, backupPath)
    log.info('[backup] Backup diario creado', backupPath)
    pruneOldBackups(backupsDir, 'daily-', MAX_DAILY_BACKUPS)
    markOldBackups(backupsDir, 'daily-', COMPRESS_AFTER_DAYS)
    return { ok: true, backupPath }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.error('[backup] Error al crear backup diario', error)
    return { ok: false, error }
  }
}

/**
 * Restaura la DB desde un backup. Usado cuando una migración falla.
 */
export function restoreFromBackup(backupPath: string, targetDbPath: string): BackupResult {
  if (!fs.existsSync(backupPath)) {
    return { ok: false, error: `Backup no encontrado: ${backupPath}` }
  }

  try {
    fs.copyFileSync(backupPath, targetDbPath)
    log.info('[backup] DB restaurada desde', backupPath)
    return { ok: true, backupPath }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.error('[backup] Error al restaurar DB', error)
    return { ok: false, error }
  }
}

/**
 * Lista los backups disponibles para restaurar (solo pre-migración y diarios).
 */
export function listBackups(dbPath: string): string[] {
  const backupsDir = path.join(path.dirname(dbPath), 'backups')
  if (!fs.existsSync(backupsDir)) return []

  return fs
    .readdirSync(backupsDir)
    .filter(f => f.endsWith('.sqlite'))
    .map(f => path.join(backupsDir, f))
    .sort()
    .reverse()
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function localStamp(now: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}` +
    `-${pad(now.getMilliseconds(), 3)}`
  )
}

function uniqueBackupPath(backupsDir: string, migrationNumber: string): string {
  const stamp = localStamp(new Date())
  let name = `pre-migration-${stamp}-${migrationNumber}.sqlite`
  let extra = 2
  while (fs.existsSync(path.join(backupsDir, name))) {
    name = `pre-migration-${stamp}-${migrationNumber}-${extra}.sqlite`
    extra += 1
  }
  return path.join(backupsDir, name)
}

function pruneOldBackups(dir: string, prefix: string, maxCount: number): void {
  const files = fs
    .readdirSync(dir)
    .filter(name => name.startsWith(prefix) && name.endsWith('.sqlite'))
    .map(name => {
      const fullPath = path.join(dir, name)
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs }
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.fullPath.localeCompare(b.fullPath))

  while (files.length > maxCount) {
    const oldest = files.shift()
    if (!oldest) break
    try {
      fs.unlinkSync(oldest.fullPath)
      log.info('[backup] Backup antiguo eliminado', oldest.fullPath)
    } catch (err) {
      log.warn('[backup] No se pudo eliminar backup antiguo', oldest.fullPath, err)
    }
  }
}

/**
 * Renombra backups más viejos que daysThreshold a .bak (indicador de compresión pendiente).
 */
function markOldBackups(dir: string, prefix: string, daysThreshold: number): void {
  const now = Date.now()
  const threshold = daysThreshold * 24 * 60 * 60 * 1000

  fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.sqlite'))
    .forEach(f => {
      const fullPath = path.join(dir, f)
      const stat = fs.statSync(fullPath)
      if (now - stat.mtimeMs > threshold) {
        const bakPath = fullPath.replace('.sqlite', '.bak')
        if (!fs.existsSync(bakPath)) {
          fs.renameSync(fullPath, bakPath)
          log.info('[backup] Backup marcado como .bak', bakPath)
        }
      }
    })
}
