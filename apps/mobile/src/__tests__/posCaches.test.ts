import { describe, it, expect } from 'vitest'
import { parseEmployeeDoc, parseProviderDoc, parseValeDoc, filterProviders } from '../lib/posCaches'

describe('posCaches parsers', () => {
  it('parsea proveedor y omite deleted', () => {
    expect(parseProviderDoc('id1', { name: 'Oso' })?.intakeKind).toBeNull()
    expect(parseProviderDoc('id1', { name: 'Oso', intakeKind: 'media_res' })?.intakeKind).toBe('media_res')
    expect(parseProviderDoc('id1', { name: 'Maxilimp', intakeKind: 'insumos' })?.intakeKind).toBe('insumos')
    expect(parseProviderDoc('id1', { name: 'Oso', deleted: true })).toBeNull()
    expect(parseProviderDoc('id1', { name: '  ' })).toBeNull()
  })

  it('parsea empleado inactivo como archivado', () => {
    const active = parseEmployeeDoc('e1', { name: 'Juan', weeklyWage: 1000, active: true, homeStoreId: 's1' })
    expect(active?.archivedAt).toBeNull()
    expect(active?.weeklyWage).toBe(1000)
    expect(active?.homeStoreId).toBe('s1')
    const inactive = parseEmployeeDoc('e1', { name: 'Juan', active: false })
    expect(inactive?.archivedAt).toBeTruthy()
    expect(parseEmployeeDoc('e1', { name: 'Juan', deleted: true })).toBeNull()
  })

  it('parsea vale y omite anulados', () => {
    const vale = parseValeDoc('v1', {
      employeeId: 'e1',
      amount: 500,
      paidAt: '2026-08-28T10:00:00.000Z',
    })
    expect(vale?.syncStatus).toBe('synced')
    expect(parseValeDoc('v1', { employeeId: 'e1', amount: 500, cancelledAt: 'x' })).toBeNull()
  })

  it('filterProviders es case-insensitive', () => {
    const list = [
      { id: '1', name: 'Oso', archivedAt: null, updatedAt: '', intakeKind: null },
      { id: '2', name: 'La Estancia', archivedAt: null, updatedAt: '', intakeKind: 'catalog' as const },
    ]
    expect(filterProviders(list, 'oso')).toHaveLength(1)
    expect(filterProviders(list, '')).toHaveLength(2)
  })

  it('filterProviders ignora tildes: carbon encuentra Carbón', () => {
    const list = [
      { id: '1', name: 'Carbón', archivedAt: null, updatedAt: '', intakeKind: null },
      { id: '2', name: 'Oso', archivedAt: null, updatedAt: '', intakeKind: null },
    ]
    expect(filterProviders(list, 'carbon').map(p => p.name)).toEqual(['Carbón'])
    expect(filterProviders(list, 'CARBON').map(p => p.name)).toEqual(['Carbón'])
  })
})
