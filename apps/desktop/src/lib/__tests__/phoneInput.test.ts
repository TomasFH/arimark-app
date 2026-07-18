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

  it('remueve prefijo +54', () => {
    expect(parsePhoneNumber('+5411 4567-8901')).toBe('1145678901')
  })

  it('remueve prefijo 54', () => {
    expect(parsePhoneNumber('541145678901')).toBe('1145678901')
  })

  it('remueve 0 inicial de discado', () => {
    expect(parsePhoneNumber('01145678901')).toBe('1145678901')
  })

  it('devuelve null si el número limpio no llega a 10 dígitos', () => {
    expect(parsePhoneNumber('1145678')).toBeNull()
    expect(parsePhoneNumber('abc')).toBeNull()
    expect(parsePhoneNumber('')).toBeNull()
  })

  it('devuelve null si tiene más de 10 dígitos tras la limpieza', () => {
    // 12 dígitos limpios sin prefijo reconocible → null
    expect(parsePhoneNumber('123456789012')).toBeNull()
  })

  it('maneja número de interior de 3 dígitos de área', () => {
    expect(parsePhoneNumber('3415001234')).toBe('3415001234')
  })

  it('maneja número de interior de 4 dígitos de área', () => {
    expect(parsePhoneNumber('2944201234')).toBe('2944201234')
  })
})

describe('formatPhoneInput', () => {
  it('deja el texto libre mientras el número es incompleto', () => {
    expect(formatPhoneInput('114')).toBe('114')
    expect(formatPhoneInput('11456')).toBe('11456')
  })

  it('formatea CABA (11) como "11 XXXX-XXXX"', () => {
    expect(formatPhoneInput('1145678901')).toBe('11 4567-8901')
    expect(formatPhoneInput('+54 11 4567-8901')).toBe('11 4567-8901')
  })

  it('formatea área de 3 dígitos como "XXX XXX-XXXX"', () => {
    // 341 (Rosario) — 4to dígito es 5 → área 3
    expect(formatPhoneInput('3415001234')).toBe('341 500-1234')
  })

  it('formatea área de 4 dígitos como "XXXX XX-XXXX"', () => {
    // 2944 (Bariloche) — 4to dígito es 4 → área 4
    expect(formatPhoneInput('2944201234')).toBe('2944 20-1234')
  })

  it('no fuerza formato sobre texto con más de 10 dígitos sin prefijo reconocible', () => {
    // 11 dígitos sin prefijo reconocible → devuelve los primeros 10 formateados
    expect(formatPhoneInput('11456789012')).toBe('11 4567-8901')
  })

  it('acepta número ya formateado sin romper la idempotencia', () => {
    // volver a formatear un valor ya formateado no debe cambiarlo
    expect(formatPhoneInput('11 4567-8901')).toBe('11 4567-8901')
  })
})
