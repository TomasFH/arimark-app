/**
 * Tests de la lógica de búsqueda del catálogo.
 */
import { describe, it, expect } from 'vitest'
import { findByPlu, searchCatalog } from '../lib/catalog'
import type { CatalogProduct } from '../types/pos'

const catalog: CatalogProduct[] = [
  { productId: 'p1', pluNumber: 5, name: 'Vacío', category: 'beef_cut', unit: 'kg', price: 21000 },
  { productId: 'p2', pluNumber: 250, name: 'Huevos x30', category: 'other', unit: 'unit', price: 6000 },
  { productId: 'p3', pluNumber: 10, name: 'Asado', category: 'beef_cut', unit: 'kg', price: 18000 },
]

describe('catalog - findByPlu', () => {
  it('encuentra un producto por PLU', () => {
    expect(findByPlu(catalog, 5)?.name).toBe('Vacío')
  })

  it('retorna undefined si el PLU no existe', () => {
    expect(findByPlu(catalog, 999)).toBeUndefined()
  })
})

describe('catalog - searchCatalog', () => {
  it('busca por nombre exacto', () => {
    const results = searchCatalog(catalog, 'Vacío')
    expect(results).toHaveLength(1)
    expect(results[0]?.pluNumber).toBe(5)
  })

  it('busca por nombre sin tilde', () => {
    const results = searchCatalog(catalog, 'vacio')
    expect(results).toHaveLength(1)
    expect(results[0]?.name).toBe('Vacío')
  })

  it('busca insensible a mayúsculas', () => {
    const results = searchCatalog(catalog, 'ASADO')
    expect(results).toHaveLength(1)
  })

  it('busca por PLU como string', () => {
    const results = searchCatalog(catalog, '25')
    expect(results).toHaveLength(1)
    expect(results[0]?.pluNumber).toBe(250)
  })

  it('retorna múltiples resultados parciales', () => {
    const results = searchCatalog(catalog, 'a')
    expect(results.length).toBeGreaterThan(1)
  })
})
