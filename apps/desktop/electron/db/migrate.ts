import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'path'
import log from 'electron-log'
import { initDb, closeDb } from './client'
import { backupBeforeMigration, restoreFromBackup } from './backup'

/**
 * Folder de migraciones por defecto, relativo al código fuente.
 * Solo válido cuando se ejecuta desde la fuente (tsx/CLI), donde
 * __dirname = <repo>/electron/db.
 *
 * En Electron compilado, main.ts debe pasar el folder explícitamente
 * (vía app.getAppPath()) porque __dirname apunta a dist-electron.
 */
const DEFAULT_MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle')

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
 *
 * @param dbPath Ruta absoluta del archivo SQLite.
 * @param migrationsFolder Carpeta con las migraciones Drizzle. Si se omite,
 *   se usa la ubicación relativa a la fuente (solo válido fuera de Electron).
 */
export async function runMigrations(
  dbPath: string,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER
): Promise<MigrateResult> {
  log.info('[migrate] Iniciando migraciones', { dbPath, folder: migrationsFolder })

  const backup = backupBeforeMigration(dbPath)
  if (!backup.ok) {
    return { ok: false, error: `Falló el backup pre-migración: ${backup.error}` }
  }

  try {
    const db = initDb(dbPath)
    drizzleMigrate(db, { migrationsFolder })
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
