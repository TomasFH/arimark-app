import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'

export interface PendingMigrationState {
  pending: boolean
  /** Número de la última migración ya aplicada, o `ninguna`. */
  previousNumber: string
  /** La base existe pero no se pudo leer. Se trata como pendiente. */
  unreadable: boolean
  readError?: string
}

interface JournalEntry {
  when: number
  tag: string
}

/**
 * Compara el journal de Drizzle con `__drizzle_migrations`.
 * Una entrada está pendiente si su `when` es mayor que el último `created_at`.
 */
export function inspectPendingMigrations(dbPath: string, migrationsFolder: string): PendingMigrationState {
  const entries = readJournal(migrationsFolder)
  if (!fs.existsSync(dbPath)) {
    return { pending: entries.length > 0, previousNumber: 'ninguna', unreadable: false }
  }

  let lastWhen: number | null
  try {
    lastWhen = readLastMigrationWhen(dbPath)
  } catch (err) {
    const readError = err instanceof Error ? err.message : String(err)
    return { pending: true, previousNumber: 'ninguna', unreadable: true, readError }
  }

  const applied = entries.filter(entry => lastWhen !== null && entry.when <= lastWhen)
  const pending = entries.some(entry => lastWhen === null || entry.when > lastWhen)
  const previous = applied.at(-1)
  return {
    pending,
    previousNumber: previous ? migrationNumber(previous.tag) : 'ninguna',
    unreadable: false,
  }
}

function readJournal(migrationsFolder: string): JournalEntry[] {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json')
  const parsed: unknown = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('entries' in parsed) || !Array.isArray(parsed.entries)) {
    throw new Error('El journal de migraciones no tiene entradas.')
  }
  return parsed.entries.map(entry => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('when' in entry) ||
      !('tag' in entry) ||
      typeof entry.when !== 'number' ||
      typeof entry.tag !== 'string'
    ) {
      throw new Error('Una entrada del journal de migraciones es inválida.')
    }
    return { when: entry.when, tag: entry.tag }
  })
}

function readLastMigrationWhen(dbPath: string): number | null {
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const table = sqlite
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
      .get()
    if (table === undefined) return null
    const row = sqlite
      .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
      .get()
    return createdAtOf(row)
  } finally {
    sqlite.close()
  }
}

function createdAtOf(row: unknown): number | null {
  if (typeof row !== 'object' || row === null || !('created_at' in row)) return null
  const value = row.created_at
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  return null
}

function migrationNumber(tag: string): string {
  const match = /^(\d+)/.exec(tag)
  return match?.[1] ?? 'ninguna'
}
