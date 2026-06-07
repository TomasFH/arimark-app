/**
 * Utilidades centralizadas para determinar el modo de ejecución.
 *
 * Modos:
 *  - sandbox    → simulación completa (mocks, sin Firebase, sin licencias)
 *  - fieldtest  → hardware real + DB local, sin Firebase ni licencias
 *  - production → hardware real + Firebase + licencias + Firestore sessions
 */

export type AppEnv = 'sandbox' | 'fieldtest' | 'production'

export const APP_ENV: AppEnv = (process.env['APP_ENV'] ?? 'sandbox') as AppEnv

/** True en sandbox y fieldtest — sin Firebase ni verificación de licencias online. */
export const isLocalMode = (): boolean => APP_ENV === 'sandbox' || APP_ENV === 'fieldtest'

/** True solo en fieldtest — drivers reales, sin panel de simulación. */
export const isFieldTest = (): boolean => APP_ENV === 'fieldtest'

/** True solo en producción. */
export const isProduction = (): boolean => APP_ENV === 'production'
