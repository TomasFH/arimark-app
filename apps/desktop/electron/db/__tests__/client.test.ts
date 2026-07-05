import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => path.join(os.tmpdir(), 'carniceria-test-userdata')) },
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

const mockPragma = vi.fn()
const mockClose = vi.fn()

vi.mock('better-sqlite3', () => ({
  default: vi.fn().mockImplementation(() => ({
    pragma: mockPragma,
    close: mockClose,
  })),
}))

describe('db/client', () => {
  beforeEach(() => {
    vi.resetModules()
    mockPragma.mockClear()
    mockClose.mockClear()
    process.env['APP_ENV'] = 'dev'
  })

  afterEach(async () => {
    const { closeDb } = await import('../client')
    closeDb()
  })

  it('getDbPath usa subcarpeta dev en modo dev', async () => {
    const { getDbPath } = await import('../client')
    expect(getDbPath()).toMatch(/dev[\\/]app\.sqlite$/)
  })

  it('getDbPath usa app.sqlite en producción', async () => {
    process.env['APP_ENV'] = 'production'
    vi.resetModules()
    const { getDbPath } = await import('../client')
    expect(getDbPath()).toMatch(/app\.sqlite$/)
    expect(getDbPath()).not.toMatch(/dev/)
  })

  it('getDb lanza si initDb no fue llamado', async () => {
    const { getDb } = await import('../client')
    expect(() => getDb()).toThrow(/no fue inicializada/)
  })

  it('initDb crea directorio padre, abre SQLite y expone getDb/getRawSqlite', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-client-test-'))
    const dbPath = path.join(tmpDir, 'nested', 'test.sqlite')

    const { initDb, getDb, getRawSqlite, closeDb } = await import('../client')
    initDb(dbPath)

    expect(fs.existsSync(path.dirname(dbPath))).toBe(true)
    expect(getDb()).toBeDefined()
    expect(getRawSqlite()).toBeDefined()
    expect(mockPragma).toHaveBeenCalledWith('journal_mode = WAL')
    expect(mockPragma).toHaveBeenCalledWith('foreign_keys = ON')

    closeDb()
    expect(() => getDb()).toThrow(/no fue inicializada/)
  })
})
