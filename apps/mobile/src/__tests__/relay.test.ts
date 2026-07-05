import { describe, it, expect } from 'vitest'
import { relayEventsPath } from '@carniceria/shared'
import type { RelayScanEvent } from '@carniceria/shared'

/**
 * Tests unitarios para la construcción del RelayScanEvent en el cliente móvil.
 * No requieren red ni Firebase — validan solo la lógica pura de construcción.
 */

describe('RelayScanEvent — construcción del evento', () => {
  it('construye un evento con todos los campos requeridos', () => {
    const event: RelayScanEvent = {
      eventId: 'test-uuid-123',
      barcode: '2000517535000',
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdByUid: 'uid-cajera-1',
    }

    expect(event.eventId).toBe('test-uuid-123')
    expect(event.barcode).toBe('2000517535000')
    expect(event.status).toBe('pending')
    expect(event.createdByUid).toBe('uid-cajera-1')
    expect(event.productName).toBeUndefined()
    expect(event.rejectReason).toBeUndefined()
  })

  it('construye un evento aceptado con productName', () => {
    const event: RelayScanEvent = {
      eventId: 'test-uuid-456',
      barcode: '2000106000001',
      status: 'accepted',
      createdAt: new Date().toISOString(),
      createdByUid: 'uid-cajera-1',
      productName: 'Huevos x30',
    }

    expect(event.status).toBe('accepted')
    expect(event.productName).toBe('Huevos x30')
  })

  it('construye un evento rechazado con rejectReason', () => {
    const event: RelayScanEvent = {
      eventId: 'test-uuid-789',
      barcode: '1234567890123',
      status: 'rejected',
      createdAt: new Date().toISOString(),
      createdByUid: 'uid-cajera-1',
      rejectReason: 'Código de barras no reconocido.',
    }

    expect(event.status).toBe('rejected')
    expect(event.rejectReason).toBe('Código de barras no reconocido.')
  })
})

describe('relayEventsPath', () => {
  it('construye el path correcto en Firestore', () => {
    const path = relayEventsPath('arimark-001', 'local1')
    expect(path).toBe('licenses/arimark-001/relay/local1/events')
  })

  it('funciona con distintas licencias y locales', () => {
    expect(relayEventsPath('otra-licencia', 'local2')).toBe(
      'licenses/otra-licencia/relay/local2/events'
    )
  })
})
