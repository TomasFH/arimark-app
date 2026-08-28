import { createElement, Fragment, act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { useBackLayer, installSystemBackHandler, requestBack, backStackDepth, resetBackStackForTests, setEmptyBackHandler } from '../lib/backStack'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness({ active, onPop }: { active: boolean; onPop: () => void }) {
  useBackLayer(active, onPop)
  return null
}

describe('backStack', () => {
  let uninstall: (() => void) | undefined
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    resetBackStackForTests()
    window.history.replaceState({ root: true }, '', '/')
    uninstall = installSystemBackHandler()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    uninstall?.()
    resetBackStackForTests()
  })

  it('requestBack ejecuta el handler de la capa superior y no las de abajo', () => {
    const inner = vi.fn()
    const outer = vi.fn()
    act(() => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(Harness, { active: true, onPop: outer }),
          createElement(Harness, { active: true, onPop: inner }),
        ),
      )
    })

    expect(backStackDepth()).toBe(2)
    act(() => requestBack())
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
    expect(backStackDepth()).toBe(1)

    act(() => requestBack())
    expect(outer).toHaveBeenCalledTimes(1)
    expect(backStackDepth()).toBe(0)
  })

  it('con la pila vacía no sale: llama onEmptyBack y deja la app abierta', () => {
    const empty = vi.fn()
    setEmptyBackHandler(empty)
    act(() => requestBack())
    expect(empty).toHaveBeenCalledTimes(1)
    expect(backStackDepth()).toBe(0)
  })

  it('unmount de una capa no dispara onPop (el usuario no pidió atrás)', () => {
    const onPop = vi.fn()
    act(() => {
      root.render(createElement(Harness, { active: true, onPop }))
    })
    expect(backStackDepth()).toBe(1)
    act(() => root.unmount())
    expect(onPop).not.toHaveBeenCalled()
  })
})
