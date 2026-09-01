import { describe, it, expect } from 'vitest'
import { isOnHomeRoster, isVisibleForAttendance, visitorCandidates, isVisibleForVales, valeVisitorCandidates, namesMatch } from '../homeRoster'

const visitors = (...ids: string[]) => new Set(ids)

describe('isOnHomeRoster', () => {
  it('incluye sin asignar y al habitual de este local', () => {
    expect(isOnHomeRoster({
      personId: 'a', homeStoreId: null, currentStoreId: 's1', visitorIds: visitors(),
    })).toBe(true)
    expect(isOnHomeRoster({
      personId: 'a', homeStoreId: 's1', currentStoreId: 's1', visitorIds: visitors(),
    })).toBe(true)
  })

  it('oculta al de otro local salvo visitante', () => {
    expect(isOnHomeRoster({
      personId: 'a', homeStoreId: 's2', currentStoreId: 's1', visitorIds: visitors(),
    })).toBe(false)
    expect(isOnHomeRoster({
      personId: 'a', homeStoreId: 's2', currentStoreId: 's1', visitorIds: visitors('a'),
    })).toBe(true)
  })
})

describe('isVisibleForAttendance', () => {
  it('oculta si ya marcó hoy en otro local', () => {
    expect(isVisibleForAttendance({
      personId: 'a',
      homeStoreId: 's1',
      currentStoreId: 's1',
      visitorIds: visitors(),
      todayMark: { employeeId: 'a', storeId: 's2' },
    })).toBe(false)
  })

  it('muestra si ya marcó hoy en este local aunque el habitual sea otro', () => {
    expect(isVisibleForAttendance({
      personId: 'a',
      homeStoreId: 's2',
      currentStoreId: 's1',
      visitorIds: visitors(),
      todayMark: { employeeId: 'a', storeId: 's1' },
    })).toBe(true)
  })

  it('fila vieja sin storeId sigue el filtro de habitual', () => {
    expect(isVisibleForAttendance({
      personId: 'a',
      homeStoreId: 's2',
      currentStoreId: 's1',
      visitorIds: visitors(),
      todayMark: { employeeId: 'a', storeId: null },
    })).toBe(false)
  })
})

describe('visitorCandidates', () => {
  const people = [
    { id: 'home', name: 'De acá', homeStoreId: 's1' },
    { id: 'both', name: 'Ambos', homeStoreId: null },
    { id: 'other', name: 'Del otro', homeStoreId: 's2' },
    { id: 'marked', name: 'Ya marcado', homeStoreId: 's2' },
  ]

  it('solo ofrece habitual de otro local, no visitantes ya sumados', () => {
    const list = visitorCandidates({
      people,
      currentStoreId: 's1',
      visitorIds: visitors(),
    })
    expect(list.map(p => p.id).sort()).toEqual(['marked', 'other'])
  })

  it('en asistencia oculta a quien ya marcó hoy', () => {
    const list = visitorCandidates({
      people,
      currentStoreId: 's1',
      visitorIds: visitors(),
      todayMarks: [{ employeeId: 'marked', storeId: 's2' }],
      hideIfMarkedToday: true,
    })
    expect(list.map(p => p.id)).toEqual(['other'])
  })
})

describe('isVisibleForVales / valeVisitorCandidates', () => {
  const people: Array<{ id: string; name: string; homeStoreId: string | null; kind?: string }> = [
    { id: 'butcher', name: 'Pedro', homeStoreId: 's1', kind: 'butcher' },
    { id: 'me', name: 'Ana Pérez', homeStoreId: 's1', kind: 'cashier' },
    { id: 'other-c', name: 'Lucía', homeStoreId: 's1', kind: 'cashier' },
    { id: 'visit', name: 'Marta', homeStoreId: 's2', kind: 'cashier' },
    { id: 'visit-b', name: 'Carlos', homeStoreId: 's2', kind: 'butcher' },
  ]

  it('cajera ve carniceros del local y solo su propia ficha', () => {
    const vis = (p: typeof people[number]) => isVisibleForVales({
      personId: p.id,
      personName: p.name,
      personKind: p.kind,
      homeStoreId: p.homeStoreId,
      currentStoreId: 's1',
      visitorIds: visitors(),
      viewerRole: 'cashier',
      viewerName: 'ana pérez',
    })
    expect(vis(people[0]!)).toBe(true)
    expect(vis(people[1]!)).toBe(true)
    expect(vis(people[2]!)).toBe(false)
    expect(vis(people[3]!)).toBe(false)
  })

  it('admin en POS no ve cajeras, sí carniceros', () => {
    const vis = (p: typeof people[number]) => isVisibleForVales({
      personId: p.id,
      personName: p.name,
      personKind: p.kind,
      homeStoreId: p.homeStoreId,
      currentStoreId: 's1',
      visitorIds: visitors(),
      viewerRole: 'admin',
      viewerName: 'Dueña',
    })
    expect(vis(people[0]!)).toBe(true)
    expect(vis(people[1]!)).toBe(false)
    expect(vis(people[2]!)).toBe(false)
  })

  it('visitantes de vales: cajera no suma a otras cajeras; admin solo carniceros', () => {
    const asCashier = valeVisitorCandidates({
      people,
      currentStoreId: 's1',
      visitorIds: visitors(),
      viewerRole: 'cashier',
      viewerName: 'Ana Pérez',
    })
    expect(asCashier.map(p => p.id).sort()).toEqual(['visit-b'])

    const asAdmin = valeVisitorCandidates({
      people,
      currentStoreId: 's1',
      visitorIds: visitors(),
      viewerRole: 'admin',
      viewerName: 'Dueña',
    })
    expect(asAdmin.map(p => p.id)).toEqual(['visit-b'])
  })

  it('cajera ve su ficha aunque esté dada de baja; las demás bajas no', () => {
    expect(isVisibleForVales({
      personId: 'me',
      personName: 'Cajera Prueba',
      personKind: 'cashier',
      homeStoreId: 'san-martin',
      currentStoreId: 'san-martin',
      visitorIds: visitors(),
      viewerRole: 'cashier',
      viewerName: 'Cajera Prueba',
      personActive: false,
    })).toBe(true)
    expect(isVisibleForVales({
      personId: 'b',
      personName: 'Pedro',
      personKind: 'butcher',
      homeStoreId: 'san-martin',
      currentStoreId: 'san-martin',
      visitorIds: visitors(),
      viewerRole: 'cashier',
      viewerName: 'Cajera Prueba',
      personActive: false,
    })).toBe(false)
  })

  it('cajera ve su ficha en cualquier local, sin importar el habitual', () => {
    const vis = (homeStoreId: string | null) => isVisibleForVales({
      personId: 'me',
      personName: 'Cajera Prueba',
      personKind: 'cashier',
      homeStoreId,
      currentStoreId: 'san-martin',
      visitorIds: visitors(),
      viewerRole: 'cashier',
      viewerName: 'cajera prueba',
    })
    expect(vis(null)).toBe(true)
    expect(vis('san-martin')).toBe(true)
    expect(vis('camarones')).toBe(true)
  })

  it('cajera no ve a otra cajera aunque el habitual sea este local', () => {
    expect(isVisibleForVales({
      personId: 'other',
      personName: 'Otra Cajera',
      personKind: 'cashier',
      homeStoreId: 'san-martin',
      currentStoreId: 'san-martin',
      visitorIds: visitors(),
      viewerRole: 'cashier',
      viewerName: 'Cajera Prueba',
    })).toBe(false)
  })

  it('la propia ficha no aparece como visitante (ya está en la lista)', () => {
    const people = [
      { id: 'me', name: 'Cajera Prueba', homeStoreId: 's2', kind: 'cashier' },
      { id: 'visit-b', name: 'Carlos', homeStoreId: 's2', kind: 'butcher' },
    ]
    const list = valeVisitorCandidates({
      people,
      currentStoreId: 's1',
      visitorIds: visitors(),
      viewerRole: 'cashier',
      viewerName: 'Cajera Prueba',
    })
    expect(list.map(p => p.id)).toEqual(['visit-b'])
  })

  it('cajera ve su ficha aunque el nombre de sesión esté vacío si hay alias', () => {
    expect(isVisibleForVales({
      personId: 'me',
      personName: 'Cajera Prueba',
      personKind: 'cashier',
      homeStoreId: 'camarones',
      currentStoreId: 'san-martin',
      visitorIds: visitors(),
      viewerRole: 'cashier',
      viewerName: '',
      viewerNames: ['Cajera Prueba'],
    })).toBe(true)
  })

  it('namesMatch ignora acentos, mayúsculas y espacios de más', () => {
    expect(namesMatch('Cajera  Prueba', 'cajera prueba')).toBe(true)
    expect(namesMatch('Ana Pérez', 'ana perez')).toBe(true)
    expect(namesMatch('', 'Ana')).toBe(false)
  })
})
