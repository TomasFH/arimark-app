import { describe, it, expect } from 'vitest'
import { isTextSelectableTarget } from '../lib/touchGuards'

describe('isTextSelectableTarget', () => {
  it('permite inputs y bloquea un párrafo', () => {
    const input = document.createElement('input')
    const p = document.createElement('p')
    p.textContent = 'Carnicero'
    document.body.append(input, p)
    expect(isTextSelectableTarget(input)).toBe(true)
    expect(isTextSelectableTarget(p)).toBe(false)
    input.remove()
    p.remove()
  })
})
