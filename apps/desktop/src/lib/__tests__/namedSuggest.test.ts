import { describe, expect, it } from 'vitest'
import { namedSuggest } from '../namedSuggest'

const providers = [
  { id: '1', name: 'Oso' },
  { id: '2', name: 'Juan Pollo' },
  { id: '3', name: 'Carbón' },
]

describe('namedSuggest', () => {
  it('sin texto lista todas las opciones', () => {
    expect(namedSuggest(providers, '', p => p.name).listed).toHaveLength(3)
    expect(namedSuggest(providers, '  ', p => p.name).exact).toBeUndefined()
  })

  it('filtra por fragmento sin cambiar de opción elegida', () => {
    const r = namedSuggest(providers, 'o', p => p.name)
    expect(r.exact).toBeUndefined()
    expect(r.listed.map(p => p.name)).toEqual(['Oso', 'Juan Pollo'])
  })

  it('coincidencia exacta (sin importar mayúsculas) oculta la lista', () => {
    const r = namedSuggest(providers, 'oso', p => p.name)
    expect(r.exact?.id).toBe('1')
    expect(r.listed).toEqual([])
  })

  it('un prefijo de otro nombre no se asume como exacto', () => {
    const r = namedSuggest(providers, 'Juan', p => p.name)
    expect(r.exact).toBeUndefined()
    expect(r.listed.map(p => p.name)).toEqual(['Juan Pollo'])
  })
})
