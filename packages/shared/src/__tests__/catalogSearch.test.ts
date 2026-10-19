import { describe, it, expect } from 'vitest'
import { filterAndRankByName, matchVisitMerchProducts, searchProductsByQuery } from '../catalogSearch'

const cuts = [
  { id: '1', name: 'Tapa de asado', plu: 3 },
  { id: '2', name: 'Asado de tira', plu: 4 },
  { id: '3', name: 'Matambre', plu: 1 },
  { id: '4', name: 'Asado', plu: 20 },
  { id: '5', name: 'Asado corto', plu: 5 },
  { id: '6', name: 'Falda de asado', plu: 6 },
  { id: '7', name: 'Asado con hueso', plu: 7 },
  { id: '8', name: 'Vacío', plu: 8 },
  { id: '9', name: 'Asado especial', plu: 9 },
  { id: '10', name: 'Asado al horno', plu: 10 },
  { id: '11', name: 'Punta de asado', plu: 11 },
]

describe('filterAndRankByName', () => {
  it('pone el nombre exacto primero aunque haya muchos que contienen la palabra', () => {
    const ranked = filterAndRankByName(cuts, 'Asado', c => c.name)
    expect(ranked[0]?.name).toBe('Asado')
    expect(ranked.map(c => c.name)).toContain('Tapa de asado')
    expect(ranked.map(c => c.name)).not.toContain('Vacío')
  })

  it('ignora tildes y mayúsculas', () => {
    const ranked = filterAndRankByName(
      [{ name: 'Vacío' }, { name: 'Asado' }],
      'vacio',
      c => c.name,
    )
    expect(ranked.map(c => c.name)).toEqual(['Vacío'])
  })
})

describe('searchProductsByQuery', () => {
  const opts = { nameOf: (c: (typeof cuts)[number]) => c.name, pluOf: (c: (typeof cuts)[number]) => c.plu }

  it('con dígitos busca PLU, no recorta a 8', () => {
    const list = Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `P${i}`, plu: 100 + i }))
    const found = searchProductsByQuery(list, '10', { nameOf: p => p.name, pluOf: p => p.plu })
    expect(found.length).toBeGreaterThan(8)
    expect(found[0]?.plu).toBe(100)
  })

  it('con texto no pierde el producto cuyo nombre es exactamente la query', () => {
    const found = searchProductsByQuery(cuts, 'asado', opts)
    expect(found[0]?.name).toBe('Asado')
    expect(found.length).toBeGreaterThan(8)
  })
})

describe('matchVisitMerchProducts', () => {
  const products = [
    { name: 'Jamón', pluNumber: 12 },
    { name: 'Vacío', pluNumber: 8 },
    { name: 'Asado', pluNumber: 101 },
  ]

  it('encuentra Jamón con jamon, JAMON y jam', () => {
    for (const query of ['jamon', 'JAMON', 'jam']) {
      expect(matchVisitMerchProducts(products, query).map(p => p.name)).toEqual(['Jamón'])
    }
  })

  it('el PLU sigue siendo substring de dígitos y no reordena', () => {
    expect(matchVisitMerchProducts(products, '01').map(p => p.name)).toEqual(['Asado'])
    expect(matchVisitMerchProducts(products, '12').map(p => p.name)).toEqual(['Jamón'])
    expect(matchVisitMerchProducts(
      [{ name: 'Jamón crudo', pluNumber: 1 }, { name: 'Jamón', pluNumber: 2 }],
      'jamon',
    ).map(p => p.name)).toEqual(['Jamón crudo', 'Jamón'])
  })

  it('sin texto devuelve los primeros 8 y con muchas coincidencias recorta a 8', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `Jamón ${i}`, pluNumber: 200 + i }))
    expect(matchVisitMerchProducts(many, '').map(p => p.pluNumber)).toEqual([200, 201, 202, 203, 204, 205, 206, 207])
    expect(matchVisitMerchProducts(many, '   ')).toHaveLength(8)
    expect(matchVisitMerchProducts(many, 'jamon')).toHaveLength(8)
    expect(matchVisitMerchProducts(products, 'pollo')).toEqual([])
  })
})
