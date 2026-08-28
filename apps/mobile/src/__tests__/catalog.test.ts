/**
 * Tests de la lógica de búsqueda del catálogo.
 */
import { describe, it, expect } from 'vitest'
import { findByPlu, searchCatalog, mergeCatalogProducts, catalogTypeaheadMatches } from '../lib/catalog'
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

describe('mergeCatalogProducts', () => {
  it('deduplica por productId y conserva el primero', () => {
    const merged = mergeCatalogProducts([
      catalog,
      [{ ...catalog[0]!, name: 'Vacío duplicado', price: 1 }],
    ])
    expect(merged.find(p => p.productId === 'p1')?.name).toBe('Vacío')
    expect(merged).toHaveLength(3)
  })

  it('ordena por PLU ascendente, no por nombre', () => {
    const merged = mergeCatalogProducts([catalog])
    expect(merged.map(p => p.pluNumber)).toEqual([5, 10, 250])
  })

  it('excluye bajas globales aunque un local todavía las tenga en el array', () => {
    const ghost: CatalogProduct = {
      productId: 'gone',
      pluNumber: 999,
      name: 'Prueba 999',
      category: 'other',
      unit: 'unit',
      price: 1,
    }
    const merged = mergeCatalogProducts(
      [[ghost, catalog[0]!], catalog],
      ['gone'],
    )
    expect(merged.map(p => p.productId)).not.toContain('gone')
    expect(merged.find(p => p.pluNumber === 999)).toBeUndefined()
  })

  it('si el mismo PLU quedó en dos fichas distintas, deja una sola (la más nueva)', () => {
    const oldOne: CatalogProduct & { updatedAt: string } = {
      productId: 'old-999',
      pluNumber: 999,
      name: 'Prueba 999',
      category: 'other',
      unit: 'unit',
      price: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const newOne: CatalogProduct & { updatedAt: string } = {
      productId: 'new-999',
      pluNumber: 999,
      name: 'Prueba 999 nueva',
      category: 'other',
      unit: 'unit',
      price: 2,
      updatedAt: '2026-08-25T00:00:00.000Z',
    }
    const merged = mergeCatalogProducts([[oldOne], [newOne]])
    expect(merged.filter(p => p.pluNumber === 999)).toHaveLength(1)
    expect(merged.find(p => p.pluNumber === 999)?.productId).toBe('new-999')
  })
})

describe('catalogTypeaheadMatches', () => {
  const many: CatalogProduct[] = Array.from({ length: 50 }, (_, i) => ({
    productId: `p${i}`,
    pluNumber: 50 - i,
    name: `Producto ${String.fromCharCode(65 + (i % 26))} ${i}`,
    category: 'other',
    unit: 'kg' as const,
    price: 1000,
  }))

  it('sin query devuelve todos, ordenados por PLU, sin tope de 40', () => {
    const matches = catalogTypeaheadMatches(many, '')
    expect(matches).toHaveLength(50)
    expect(matches[0]?.pluNumber).toBe(1)
    expect(matches[49]?.pluNumber).toBe(50)
  })

  it('con query busca en el catálogo completo, no en un recorte', () => {
    const matches = catalogTypeaheadMatches(many, 'Producto Z 25')
    expect(matches.some(p => p.productId === 'p25')).toBe(true)
  })

  it('omite productos ya asignados', () => {
    const matches = catalogTypeaheadMatches(catalog, '', ['p1'])
    expect(matches.map(p => p.productId)).toEqual(['p3', 'p2'])
  })
})
