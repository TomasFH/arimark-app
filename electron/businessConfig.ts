/**
 * Loader tipado del archivo de configuración por cliente (config/business.json).
 *
 * REGLA: Ningún nombre de cliente, logo ni color de marca se hardcodea en el código.
 * Todo viene de este archivo. Si el archivo no existe o es inválido, la app no arranca.
 */

import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import log from 'electron-log'
import { app } from 'electron'

const themeSchema = z.object({
  primary: z.string().min(1).optional(),
  accent: z.string().min(1).optional(),
}).optional()

export const businessConfigSchema = z.object({
  business_name: z.string().min(1, 'business_name es obligatorio'),
  license_key: z.string().min(1, 'license_key es obligatorio'),
  timezone: z.string().min(1).default('America/Argentina/Buenos_Aires'),
  default_store_id: z.string().min(1, 'default_store_id es obligatorio'),
  logo_path: z.string().default(''),
  theme: themeSchema,
})

export type BusinessConfig = z.infer<typeof businessConfigSchema>

let _config: BusinessConfig | null = null

/**
 * Carga y valida el archivo business.json.
 * En sandbox, si el archivo no existe, retorna configuración ficticia.
 * En producción, si el archivo no existe o es inválido, lanza error.
 */
export function loadBusinessConfig(configPath?: string): BusinessConfig {
  const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'
  const resolvedPath = configPath ?? getDefaultConfigPath()

  if (!fs.existsSync(resolvedPath)) {
    if (APP_ENV === 'sandbox') {
      log.warn('[businessConfig] business.json no encontrado — usando config sandbox ficticia')
      _config = getSandboxConfig()
      return _config
    }
    throw new Error(
      `[businessConfig] business.json no encontrado en ${resolvedPath}. ` +
      'Copiar config/business.example.json a config/business.json con los datos reales.'
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'))
  } catch (err) {
    throw new Error(`[businessConfig] Error al parsear business.json: ${err}`)
  }

  const result = businessConfigSchema.safeParse(raw)
  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
    throw new Error(`[businessConfig] business.json inválido — ${errors}`)
  }

  log.info('[businessConfig] Configuración cargada', { business: result.data.business_name })
  _config = result.data
  return _config
}

export function getBusinessConfig(): BusinessConfig {
  if (!_config) throw new Error('[businessConfig] No inicializado. Llamar loadBusinessConfig() primero.')
  return _config
}

function getDefaultConfigPath(): string {
  const isPackaged = app.isPackaged
  if (isPackaged) {
    return path.join(path.dirname(app.getAppPath()), 'business.json')
  }
  return path.resolve(process.cwd(), 'config', 'business.json')
}

function getSandboxConfig(): BusinessConfig {
  return {
    business_name: 'Negocio de Prueba (Sandbox)',
    license_key: 'SANDBOX-0000-0000-0000',
    timezone: 'America/Argentina/Buenos_Aires',
    default_store_id: '00000000-0000-0000-0000-000000000001',
    logo_path: '',
    theme: { primary: '#1a1a1a', accent: '#e53e3e' },
  }
}
