import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'path'
import log from 'electron-log'
import { initDb, closeDb } from './client'
import { backupBeforeMigration, restoreFromBackup } from './backup'
import { inspectPendingMigrations } from './pendingMigrations'

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
 * Si hay pendientes, copia la base antes. Si esa copia falla, lo registra y sigue.
 * Si las migraciones fallan y la copia existe, restaura esa copia.
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

  let backupPath: string | undefined

  try {
    const state = inspectPendingMigrations(dbPath, migrationsFolder)
    if (state.unreadable) {
      log.warn('[migrate] No se pudo leer la migración aplicada. Se intenta copiar la base igual', state.readError)
    }
    if (state.pending) {
      const backup = backupBeforeMigration(dbPath, state.previousNumber)
      if (!backup.ok) {
        log.error('[migrate] No se pudo copiar la base antes de migrar. La app sigue', backup.error)
      } else {
        backupPath = backup.backupPath
      }
    } else {
      log.info('[migrate] Sin migraciones pendientes. No se copia la base')
    }

    const db = initDb(dbPath)
    drizzleMigrate(db, { migrationsFolder })
    log.info('[migrate] Migraciones aplicadas correctamente')
    return { ok: true, backupPath }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    closeDb()

    if (backupPath) {
      log.error('[migrate] Error al aplicar migraciones. Se restaura la copia', error)
      const restore = restoreFromBackup(backupPath, dbPath)
      if (!restore.ok) {
        log.error('[migrate] Falló la restauración del backup', restore.error)
      }
    } else {
      log.error('[migrate] Error al aplicar migraciones. No hay copia para restaurar', error)
    }

    return { ok: false, error }
  }
}
