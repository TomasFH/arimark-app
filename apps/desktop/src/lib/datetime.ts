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
 * Fecha de hoy en el timezone de presentación, formato YYYY-MM-DD (ISO date).
 * Usar para claves de asistencia y filtros por día local.
 */
export function todayLocalYmd(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: _timezone })
}

/**
 * Día civil YYYY-MM-DD de un instante UTC, en el timezone de presentación.
 */
export function utcToLocalYmd(utcString: string): string {
  if (!utcString) return ''
  return new Date(utcString).toLocaleDateString('en-CA', { timeZone: _timezone })
}

/**
 * Convierte una fecha de calendario YYYY-MM-DD a dd/mm/aaaa.
 * No usa timezone: es un día civil, no un instante.
 */
export function formatYmd(yyyyMmDd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd)
  if (!m) return yyyyMmDd
  return `${m[3]}/${m[2]}/${m[1]}`
}

/**
 * Suma (o resta) días a una fecha YYYY-MM-DD de calendario (sin timezone).
 */
export function addDaysYmd(yyyyMmDd: string, days: number): string {
  const d = new Date(`${yyyyMmDd}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Lunes de la semana que contiene `fromYmd` (o hoy local), formato YYYY-MM-DD.
 * Semana laboral lun–dom (como `week_start` de salarios/vales).
 */
export function weekStartMondayLocalYmd(fromYmd?: string): string {
  const ymd = fromYmd ?? todayLocalYmd()
  const d = new Date(`${ymd}T12:00:00.000Z`)
  const day = d.getUTCDay() // 0=dom … 6=sáb
  const mondayOffset = day === 0 ? -6 : 1 - day
  return addDaysYmd(ymd, mondayOffset)
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

/**
 * Formato relativo simple para fechas de vencimiento.
 * Ej: "hoy", "mañana", "en 3 días", "hace 2 días".
 */
export function formatRelativeDate(dateStr: string): string {
  const now = new Date()
  const target = new Date(dateStr)
  // Normalizar a día local
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const diffMs = targetDay.getTime() - nowDay.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'hoy'
  if (diffDays === 1) return 'mañana'
  if (diffDays === -1) return 'ayer'
  if (diffDays > 0) return `en ${diffDays} días`
  return `hace ${Math.abs(diffDays)} días`
}
