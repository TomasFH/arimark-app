import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { backupBeforeMigration, backupDaily, restoreFromBackup, listBackups } from '../backup'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carniceria-backup-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function createFakeDb(dir: string, name = 'app.sqlite'): string {
  const dbPath = path.join(dir, name)
  fs.writeFileSync(dbPath, 'fake sqlite content')
  return dbPath
}

describe('backupBeforeMigration', () => {
  it('retorna ok:true si la DB no existe (primera instalación)', () => {
    const result = backupBeforeMigration(path.join(tmpDir, 'nonexistent.sqlite'))
    expect(result.ok).toBe(true)
    expect(result.backupPath).toBeUndefined()
  })

  it('crea archivo de backup con prefijo pre-migration-', () => {
    const dbPath = createFakeDb(tmpDir)
    const result = backupBeforeMigration(dbPath)

    expect(result.ok).toBe(true)
    expect(result.backupPath).toBeDefined()
    expect(fs.existsSync(result.backupPath!)).toBe(true)
    expect(path.basename(result.backupPath!)).toMatch(/^pre-migration-/)
  })

  it('no supera MAX_PRE_MIGRATION_BACKUPS (10) backups', () => {
    const dbPath = createFakeDb(tmpDir)
    for (let i = 0; i < 15; i++) {
      backupBeforeMigration(dbPath)
    }
    const backupsDir = path.join(tmpDir, 'backups')
    const files = fs.readdirSync(backupsDir).filter(f => f.startsWith('pre-migration-'))
    expect(files.length).toBeLessThanOrEqual(10)
  })
})

describe('backupDaily', () => {
  it('retorna error si la DB no existe', () => {
    const result = backupDaily(path.join(tmpDir, 'nonexistent.sqlite'))
    expect(result.ok).toBe(false)
  })

  it('crea backup con prefijo daily-', () => {
    const dbPath = createFakeDb(tmpDir)
    const result = backupDaily(dbPath)

    expect(result.ok).toBe(true)
    expect(path.basename(result.backupPath!)).toMatch(/^daily-\d{8}\.sqlite$/)
  })

  it('no crea duplicado si ya existe el backup de hoy', () => {
    const dbPath = createFakeDb(tmpDir)
    backupDaily(dbPath)
    const result = backupDaily(dbPath)

    const backupsDir = path.join(tmpDir, 'backups')
    const files = fs.readdirSync(backupsDir).filter(f => f.startsWith('daily-') && f.endsWith('.sqlite'))
    expect(files.length).toBe(1)
    expect(result.ok).toBe(true)
  })
})

describe('restoreFromBackup', () => {
  it('restaura correctamente desde un backup existente', () => {
    const dbPath = createFakeDb(tmpDir, 'app.sqlite')
    const backupResult = backupBeforeMigration(dbPath)
    expect(backupResult.ok).toBe(true)

    fs.writeFileSync(dbPath, 'corrupted content')

    const restoreResult = restoreFromBackup(backupResult.backupPath!, dbPath)
    expect(restoreResult.ok).toBe(true)
    expect(fs.readFileSync(dbPath, 'utf-8')).toBe('fake sqlite content')
  })

  it('retorna error si el backup no existe', () => {
    const result = restoreFromBackup('/nonexistent/backup.sqlite', path.join(tmpDir, 'app.sqlite'))
    expect(result.ok).toBe(false)
  })
})

describe('listBackups', () => {
  it('lista los backups disponibles en orden descendente', () => {
    const dbPath = createFakeDb(tmpDir)
    backupBeforeMigration(dbPath)
    backupDaily(dbPath)

    const backups = listBackups(dbPath)
    expect(backups.length).toBeGreaterThanOrEqual(2)
    expect(backups[0] > backups[1]).toBe(true)
  })

  it('retorna array vacío si no hay backups', () => {
    const backups = listBackups(path.join(tmpDir, 'no-backups', 'app.sqlite'))
    expect(backups).toEqual([])
  })
})
