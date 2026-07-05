import { describe, it, expect, beforeEach } from 'vitest'
import {
  nowUtc,
  toLocalDateTime,
  toLocalDate,
  toLocalTime,
  formatARS,
  formatKg,
  setDisplayTimezone,
  startOfDayUtc,
  endOfDayUtc,
} from '../datetime'

const TZ = 'America/Argentina/Buenos_Aires'

beforeEach(() => {
  setDisplayTimezone(TZ)
})

describe('nowUtc', () => {
  it('retorna un string ISO 8601 con Z', () => {
    const result = nowUtc()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('puede parsearse como Date válida', () => {
    const result = nowUtc()
    expect(new Date(result).getTime()).not.toBeNaN()
  })
})

describe('toLocalDate', () => {
  it('convierte un timestamp UTC a fecha local', () => {
    const utc = '2026-01-15T12:00:00.000Z'
    const result = toLocalDate(utc)
    expect(result).toContain('15')
    expect(result).toContain('2026')
  })
})

describe('toLocalTime', () => {
  it('retorna una hora que contiene HH:MM', () => {
    const utc = '2026-01-15T15:00:00.000Z'
    const result = toLocalTime(utc)
    expect(result).toMatch(/\d{1,2}:\d{2}/)
  })
})

describe('toLocalDateTime', () => {
  it('retorna fecha y hora combinados', () => {
    const utc = '2026-01-15T12:00:00.000Z'
    const result = toLocalDateTime(utc)
    expect(result.length).toBeGreaterThan(5)
  })
})

describe('formatARS', () => {
  it('formatea montos en pesos', () => {
    const result = formatARS(15000)
    expect(result).toContain('15')
    expect(result).toMatch(/\$|ARS|peso/i)
  })

  it('no muestra decimales para montos enteros', () => {
    const result = formatARS(1000)
    expect(result).not.toContain(',00')
  })
})

describe('formatKg', () => {
  it('muestra 3 decimales', () => {
    expect(formatKg(1.5)).toBe('1.500 kg')
    expect(formatKg(0.234)).toBe('0.234 kg')
  })
})

describe('startOfDayUtc / endOfDayUtc', () => {
  it('start es menor que end', () => {
    const start = new Date(startOfDayUtc()).getTime()
    const end = new Date(endOfDayUtc()).getTime()
    expect(start).toBeLessThan(end)
  })

  it('la diferencia es de ~24h', () => {
    const start = new Date(startOfDayUtc()).getTime()
    const end = new Date(endOfDayUtc()).getTime()
    const diff = end - start
    const expected = 24 * 60 * 60 * 1000 - 1
    expect(Math.abs(diff - expected)).toBeLessThan(2000)
  })
})
