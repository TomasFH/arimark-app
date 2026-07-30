import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn().mockReturnValue('/fake/app'),
    getVersion: vi.fn().mockReturnValue('0.1.0'),
  },
}))

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carniceria-config-test-'))

function writeConfig(obj: unknown) {
  fs.writeFileSync(path.join(tmpDir, 'business.json'), JSON.stringify(obj))
  return path.join(tmpDir, 'business.json')
}

describe('loadBusinessConfig', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env['APP_ENV'] = 'production'
  })

  it('carga correctamente una config válida', async () => {
    const configPath = writeConfig({
      business_name: 'Mi Carnicería',
      tenant_id: 'ABC-123',
      timezone: 'America/Argentina/Buenos_Aires',
      default_store_id: 'store-uuid-001',
      logo_path: '',
      theme: { primary: '#000' },
    })

    const { loadBusinessConfig } = await import('../businessConfig')
    const config = loadBusinessConfig(configPath)

    expect(config.business_name).toBe('Mi Carnicería')
    expect(config.tenant_id).toBe('ABC-123')
    expect(config.default_store_id).toBe('store-uuid-001')
  })

  it('acepta license_key legacy y lo normaliza a tenant_id', async () => {
    const configPath = writeConfig({
      business_name: 'Negocio Legacy',
      license_key: 'LEGACY-001',
      default_store_id: 'store-001',
    })

    const { loadBusinessConfig } = await import('../businessConfig')
    const config = loadBusinessConfig(configPath)
    expect(config.tenant_id).toBe('LEGACY-001')
    expect('license_key' in config).toBe(false)
  })

  it('aplica timezone default si no se provee', async () => {
    const configPath = writeConfig({
      business_name: 'Negocio',
      tenant_id: 'XYZ',
      default_store_id: 'store-001',
    })

    const { loadBusinessConfig } = await import('../businessConfig')
    const config = loadBusinessConfig(configPath)
    expect(config.timezone).toBe('America/Argentina/Buenos_Aires')
  })

  it('lanza error si business_name está vacío', async () => {
    const configPath = writeConfig({
      business_name: '',
      tenant_id: 'ABC',
      default_store_id: 'store-001',
    })

    const { loadBusinessConfig } = await import('../businessConfig')
    expect(() => loadBusinessConfig(configPath)).toThrow(/inválido/)
  })

  it('lanza error si el archivo no existe en producción', async () => {
    process.env['APP_ENV'] = 'production'
    const { loadBusinessConfig } = await import('../businessConfig')
    expect(() => loadBusinessConfig('/ruta/inexistente/business.json')).toThrow(/no encontrado/)
  })

  it('retorna config ficticia de dev si el archivo no existe en modo dev', async () => {
    process.env['APP_ENV'] = 'dev'
    const { loadBusinessConfig } = await import('../businessConfig')
    const config = loadBusinessConfig('/ruta/inexistente/business.json')
    expect(config.tenant_id).toBe('SANDBOX-0000-0000-0000')
  })

  it('lanza error si el JSON está malformado', async () => {
    const configPath = path.join(tmpDir, 'bad.json')
    fs.writeFileSync(configPath, '{ invalid json }')
    const { loadBusinessConfig } = await import('../businessConfig')
    expect(() => loadBusinessConfig(configPath)).toThrow(/Error al parsear/)
  })
})
