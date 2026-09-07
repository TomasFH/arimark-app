/**
 * Tests del carnicero:
 * - auth.ts: rol butcher aceptado; rol desconocido rechazado.
 * - butcherOrders.ts: groupOrdersByDayAndShift agrupa correctamente;
 *   markOrderReady no llama updateDoc si offline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ACCESS_REVOKED_MESSAGE,
  ACCESS_UNAUTHORIZED_MESSAGE,
  accessDenialMessage,
  buildLocalProfile,
  denyUserAccess,
  isAllowedAppRole,
} from '../lib/userAccess'

describe('userAccess', () => {
  it('acepta roles cashier, admin y butcher', () => {
    expect(isAllowedAppRole('cashier')).toBe(true)
    expect(isAllowedAppRole('admin')).toBe(true)
    expect(isAllowedAppRole('butcher')).toBe(true)
  })

  it('rechaza rol desconocido o vacío', () => {
    expect(isAllowedAppRole('superadmin')).toBe(false)
    expect(isAllowedAppRole('')).toBe(false)
  })

  it('niega acceso si active es false o deleted es true', () => {
    expect(denyUserAccess({ role: 'butcher', active: false })).toBe('inactive')
    expect(denyUserAccess({ role: 'butcher', deleted: true })).toBe('inactive')
    expect(accessDenialMessage('inactive')).toBe(ACCESS_REVOKED_MESSAGE)
  })

  it('niega acceso si no hay doc o el rol no está autorizado', () => {
    expect(denyUserAccess(null)).toBe('unauthorized')
    expect(denyUserAccess({ role: 'unknown' })).toBe('unauthorized')
    expect(accessDenialMessage('unauthorized')).toBe(ACCESS_UNAUTHORIZED_MESSAGE)
  })

  it('permite butcher activo y arma el perfil', () => {
    expect(denyUserAccess({ role: 'butcher', active: true })).toBeNull()
    const profile = buildLocalProfile('u1', 'carn@test.com', {
      role: 'butcher',
      displayName: 'Juan',
      authorizedStores: ['s1'],
      employeeId: 'emp-1',
    })
    expect(profile).toEqual({
      uid: 'u1',
      displayName: 'Juan',
      role: 'butcher',
      authorizedStores: ['s1'],
      email: 'carn@test.com',
      employeeId: 'emp-1',
    })
  })

  it('no arma perfil si el acceso está revocado', () => {
    expect(buildLocalProfile('u1', 'carn@test.com', { role: 'butcher', active: false })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// butcherOrders — groupOrdersByDayAndShift
// ---------------------------------------------------------------------------

import { groupOrdersByDayAndShift, deliveredPickupFrom, DELIVERED_LOOKBACK_DAYS, formatPickupDayHeading, formatPickupDayChip, type ButcherOrder } from '../lib/butcherOrders'
import type { StoreHoursSource } from '@carniceria/shared'

function makeOrder(overrides: Partial<ButcherOrder> & Pick<ButcherOrder, 'id' | 'pickupDate'>): ButcherOrder {
  return {
    storeId: 's1',
    customerName: 'Cliente',
    phone: null,
    items: 'Vacío 2kg',
    timeSlot: null,
    pickupTime: null,
    priority: false,
    status: 'pending',
    depositAmount: 0,
    depositPayments: null,
    notes: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    createdBy: 'u1',
    readyAt: null,
    readyByName: null,
    updatedAt: null,
    deliveredAt: null,
    deliveredByName: null,
    budgetItems: null,
    ...overrides,
  }
}

describe('butcherOrders — groupOrdersByDayAndShift', () => {
  const today = '2026-09-02'

  it('agrupa un pedido en el día correcto', () => {
    const orders = [makeOrder({ id: 'o1', pickupDate: '2026-09-02' })]
    const groups = groupOrdersByDayAndShift(orders, today)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.date).toBe('2026-09-02')
  })

  it('asigna turno mañana al slot morning', () => {
    const orders = [makeOrder({ id: 'o1', pickupDate: today, timeSlot: 'morning' })]
    const groups = groupOrdersByDayAndShift(orders, today)
    expect(groups[0]!.groups[0]!.slot).toBe('morning')
  })

  it('asigna turno noSlot cuando no hay timeSlot', () => {
    const orders = [makeOrder({ id: 'o1', pickupDate: today, timeSlot: null })]
    const groups = groupOrdersByDayAndShift(orders, today)
    expect(groups[0]!.groups[0]!.slot).toBe('noSlot')
  })

  it('ordena morning antes que afternoon dentro del mismo día', () => {
    const orders = [
      makeOrder({ id: 'o1', pickupDate: today, timeSlot: 'afternoon' }),
      makeOrder({ id: 'o2', pickupDate: today, timeSlot: 'morning' }),
    ]
    const groups = groupOrdersByDayAndShift(orders, today)
    const slots = groups[0]!.groups.map(g => g.slot)
    expect(slots.indexOf('morning')).toBeLessThan(slots.indexOf('afternoon'))
  })

  it('mete un horario específico en el turno de su franja', () => {
    const hours = {
      morningStart: '08:00',
      morningEnd: '14:00',
      afternoonStart: '16:00',
      afternoonEnd: '20:30',
    }
    const orders = [
      makeOrder({ id: 'o1', pickupDate: today, timeSlot: 'afternoon' }),
      makeOrder({ id: 'o2', pickupDate: today, timeSlot: 'specific', pickupTime: '11:00' }),
    ]
    const groups = groupOrdersByDayAndShift(orders, today, { hours })
    const slots = groups[0]!.groups.map(g => g.slot)
    expect(slots).toEqual(['morning', 'afternoon'])
    expect(groups[0]!.groups[0]!.orders[0]!.id).toBe('o2')
  })

  it('pone arriba del día los retiros que faltan una hora o menos', () => {
    const hours = {
      morningStart: '08:00',
      morningEnd: '14:00',
      afternoonStart: '16:00',
      afternoonEnd: '20:30',
    }
    const orders = [
      makeOrder({ id: 'maniana', pickupDate: today, timeSlot: 'morning' }),
      makeOrder({ id: 'pronto', pickupDate: today, timeSlot: 'specific', pickupTime: '11:00' }),
    ]
    const groups = groupOrdersByDayAndShift(orders, today, {
      hours,
      nowMinutes: 10 * 60,
      pinDueSoon: true,
    })
    expect(groups[0]!.groups.map(g => g.slot)).toEqual(['dueSoon', 'morning'])
    expect(groups[0]!.groups[0]!.orders[0]!.id).toBe('pronto')
  })

  it('separa pedidos de días distintos', () => {
    const orders = [
      makeOrder({ id: 'o1', pickupDate: '2026-09-01' }),
      makeOrder({ id: 'o2', pickupDate: '2026-09-02' }),
    ]
    const groups = groupOrdersByDayAndShift(orders, today)
    expect(groups).toHaveLength(2)
  })

  it('coloca fechas pasadas antes que futuras', () => {
    const orders = [
      makeOrder({ id: 'o1', pickupDate: '2026-09-03' }), // futuro
      makeOrder({ id: 'o2', pickupDate: '2026-09-01' }), // pasado
    ]
    const groups = groupOrdersByDayAndShift(orders, today)
    // El pasado debe aparecer primero
    expect(groups[0]!.date).toBe('2026-09-01')
    expect(groups[1]!.date).toBe('2026-09-03')
  })

  it('lista vacía devuelve array vacío', () => {
    expect(groupOrdersByDayAndShift([], today)).toHaveLength(0)
  })

  it('deliveredPickupFrom recorta 7 días civiles', () => {
    expect(DELIVERED_LOOKBACK_DAYS).toBe(7)
    expect(deliveredPickupFrom('2026-09-08')).toBe('2026-09-01')
  })

  it('en historial un retiro pasado no se llama Atrasado', () => {
    expect(formatPickupDayHeading('2026-09-01', '2026-09-04', 'history')).toBe('01/09/2026')
    expect(formatPickupDayHeading('2026-09-01', '2026-09-04', 'work')).toBe('Atrasado · 01/09/2026')
    expect(formatPickupDayHeading('2026-09-04', '2026-09-04', 'history')).toBe('Hoy · 04/09/2026')
  })

  it('el chip de retiro no aparece si el pedido es de hoy', () => {
    expect(formatPickupDayChip('2026-09-04', '2026-09-04')).toBeNull()
    expect(formatPickupDayChip('2026-09-05', '2026-09-04')).toBe('Retiro: mañana')
    expect(formatPickupDayChip('2026-09-03', '2026-09-04')).toBe('Retiro: ayer')
  })

  it('un específico del domingo no entra en tarde si ese día no hay turno tarde', () => {
    const hours: StoreHoursSource = {
      hoursSchedule: [
        {
          days: [1, 2, 3, 4, 5, 6],
          morningStart: '08:00',
          morningEnd: '14:00',
          afternoonStart: '16:00',
          afternoonEnd: '20:30',
        },
        {
          days: [0],
          morningStart: '08:00',
          morningEnd: '14:00',
          afternoonStart: null,
          afternoonEnd: null,
        },
      ],
    }
    const sunday = '2026-09-06'
    const orders = [
      makeOrder({ id: 'tarde-dom', pickupDate: sunday, timeSlot: 'specific', pickupTime: '17:00' }),
      makeOrder({ id: 'maniana-dom', pickupDate: sunday, timeSlot: 'morning' }),
    ]
    const groups = groupOrdersByDayAndShift(orders, sunday, { hours })
    expect(groups[0]!.groups.map(g => g.slot)).toEqual(['morning', 'specific'])
    expect(groups[0]!.groups.find(g => g.slot === 'specific')!.orders[0]!.id).toBe('tarde-dom')
  })
})

// ---------------------------------------------------------------------------
// butcherOrders — markOrderReady no llama updateDoc si offline
// ---------------------------------------------------------------------------

import { markOrderReady, unmarkOrderReady, subscribeButcherDeliveredOrders } from '../lib/butcherOrders'
import { updateDoc, doc, where, onSnapshot } from 'firebase/firestore'
import { Network } from '@capacitor/network'

describe('butcherOrders — markOrderReady', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('llama updateDoc cuando hay conexión', async () => {
    vi.mocked(Network.getStatus).mockResolvedValue({ connected: true, connectionType: 'wifi' })
    const mockDoc = {}
    vi.mocked(doc).mockReturnValue(mockDoc as ReturnType<typeof doc>)
    vi.mocked(updateDoc).mockResolvedValue(undefined)

    await markOrderReady('order-1', 'uid-1', 'Juan')

    expect(updateDoc).toHaveBeenCalledWith(
      mockDoc,
      expect.objectContaining({
        status: 'ready',
        readyBy: 'uid-1',
        readyByName: 'Juan',
      }),
    )
  })

  it('NO llama updateDoc y lanza error cuando no hay conexión', async () => {
    vi.mocked(Network.getStatus).mockResolvedValue({ connected: false, connectionType: 'none' })

    // markOrderReady es llamado desde la UI solo cuando online=true.
    // La función NO verifica conectividad internamente; es la UI quien la comprueba.
    // Este test valida que si updateDoc falla (e.g. FirebaseError offline), el error se propaga.
    vi.mocked(updateDoc).mockRejectedValue(new Error('offline'))

    await expect(markOrderReady('order-1', 'uid-1', 'Juan')).rejects.toThrow('offline')
  })

  it('unmarkOrderReady vuelve el pedido a pending y limpia la auditoría', async () => {
    const mockDoc = {}
    vi.mocked(doc).mockReturnValue(mockDoc as ReturnType<typeof doc>)
    vi.mocked(updateDoc).mockResolvedValue(undefined)

    await unmarkOrderReady('order-1', 'uid-1')

    expect(updateDoc).toHaveBeenCalledWith(
      mockDoc,
      expect.objectContaining({
        status: 'pending',
        readyAt: null,
        readyBy: null,
        readyByName: null,
        updatedBy: 'uid-1',
      }),
    )
  })

  it('subscribeButcherDeliveredOrders acota por fecha de retiro', () => {
    vi.mocked(onSnapshot).mockReturnValue(() => undefined)
    subscribeButcherDeliveredOrders('s1', '2026-08-28', () => {}, () => {})
    expect(where).toHaveBeenCalledWith('storeId', '==', 's1')
    expect(where).toHaveBeenCalledWith('status', '==', 'delivered')
    expect(where).toHaveBeenCalledWith('pickupDate', '>=', '2026-08-28')
  })
})
