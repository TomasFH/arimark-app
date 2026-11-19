import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import log from 'electron-log'
import { closeDb } from '../client'
import { runMigrations } from '../migrate'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

const mockMigrate = vi.fn()

vi.mock('drizzle-orm/better-sqlite3/migrator', () => ({
  migrate: (...args: unknown[]) => mockMigrate(...args),
}))

const migrationsFolder = path.resolve(__dirname, '../../../drizzle')

interface JournalEntry {
  when: number
  tag: string
}

function journalEntries(): JournalEntry[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('entries' in parsed) || !Array.isArray(parsed.entries)) {
    throw new Error('El journal no tiene entradas.')
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
      throw new Error('Entrada de journal inválida.')
    }
    return { when: entry.when, tag: entry.tag }
  })
}

function migrationNumber(tag: string): string {
  return /^(\d+)/.exec(tag)?.[1] ?? 'ninguna'
}

function dbAt(dbPath: string, createdAt: number): void {
  const sqlite = new Database(dbPath)
  sqlite.exec(`
    CREATE TABLE __drizzle_migrations (
      id integer PRIMARY KEY AUTOINCREMENT,
      hash text NOT NULL,
      created_at numeric
    )
  `)
  sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run('test', createdAt)
  sqlite.close()
}

describe('copia de la base antes de migrar', () => {
  let tmpDir = ''

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-real-'))
    mockMigrate.mockReset()
    vi.mocked(log.error).mockClear()
  })

  afterEach(() => {
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('no copia si no hay migraciones pendientes', async () => {
    const latest = journalEntries().at(-1)
    if (!latest) throw new Error('El journal está vacío.')
    const dbPath = path.join(tmpDir, 'app.sqlite')
    dbAt(dbPath, latest.when)

    const result = await runMigrations(dbPath, migrationsFolder)

    expect(result.ok).toBe(true)
    expect(result.backupPath).toBeUndefined()
    expect(fs.existsSync(path.join(tmpDir, 'backups'))).toBe(false)
    expect(mockMigrate).toHaveBeenCalledOnce()
  })

  it('nombra la copia con la fecha y el número de la migración anterior', async () => {
    const entries = journalEntries()
    const previous = entries.find(entry => entry.tag.startsWith('0060_'))
    const latest = entries.at(-1)
    if (!previous || !latest) throw new Error('Falta la migración 0060 en el journal.')
    const dbPath = path.join(tmpDir, 'app.sqlite')
    dbAt(dbPath, previous.when)
    const now = new Date()
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    const result = await runMigrations(dbPath, migrationsFolder)

    expect(result.ok).toBe(true)
    const backupPath = result.backupPath
    if (!backupPath) throw new Error('No se creó la copia.')
    expect(path.dirname(backupPath)).toBe(path.join(tmpDir, 'backups'))
    expect(path.basename(backupPath)).toMatch(
      new RegExp(`^pre-migration-${day}-\\d{6}-\\d{3}-${migrationNumber(previous.tag)}\\.sqlite$`),
    )
    expect(path.basename(backupPath).endsWith(`-${migrationNumber(latest.tag)}.sqlite`)).toBe(false)
  })

  it('sigue migrando si no puede crear la carpeta de copias', async () => {
    const previous = journalEntries().find(entry => entry.tag.startsWith('0060_'))
    if (!previous) throw new Error('Falta la migración 0060 en el journal.')
    const dbPath = path.join(tmpDir, 'app.sqlite')
    dbAt(dbPath, previous.when)
    fs.writeFileSync(path.join(tmpDir, 'backups'), 'no es una carpeta')

    const result = await runMigrations(dbPath, migrationsFolder)

    expect(result.ok).toBe(true)
    expect(result.backupPath).toBeUndefined()
    expect(mockMigrate).toHaveBeenCalledOnce()
    expect(fs.readFileSync(path.join(tmpDir, 'backups'), 'utf8')).toBe('no es una carpeta')
    expect(vi.mocked(log.error).mock.calls.some(call => String(call[0]).includes('No se pudo copiar'))).toBe(true)
  })
})
