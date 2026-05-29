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
      license_key: 'ABC-123',
      timezone: 'America/Argentina/Buenos_Aires',
      default_store_id: 'store-uuid-001',
      logo_path: '',
      theme: { primary: '#000' },
    })

    const { loadBusinessConfig } = await import('../businessConfig')
    const config = loadBusinessConfig(configPath)

    expect(config.business_name).toBe('Mi Carnicería')
    expect(config.license_key).toBe('ABC-123')
    expect(config.default_store_id).toBe('store-uuid-001')
  })

  it('aplica timezone default si no se provee', async () => {
    const configPath = writeConfig({
      business_name: 'Negocio',
      license_key: 'XYZ',
      default_store_id: 'store-001',
    })

    const { loadBusinessConfig } = await import('../businessConfig')
    const config = loadBusinessConfig(configPath)
    expect(config.timezone).toBe('America/Argentina/Buenos_Aires')
  })

  it('lanza error si business_name está vacío', async () => {
    const configPath = writeConfig({
      business_name: '',
      license_key: 'ABC',
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

  it('retorna config sandbox ficticia si el archivo no existe en sandbox', async () => {
    process.env['APP_ENV'] = 'sandbox'
    const { loadBusinessConfig } = await import('../businessConfig')
    const config = loadBusinessConfig('/ruta/inexistente/business.json')
    expect(config.license_key).toBe('SANDBOX-0000-0000-0000')
  })

  it('lanza error si el JSON está malformado', async () => {
    const configPath = path.join(tmpDir, 'bad.json')
    fs.writeFileSync(configPath, '{ invalid json }')
    const { loadBusinessConfig } = await import('../businessConfig')
    expect(() => loadBusinessConfig(configPath)).toThrow(/Error al parsear/)
  })
})
