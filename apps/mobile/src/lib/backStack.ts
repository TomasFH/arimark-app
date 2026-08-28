/**
 * Pila de navegación para el botón atrás del sistema (Android, gesto iOS,
 * botón atrás del navegador en PWA).
 *
 * Cada pantalla o modal registra una capa. Atrás del sistema hace
 * `history.back()` → `popstate` → se ejecuta el handler de la capa superior.
 * El botón ← de la app usa el mismo camino (`requestBack`) para no desincronizar.
 *
 * Con la pila vacía no se sale de la app: se llama `onEmptyBack` (confirmación).
 */
import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'

interface Layer {
  id: number
  onPop: () => void
}

const stack: Layer[] = []
let nextId = 1
/** popstate originados por cleanup (Strict Mode / unmount) que no deben ejecutar onPop. */
let ignorePop = 0
let listenerInstalled = false
let onEmptyBack: (() => void) | null = null
let allowLeave = false

function onPopState(): void {
  if (ignorePop > 0) {
    ignorePop -= 1
    return
  }
  if (allowLeave) return

  const layer = stack.pop()
  if (layer) {
    layer.onPop()
    return
  }
  // Reponer el guard para no salir del documento; avisar a la UI.
  window.history.pushState({ appGuard: true }, '')
  onEmptyBack?.()
}

function pushHistoryGuard(): void {
  if (window.history.state && (window.history.state as { appGuard?: boolean }).appGuard === true) {
    return
  }
  window.history.pushState({ appGuard: true }, '')
}

/**
 * Instala el listener global. Llamar una vez desde App.
 * En nativo, toma el back button de Capacitor para no salir de la app
 * mientras haya capas (sección o modal).
 */
export function installSystemBackHandler(): () => void {
  if (listenerInstalled) return () => {}
  listenerInstalled = true
  pushHistoryGuard()
  window.addEventListener('popstate', onPopState)

  let removeNative: (() => void) | undefined
  if (Capacitor.isNativePlatform()) {
    void import('@capacitor/app').then(({ App }) => {
      void App.addListener('backButton', ({ canGoBack }) => {
        if (allowLeave) {
          void App.exitApp()
          return
        }
        if (stack.length > 0 || canGoBack) {
          window.history.back()
          return
        }
        onEmptyBack?.()
      }).then(handle => {
        removeNative = () => {
          void handle.remove()
        }
      })
    })
  }

  return () => {
    window.removeEventListener('popstate', onPopState)
    removeNative?.()
    listenerInstalled = false
    stack.length = 0
    ignorePop = 0
    onEmptyBack = null
    allowLeave = false
  }
}

/** Qué hacer cuando no queda nada a lo que volver (mostrar “¿salir?”). */
export function setEmptyBackHandler(handler: (() => void) | null): void {
  onEmptyBack = handler
}

/** Cierra la app nativa, o deja salir de la PWA. */
export async function exitApp(): Promise<void> {
  allowLeave = true
  if (Capacitor.isNativePlatform()) {
    const { App } = await import('@capacitor/app')
    await App.exitApp()
    return
  }
  window.history.back()
}

/** Dispara el mismo recorrido que el atrás del sistema. */
export function requestBack(): void {
  window.history.back()
}

export function backStackDepth(): number {
  return stack.length
}

function pushLayer(onPop: () => void): Layer {
  const layer: Layer = { id: nextId++, onPop }
  stack.push(layer)
  window.history.pushState({ backStack: layer.id }, '')
  return layer
}

function discardLayer(layer: Layer): void {
  const idx = stack.indexOf(layer)
  if (idx < 0) return
  if (idx === stack.length - 1) {
    ignorePop += 1
    stack.pop()
    window.history.back()
    return
  }
  stack.splice(idx, 1)
}

/**
 * Mientras `active` es true, el atrás del sistema ejecuta `onPop`.
 * El handler se lee de un ref para no re-pushear en cada render.
 */
export function useBackLayer(active: boolean, onPop: () => void): void {
  const onPopRef = useRef(onPop)
  onPopRef.current = onPop

  useEffect(() => {
    if (!active) return
    const layer = pushLayer(() => onPopRef.current())
    return () => discardLayer(layer)
  }, [active])
}

/** Solo tests: vacía la pila sin tocar history. */
export function resetBackStackForTests(): void {
  stack.length = 0
  ignorePop = 0
  allowLeave = false
  onEmptyBack = null
}
