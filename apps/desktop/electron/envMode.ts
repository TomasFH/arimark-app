/**
 * Utilidades centralizadas para determinar el modo de ejecución.
 *
 * Modos:
 *  - dev        → modo de pruebas (sin Firebase, sin licencias, DB separada)
 *                 Hardware: real si KRETZ_PORT está definido, mock en caso contrario.
 *  - production → modo real (Firebase, licencias, DB de producción, hardware real)
 */

export type AppEnv = 'dev' | 'production'

export const APP_ENV: AppEnv = (process.env['APP_ENV'] ?? 'dev') as AppEnv

/** True en dev — sin Firebase ni verificación de licencias online. */
export const isDevMode = (): boolean => APP_ENV === 'dev'

/** True solo en producción. */
export const isProduction = (): boolean => APP_ENV === 'production'
