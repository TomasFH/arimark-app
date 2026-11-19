/**
 * Ventas confirmadas de un día, cortadas por hora civil.
 * El promedio de varios días se hace hora por hora, y un día entra
 * solo si todos los turnos que existieron ese día traen las 24 horas.
 * El horario pico es la hora con más plata en ese promedio,
 * no el promedio de los relojes pico.
 */
import { civilYmd, DISPLAY_TIMEZONE } from './pickupHours'
import type { SoldDayBar } from './summaryMoney'

export interface SaleHourStamp {
  createdAt: string
  total: number
}

export interface SoldHourBucket {
  /** 0–23 en el huso del negocio. El índice es la hora. */
  hour: number
  amount: number
  saleCount: number
}

/** Un turno del día, para decidir si ese día entra al promedio. */
export interface ShiftDayHours {
  ymd: string
  /** Abierto: el día queda incompleto aunque el otro turno ya tenga horas. */
  open: boolean
  /** Null = sin dato. Veinticuatro ceros son un día real sin ventas. */
  hours: SoldHourBucket[] | null
}

export interface CompleteDayAverage {
  /** Vacío si ningún día entró. No son veinticuatro ceros. */
  average: SoldHourBucket[]
  countedDayCount: number
  /** Días que tuvieron turnos y quedaron afuera. No se promedian como cero. */
  incompleteDayCount: number
}

/**
 * La misma venta que el total vendido: estado confirmed y el total de la venta.
 * Una anulada no entra. La seña y la cobranza de un fiado tampoco: no son esta fila.
 * El fiado vendido en el turno sí entra, porque la venta está confirmada.
 */
export function confirmedSaleHourStamps(
  sales: Array<{ status: string; createdAt: string; total: number }>,
): SaleHourStamp[] {
  const stamps: SaleHourStamp[] = []
  for (const sale of sales) {
    if (sale.status !== 'confirmed') continue
    if (!Number.isFinite(sale.total)) continue
    stamps.push({ createdAt: sale.createdAt, total: sale.total })
  }
  return stamps
}

export function civilHour(at: Date, timeZone = DISPLAY_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const raw = Number(parts.find(part => part.type === 'hour')?.value ?? '0')
  if (!Number.isInteger(raw)) return 0
  if (raw === 24) return 0
  if (raw < 0 || raw > 23) return 0
  return raw
}

function emptyDay(): SoldHourBucket[] {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, amount: 0, saleCount: 0 }))
}

/** 24 baldes. Una venta de otro día no entra. Una hora sin ventas queda en cero. */
export function summarySoldByHour(
  sales: SaleHourStamp[],
  ymd: string,
  timeZone = DISPLAY_TIMEZONE,
): SoldHourBucket[] {
  const buckets = emptyDay()
  for (const sale of sales) {
    if (!Number.isFinite(sale.total)) continue
    const at = new Date(sale.createdAt)
    if (Number.isNaN(at.getTime())) continue
    if (civilYmd(at, timeZone) !== ymd) continue
    const bucket = buckets[civilHour(at, timeZone)]
    if (!bucket) continue
    bucket.amount += sale.total
    bucket.saleCount += 1
  }
  return buckets
}

/**
 * De la primera hora con ventas a la última, con los ceros del medio.
 * Esas horas quietas son parte del pico: no se recortan.
 */
export function soldHourChartBars(buckets: SoldHourBucket[]): SoldDayBar[] {
  let start = -1
  let end = -1
  for (const bucket of buckets) {
    if (bucket.saleCount <= 0) continue
    if (start < 0) start = bucket.hour
    end = bucket.hour
  }
  if (start < 0 || end < start) return []
  return buckets.slice(start, end + 1).map(bucket => ({
    ymd: `hour-${String(bucket.hour).padStart(2, '0')}`,
    label: `${bucket.hour}h`,
    amount: bucket.amount,
  }))
}

export function soldHoursAmount(buckets: SoldHourBucket[]): number {
  return buckets.reduce((acc, bucket) => acc + bucket.amount, 0)
}

function isSealedSoldHours(hours: SoldHourBucket[] | null): hours is SoldHourBucket[] {
  if (!hours || hours.length !== 24) return false
  return hours.every((bucket, index) =>
    bucket.hour === index
    && Number.isFinite(bucket.amount)
    && Number.isFinite(bucket.saleCount))
}

/** 24 montos para guardar en la ficha. Si el dato no está sellado, null. */
export function soldHourAmounts(buckets: SoldHourBucket[] | null | undefined): number[] | null {
  const sealed = buckets ?? null
  if (!isSealedSoldHours(sealed)) return null
  return sealed.map(bucket => bucket.amount)
}

/**
 * Lee los 24 montos. Null, otra cantidad o un número inválido es sin dato,
 * nunca un día en cero.
 */
export function soldHoursFromAmounts(
  amounts: readonly unknown[] | null | undefined,
): SoldHourBucket[] | null {
  if (!amounts || amounts.length !== 24) return null
  const buckets = emptyDay()
  for (let hour = 0; hour < 24; hour += 1) {
    const amount = amounts[hour]
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
    const bucket = buckets[hour]
    if (!bucket) return null
    bucket.amount = amount
    bucket.saleCount = amount > 0 ? 1 : 0
  }
  return buckets
}

export function soldHoursJson(buckets: SoldHourBucket[] | null | undefined): string | null {
  const amounts = soldHourAmounts(buckets)
  if (!amounts) return null
  return JSON.stringify(amounts)
}

/**
 * JSON de 24 montos para sellar la ficha.
 * Usa las mismas ventas confirmadas que el total vendido.
 * Sin ventas, son 24 ceros: eso es un dato.
 */
export function sealedSoldHoursJson(
  sales: Array<{ status: string; createdAt: string; total: number }>,
  startedAt: string,
): string {
  const at = new Date(startedAt)
  const ymd = Number.isNaN(at.getTime()) ? '' : civilYmd(at)
  return soldHoursJson(summarySoldByHour(confirmedSaleHourStamps(sales), ymd))
    ?? JSON.stringify(Array.from({ length: 24 }, () => 0))
}

export function parseSoldHoursJson(raw: string | null | undefined): SoldHourBucket[] | null {
  if (raw == null || raw.trim() === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return soldHoursFromAmounts(parsed)
  } catch {
    return null
  }
}

function sumHourDays(days: SoldHourBucket[][]): SoldHourBucket[] {
  const totals = emptyDay()
  for (const day of days) {
    for (const bucket of day) {
      const slot = totals[bucket.hour]
      if (!slot) continue
      slot.amount += bucket.amount
      slot.saleCount += bucket.saleCount
    }
  }
  return totals
}

/**
 * Promedio de semana o mes.
 * Un día entra si todos los turnos de esa lista tienen las 24 horas.
 * Un turno que no está en la lista no existió para esta cuenta
 * (la tarde del domingo, o un local que no se eligió).
 * Los días que no entran quedan afuera y no se suman como cero.
 */
export function averageCompleteShiftDays(shifts: ShiftDayHours[]): CompleteDayAverage {
  const byDay = new Map<string, ShiftDayHours[]>()
  for (const shift of shifts) {
    const list = byDay.get(shift.ymd) ?? []
    list.push(shift)
    byDay.set(shift.ymd, list)
  }

  const complete: SoldHourBucket[][] = []
  let incompleteDayCount = 0
  for (const dayShifts of byDay.values()) {
    const sealed: SoldHourBucket[][] = []
    let missing = false
    for (const shift of dayShifts) {
      if (shift.open || !isSealedSoldHours(shift.hours)) {
        missing = true
        break
      }
      sealed.push(shift.hours)
    }
    if (missing) {
      incompleteDayCount += 1
      continue
    }
    complete.push(sumHourDays(sealed))
  }

  if (complete.length === 0) {
    return { average: [], countedDayCount: 0, incompleteDayCount }
  }
  return {
    average: averageSoldHours(complete),
    countedDayCount: complete.length,
    incompleteDayCount,
  }
}

const OPEN_SHIFT_NOTICE = 'Disponible cuando se cierre el turno'

export interface SummaryHoursShift {
  id: string
  cashierName: string
  shiftType: 'morning' | 'evening'
  storeName?: string | null
  startedAt: string
  closedAt: string | null
  live: boolean
  soldHours?: SoldHourBucket[] | null
}

export interface SummaryHoursNotice {
  id: string
  text: string
}

export interface SummaryHoursView {
  /** Null = no hay horas selladas para graficar. No son veinticuatro ceros. */
  buckets: SoldHourBucket[] | null
  /** Un turno cerrado no trajo las 24 horas, o ningún día del promedio entró. */
  missing: boolean
  openNotices: SummaryHoursNotice[]
  incompleteDayCount: number
  countedDayCount: number
  peak: SoldHourBucket | null
}

function isOpenSummaryShift(shift: SummaryHoursShift): boolean {
  return shift.live || shift.closedAt == null
}

function openShiftNotice(shift: SummaryHoursShift, showStore: boolean): SummaryHoursNotice {
  const turn = shift.shiftType === 'morning' ? 'Mañana' : 'Tarde'
  const who = showStore && shift.storeName
    ? `${shift.storeName} · ${shift.cashierName}`
    : shift.cashierName
  return { id: shift.id, text: `${turn} · ${who}: ${OPEN_SHIFT_NOTICE}` }
}

/**
 * Hoy suma los turnos cerrados que ya traen las 24 horas.
 * Un turno abierto no entra al gráfico: el aviso lo nombra.
 * Semana o mes promedian solo los días completos.
 */
export function summaryHoursView(
  shifts: SummaryHoursShift[],
  mode: 'today' | 'average',
  showStore: boolean,
): SummaryHoursView {
  const openNotices = shifts.filter(isOpenSummaryShift).map(shift => openShiftNotice(shift, showStore))
  if (mode === 'average') {
    const averaged = averageCompleteShiftDays(shifts.map(shift => ({
      ymd: civilYmd(new Date(shift.startedAt)),
      open: isOpenSummaryShift(shift),
      hours: isOpenSummaryShift(shift) ? null : (shift.soldHours ?? null),
    })))
    const buckets = averaged.average.length === 24 ? averaged.average : null
    return {
      buckets,
      missing: averaged.countedDayCount === 0 && averaged.incompleteDayCount > 0,
      openNotices,
      incompleteDayCount: averaged.incompleteDayCount,
      countedDayCount: averaged.countedDayCount,
      peak: buckets ? peakSoldHour(buckets) : null,
    }
  }

  const closed = shifts.filter(shift => !isOpenSummaryShift(shift))
  const missing = closed.some(shift => !isSealedSoldHours(shift.soldHours ?? null))
  if (closed.length === 0 || missing) {
    return {
      buckets: null,
      missing,
      openNotices,
      incompleteDayCount: 0,
      countedDayCount: 0,
      peak: null,
    }
  }
  const sealed: SoldHourBucket[][] = []
  for (const shift of closed) {
    const hours = shift.soldHours ?? null
    if (isSealedSoldHours(hours)) sealed.push(hours)
  }
  const buckets = sumHourDays(sealed)
  return {
    buckets,
    missing: false,
    openNotices,
    incompleteDayCount: 0,
    countedDayCount: 1,
    peak: peakSoldHour(buckets),
  }
}

/** Hora con más plata. Si empatan, queda la más temprana. */
export function peakSoldHour(buckets: SoldHourBucket[]): SoldHourBucket | null {
  let best: SoldHourBucket | null = null
  for (const bucket of buckets) {
    if (bucket.saleCount <= 0 && bucket.amount <= 0) continue
    if (!best || bucket.amount > best.amount) best = bucket
  }
  return best
}

/**
 * Promedio de la misma hora a través de días.
 * Cada día tiene que traer las 24 horas, aunque estén en cero.
 */
export function averageSoldHours(days: SoldHourBucket[][]): SoldHourBucket[] {
  const totals = emptyDay()
  let counted = 0
  for (const day of days) {
    if (day.length !== 24) continue
    counted += 1
    for (const bucket of day) {
      const slot = totals[bucket.hour]
      if (!slot) continue
      slot.amount += bucket.amount
      slot.saleCount += bucket.saleCount
    }
  }
  if (counted === 0) return totals
  return totals.map(slot => ({
    hour: slot.hour,
    amount: slot.amount / counted,
    saleCount: slot.saleCount / counted,
  }))
}
