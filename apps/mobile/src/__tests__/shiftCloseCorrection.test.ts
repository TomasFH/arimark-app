import { afterEach, describe, expect, it } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ShiftCloseCorrection from '../components/admin/ShiftCloseCorrection'

describe('corregir el cierre en el celu', () => {
  let host: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    act(() => { root?.unmount() })
    host?.remove()
    host = null
    root = null
  })

  it('no muestra los campos hasta elegir la acción del menú', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(createElement(ShiftCloseCorrection, {
        cashLeft: 1500,
        withdrawn: null,
        onSubmit: async () => {},
      }))
    })

    expect(document.body.querySelector('input')).toBeNull()
    expect(document.body.textContent).toContain('sin anotar')
    expect(document.body.textContent).toContain('Quedó en la caja')

    const menu = document.body.querySelector('button[aria-label="Acciones del cierre"]')
    if (!(menu instanceof HTMLButtonElement)) throw new Error('falta el menú')
    await act(async () => { menu.click() })
    expect(document.body.querySelector('input')).toBeNull()

    const item = document.body.querySelector('[role="menuitem"]')
    if (!(item instanceof HTMLButtonElement)) throw new Error('falta la acción')
    expect(item.textContent).toContain('Corregir cierre')
    await act(async () => { item.click() })
    expect(document.body.querySelectorAll('input')).toHaveLength(2)
  })
})
