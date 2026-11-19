import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import log from 'electron-log'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

vi.mock('better-sqlite3', () => ({
  default: vi.fn().mockImplementation(() => ({
    pragma: vi.fn(),
    close: vi.fn(),
  })),
}))

const mockMigrate = vi.fn()

vi.mock('drizzle-orm/better-sqlite3/migrator', () => ({
  migrate: (...args: unknown[]) => mockMigrate(...args),
}))

describe('runMigrations', () => {
  beforeEach(() => {
    vi.resetModules()
    mockMigrate.mockReset()
  })

  it('aplica migraciones y crea backup pre-migración', { timeout: 15_000 }, async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'))
    const dbPath = path.join(tmpDir, 'app.sqlite')
    fs.writeFileSync(dbPath, '') // DB existente → backup pre-migración
    const migrationsFolder = path.resolve(__dirname, '../../../drizzle')

    const { runMigrations } = await import('../migrate')
    const result = await runMigrations(dbPath, migrationsFolder)

    expect(result.ok).toBe(true)
    expect(result.backupPath).toBeTruthy()
    expect(mockMigrate).toHaveBeenCalledOnce()

    const { closeDb } = await import('../client')
    closeDb()
  })

  it('restaura backup si las migraciones fallan', async () => {
    mockMigrate.mockImplementation(() => {
      throw new Error('migración corrupta')
    })

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-fail-'))
    const dbPath = path.join(tmpDir, 'app.sqlite')
    fs.writeFileSync(dbPath, 'contenido-original')

    const { runMigrations } = await import('../migrate')
    const result = await runMigrations(dbPath, path.resolve(__dirname, '../../../drizzle'))

    expect(result.ok).toBe(false)
    expect(result.error).toContain('migración corrupta')
    expect(fs.readFileSync(dbPath, 'utf8')).toBe('contenido-original')

    const { closeDb } = await import('../client')
    closeDb()
  })

  it('sigue con la migración si la copia falla', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-copy-fail-'))
    const dbPath = path.join(tmpDir, 'app.sqlite')
    fs.writeFileSync(dbPath, 'contenido-original')
    fs.writeFileSync(path.join(tmpDir, 'backups'), 'no es una carpeta')

    const { runMigrations } = await import('../migrate')
    const result = await runMigrations(dbPath, path.resolve(__dirname, '../../../drizzle'))

    expect(result.ok).toBe(true)
    expect(result.backupPath).toBeUndefined()
    expect(mockMigrate).toHaveBeenCalledOnce()
    expect(fs.readFileSync(dbPath, 'utf8')).toBe('contenido-original')
    expect(vi.mocked(log.error).mock.calls.some(call => String(call[0]).includes('No se pudo copiar'))).toBe(true)

    const { closeDb } = await import('../client')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})
