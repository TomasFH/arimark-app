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

/**
 * Schema interno. Acepta `tenant_id` (nuevo) o `license_key` (legacy) vía preprocess.
 * El tipo expuesto solo tiene `tenant_id`.
 */
const businessConfigObjectSchema = z.object({
  business_name: z.string().min(1, 'business_name es obligatorio'),
  tenant_id: z.string().min(1, 'tenant_id es obligatorio'),
  timezone: z.string().min(1).default('America/Argentina/Buenos_Aires'),
  default_store_id: z.string().min(1, 'default_store_id es obligatorio'),
  logo_path: z.string().default(''),
  theme: themeSchema,
  /** Horas sin ventas antes de mostrar el aviso de cierre automático de turno.
   *  Mínimo real: 0.01 h (≈36 s) — útil en dev para pruebas rápidas. */
  inactivityThresholdHours: z.number().min(0.01).max(24).default(1.5),
})

export const businessConfigSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = { ...(raw as Record<string, unknown>) }
    // Compat: archivos viejos con license_key → tenant_id
    if ((o['tenant_id'] === undefined || o['tenant_id'] === null || o['tenant_id'] === '')
      && typeof o['license_key'] === 'string' && o['license_key'].length > 0) {
      o['tenant_id'] = o['license_key']
    }
    delete o['license_key']
    return o
  }
  return raw
}, businessConfigObjectSchema)

export type BusinessConfig = z.infer<typeof businessConfigObjectSchema>

let _config: BusinessConfig | null = null

/**
 * Carga y valida el archivo business.json.
 * En sandbox, si el archivo no existe, retorna configuración ficticia.
 * En producción, si el archivo no existe o es inválido, lanza error.
 */
export function loadBusinessConfig(configPath?: string): BusinessConfig {
  const APP_ENV = process.env['APP_ENV'] ?? 'dev'
  const resolvedPath = configPath ?? getDefaultConfigPath()

  if (!fs.existsSync(resolvedPath)) {
    if (APP_ENV === 'dev') {
      log.warn('[businessConfig] business.json no encontrado — usando config ficticia de pruebas')
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
    tenant_id: 'SANDBOX-0000-0000-0000',
    timezone: 'America/Argentina/Buenos_Aires',
    default_store_id: '00000000-0000-0000-0000-000000000001',
    logo_path: '',
    theme: { primary: '#1a1a1a', accent: '#e53e3e' },
    inactivityThresholdHours: 1.5,
  }
}
