import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'path'
import log from 'electron-log'
import { initDb, closeDb } from './client'
import { backupBeforeMigration, restoreFromBackup } from './backup'

const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle')

export interface MigrateResult {
  ok: boolean
  error?: string
  backupPath?: string
}

/**
 * Punto de entrada: inicializa la DB y aplica las migraciones pendientes.
 * Si las migraciones fallan, restaura el backup y retorna error.
 *
 * Debe llamarse en main.ts ANTES de registrar handlers IPC.
 */
export async function runMigrations(dbPath: string): Promise<MigrateResult> {
  log.info('[migrate] Iniciando migraciones', { dbPath, folder: MIGRATIONS_FOLDER })

  const backup = backupBeforeMigration(dbPath)
  if (!backup.ok) {
    return { ok: false, error: `Falló el backup pre-migración: ${backup.error}` }
  }

  try {
    const db = initDb(dbPath)
    drizzleMigrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
    log.info('[migrate] Migraciones aplicadas correctamente')
    return { ok: true, backupPath: backup.backupPath }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.error('[migrate] Error al aplicar migraciones — restaurando backup', error)

    closeDb()

    if (backup.backupPath) {
      const restore = restoreFromBackup(backup.backupPath, dbPath)
      if (!restore.ok) {
        log.error('[migrate] Falló la restauración del backup', restore.error)
      }
    }

    return { ok: false, error }
  }
}
