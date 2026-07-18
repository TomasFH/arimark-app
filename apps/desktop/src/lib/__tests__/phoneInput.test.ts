import { describe, expect, it } from 'vitest'
import { parsePhoneNumber, formatPhoneInput, digitsOnly } from '../phoneInput'

describe('digitsOnly', () => {
  it('remueve todo excepto dígitos', () => {
    expect(digitsOnly('+54 11 4567-8901')).toBe('541145678901')
    expect(digitsOnly('11 4567-8901')).toBe('1145678901')
    expect(digitsOnly('abc123')).toBe('123')
  })
})

describe('parsePhoneNumber', () => {
  it('devuelve 10 dígitos para número CABA sin prefijo', () => {
    expect(parsePhoneNumber('1145678901')).toBe('1145678901')
  })

  it('remueve prefijo 0 inicial de discado', () => {
    expect(parsePhoneNumber('01145678901')).toBe('1145678901')
  })

  it('remueve +54 pegado (12 dígitos, empieza en 54 seguido de área 1/2/3)', () => {
    expect(parsePhoneNumber('+5411 4567-8901')).toBe('1145678901')
    expect(parsePhoneNumber('541145678901')).toBe('1145678901')
  })

  it('NO remueve 54 inicial si el resultado no encaja en el patrón +54', () => {
    // 11 dígitos empezando en 54 → no hay patrón claro, se deja como está
    // (11 dígitos ≠ 10 → parsePhoneNumber devuelve null)
    expect(parsePhoneNumber('54567890123')).toBeNull()
  })

  it('devuelve null si el número limpio no llega a 10 dígitos', () => {
    expect(parsePhoneNumber('1145678')).toBeNull()
    expect(parsePhoneNumber('abc')).toBeNull()
    expect(parsePhoneNumber('')).toBeNull()
  })

  it('maneja número de interior de 3 dígitos de área', () => {
    expect(parsePhoneNumber('3415001234')).toBe('3415001234')
  })

  it('maneja número de interior de 4 dígitos de área', () => {
    expect(parsePhoneNumber('2944201234')).toBe('2944201234')
  })

  it('NO interpreta 54 al inicio como prefijo cuando el número no encaja', () => {
    // Un número que genuinamente empiece con 54 y tenga 10 dígitos
    expect(parsePhoneNumber('5412345678')).toBe('5412345678')
  })
})

describe('formatPhoneInput', () => {
  it('deja el texto libre mientras el número es incompleto', () => {
    expect(formatPhoneInput('114')).toBe('114')
    expect(formatPhoneInput('11456')).toBe('11456')
  })

  it('formatea CABA (11) como "11 XXXX-XXXX"', () => {
    expect(formatPhoneInput('1145678901')).toBe('11 4567-8901')
  })

  it('formatea +54 pegado (12 dígitos) correctamente', () => {
    expect(formatPhoneInput('+54 11 4567-8901')).toBe('11 4567-8901')
    expect(formatPhoneInput('541145678901')).toBe('11 4567-8901')
  })

  it('formatea con 0 inicial de discado', () => {
    expect(formatPhoneInput('01145678901')).toBe('11 4567-8901')
  })

  it('formatea área de 3 dígitos como "XXX XXX-XXXX"', () => {
    // 341 (Rosario) — 4to dígito es 5 → área 3
    expect(formatPhoneInput('3415001234')).toBe('341 500-1234')
  })

  it('formatea área de 4 dígitos como "XXXX XX-XXXX"', () => {
    // 2944 (Bariloche) — 4to dígito es 4 → área 4
    expect(formatPhoneInput('2944201234')).toBe('2944 20-1234')
  })

  it('respeta números que genuinamente empiezan en 54 (10 dígitos)', () => {
    // No debe eliminar el 54. El formato exacto depende de la heurística de área,
    // pero lo importante es que los 10 dígitos originales se conserven intactos.
    const result = formatPhoneInput('5412345678')
    expect(result.replace(/\D/g, '')).toBe('5412345678')
  })

  it('acepta número ya formateado sin romper la idempotencia', () => {
    expect(formatPhoneInput('11 4567-8901')).toBe('11 4567-8901')
  })
})
