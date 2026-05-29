/**
 * Helpers de fecha/hora.
 *
 * REGLA: Todas las fechas se persisten en SQLite y Firestore en UTC ISO 8601 con sufijo Z.
 * La conversión a hora local ocurre ÚNICAMENTE en esta capa de presentación.
 * Ningún otro módulo debería hacer conversiones de timezone directamente.
 */

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires'

let _timezone: string = DEFAULT_TIMEZONE

/**
 * Configura el timezone de presentación desde business_config.
 * Llamar al iniciar la app, después de cargar businessConfig.
 */
export function setDisplayTimezone(tz: string): void {
  _timezone = tz
}

export function getDisplayTimezone(): string {
  return _timezone
}

/**
 * Retorna el timestamp actual en UTC ISO 8601 con sufijo Z.
 * Usar para guardar en SQLite y Firestore.
 */
export function nowUtc(): string {
  return new Date().toISOString()
}

/**
 * Convierte un timestamp UTC a fecha y hora en el timezone de presentación.
 */
export function toLocalDateTime(utcString: string): string {
  return new Date(utcString).toLocaleString('es-AR', {
    timeZone: _timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Retorna solo la fecha (sin hora) en el timezone de presentación.
 */
export function toLocalDate(utcString: string): string {
  return new Date(utcString).toLocaleDateString('es-AR', {
    timeZone: _timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/**
 * Retorna solo la hora en el timezone de presentación.
 */
export function toLocalTime(utcString: string): string {
  return new Date(utcString).toLocaleTimeString('es-AR', {
    timeZone: _timezone,
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Formatea un monto en pesos argentinos.
 */
export function formatARS(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Formatea un peso en kg con 3 decimales.
 */
export function formatKg(kg: number): string {
  return `${kg.toFixed(3)} kg`
}

/**
 * Retorna el inicio del día en UTC para el timezone de presentación.
 * Útil para filtrar ventas del día.
 */
export function startOfDayUtc(dateStr?: string): string {
  const date = dateStr ? new Date(dateStr) : new Date()
  const localStr = date.toLocaleDateString('en-CA', { timeZone: _timezone })
  return new Date(`${localStr}T00:00:00.000Z`).toISOString()
}

/**
 * Retorna el fin del día en UTC para el timezone de presentación.
 */
export function endOfDayUtc(dateStr?: string): string {
  const date = dateStr ? new Date(dateStr) : new Date()
  const localStr = date.toLocaleDateString('en-CA', { timeZone: _timezone })
  return new Date(`${localStr}T23:59:59.999Z`).toISOString()
}
