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

  it('pone la fecha y el número de migración anterior en el nombre', () => {
    const dbPath = createFakeDb(tmpDir)
    const now = new Date()
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const result = backupBeforeMigration(dbPath, '0060')

    expect(result.ok).toBe(true)
    expect(result.backupPath).toBeDefined()
    expect(path.dirname(result.backupPath!)).toBe(path.join(tmpDir, 'backups'))
    expect(path.basename(result.backupPath!)).toMatch(
      new RegExp(`^pre-migration-${day}-\\d{6}-\\d{3}-0060\\.sqlite$`),
    )
    expect(fs.readFileSync(result.backupPath!, 'utf8')).toBe('fake sqlite content')
  })

  it('conserva solo las últimas 3 copias y no toca el backup diario', () => {
    const dbPath = createFakeDb(tmpDir)
    const daily = backupDaily(dbPath)
    const backupsDir = path.join(tmpDir, 'backups')
    for (let i = 0; i < 3; i++) {
      const name = `pre-migration-2020-01-0${i + 1}-000000-000-000${i}.sqlite`
      const full = path.join(backupsDir, name)
      fs.writeFileSync(full, 'viejo')
      const when = new Date(2020, 0, i + 1)
      fs.utimesSync(full, when, when)
    }

    const created = backupBeforeMigration(dbPath, '0061')
    const files = fs.readdirSync(backupsDir).filter(name => name.startsWith('pre-migration-'))

    expect(created.ok).toBe(true)
    expect(files).toHaveLength(3)
    expect(files.some(name => name.endsWith('-0061.sqlite'))).toBe(true)
    expect(files.some(name => name.endsWith('-0000.sqlite'))).toBe(false)
    expect(fs.existsSync(daily.backupPath!)).toBe(true)
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
