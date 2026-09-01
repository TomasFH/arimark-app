import { createElement, Fragment, act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import {
  useBackLayer,
  installSystemBackHandler,
  requestBack,
  backStackDepth,
  resetBackStackForTests,
  setEmptyBackHandler,
  cancelPendingExit,
  exitApp,
} from '../lib/backStack'

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

  it('con la pila vacía no re-pone el guard (Salir tiene que poder salir)', () => {
    setEmptyBackHandler(vi.fn())
    act(() => requestBack())
    const state = window.history.state as { appGuard?: boolean; root?: boolean } | null
    expect(state?.appGuard).not.toBe(true)
  })

  it('cancelar re-pone el guard y el siguiente atrás vuelve a preguntar', () => {
    const empty = vi.fn()
    setEmptyBackHandler(empty)
    act(() => requestBack())
    expect(empty).toHaveBeenCalledTimes(1)
    cancelPendingExit()
    act(() => requestBack())
    expect(empty).toHaveBeenCalledTimes(2)
  })

  it('exitApp (PWA): pushState + go negativo para cerrar; no dispara onEmptyBack', async () => {
    const empty = vi.fn()
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined)
    // Mockear go para evitar popstate en jsdom y capturar el argumento.
    const goSpy = vi.spyOn(window.history, 'go').mockImplementation(() => undefined)
    setEmptyBackHandler(empty)
    await exitApp()
    expect(empty).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
    // go debe recibir un número negativo (intenta ir antes del inicio de sesión).
    expect(goSpy).toHaveBeenCalledTimes(1)
    const arg = goSpy.mock.calls[0]![0] as number
    expect(arg).toBeLessThan(0)
    close.mockRestore()
    goSpy.mockRestore()
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

  it('instalar dos veces no desmonta el listener del primero', () => {
    const empty = vi.fn()
    setEmptyBackHandler(empty)
    const second = installSystemBackHandler()
    second()
    act(() => requestBack())
    expect(empty).toHaveBeenCalledTimes(1)
  })

  it('sin onEmptyBack re-pone el guard para no salir antes de montar el modal', () => {
    setEmptyBackHandler(null)
    act(() => requestBack())
    const state = window.history.state as { appGuard?: boolean } | null
    expect(state?.appGuard).toBe(true)
  })

  it('Atrás con capas no pregunta salir; al vaciar sí', () => {
    const empty = vi.fn()
    const onPop = vi.fn()
    setEmptyBackHandler(empty)
    act(() => {
      root.render(createElement(Harness, { active: true, onPop }))
    })
    act(() => requestBack())
    expect(onPop).toHaveBeenCalledTimes(1)
    expect(empty).not.toHaveBeenCalled()
    act(() => requestBack())
    expect(empty).toHaveBeenCalledTimes(1)
  })

  it('segundo Atrás con el modal ya pedido vuelve a llamar onEmptyBack (Salir)', () => {
    const empty = vi.fn()
    setEmptyBackHandler(empty)
    act(() => requestBack())
    expect(empty).toHaveBeenCalledTimes(1)
    // En jsdom, history.back() desde la entrada raíz no dispara popstate.
    // El nativo llama onEmptyBack sin history.back(); acá simulamos ese popstate.
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(empty).toHaveBeenCalledTimes(2)
  })

  it('cancelPendingExit es idempotente si nunca se preguntó salir', () => {
    expect(() => cancelPendingExit()).not.toThrow()
    const empty = vi.fn()
    setEmptyBackHandler(empty)
    act(() => requestBack())
    expect(empty).toHaveBeenCalledTimes(1)
  })
})
