/**
 * Tests del módulo de PIN offline.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../lib/db'
import { savePin, verifyPin, hasPinConfigured, getPinUid } from '../lib/pin'

describe('PIN offline', () => {
  beforeEach(async () => {
    await db.pin.clear()
  })

  it('hasPinConfigured retorna false cuando no hay PIN', async () => {
    expect(await hasPinConfigured()).toBe(false)
  })

  it('guarda y verifica un PIN correcto', async () => {
    await savePin('uid-1', '1234')
    expect(await verifyPin('1234')).toBe(true)
  })

  it('rechaza un PIN incorrecto', async () => {
    await savePin('uid-1', '1234')
    expect(await verifyPin('9999')).toBe(false)
  })

  it('hasPinConfigured retorna true después de guardar', async () => {
    await savePin('uid-1', '5678')
    expect(await hasPinConfigured()).toBe(true)
  })

  it('getPinUid retorna el uid correcto', async () => {
    await savePin('uid-abc', '1234')
    expect(await getPinUid()).toBe('uid-abc')
  })

  it('sobreescribe el PIN al llamar savePin de nuevo', async () => {
    await savePin('uid-1', '1111')
    await savePin('uid-1', '2222')
    expect(await verifyPin('1111')).toBe(false)
    expect(await verifyPin('2222')).toBe(true)
  })
})
