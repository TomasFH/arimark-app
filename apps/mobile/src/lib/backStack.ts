/**
 * Pila de navegación para el botón atrás del sistema (Android, gesto iOS,
 * botón atrás del navegador en PWA).
 *
 * Cada pantalla o modal registra una capa. Atrás del sistema hace
 * `history.back()` → `popstate` → se ejecuta el handler de la capa superior.
 * El botón ← de la app usa el mismo camino (`requestBack`) para no desincronizar.
 *
 * Con la pila vacía no se sale de la app: se llama `onEmptyBack` (confirmación).
 * No se re-pone el guard en ese momento: si se re-pushea, "Salir" solo saca
 * el dummy y la PWA queda abierta. Cancelar vuelve a poner el guard.
 *
 * "Salir" en PWA: al llegar al modal el historial ya está en posición 0 (el primer
 * Atrás lo llevó allí). `history.go(-n)` desde position 0 es "fuera de rango" per
 * HTML5 spec → Chrome lo ignora. Fix: pushear un estado antes de go(-length) para
 * que la posición sea > 0 y Chrome cierre la actividad al intentar ir a position < 0.
 */
import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'

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
/** Cuántos `history.back()` extra se dispararon al confirmar salida (PWA). */
let leaveDrain = 0
let removeNative: (() => void) | undefined

function onPopState(): void {
  if (ignorePop > 0) {
    ignorePop -= 1
    return
  }
  if (allowLeave) {
    // En PWA un solo back solo saca un pushState interno; hay que drenar.
    if (leaveDrain < 8) {
      leaveDrain += 1
      window.history.back()
    }
    return
  }

  const layer = stack.pop()
  if (layer) {
    layer.onPop()
    return
  }
  // Historia queda en la página real. No re-pushear el guard: eso hacía que
  // "Salir" → history.back() no saliera de la app.
  if (onEmptyBack) {
    onEmptyBack()
    return
  }
  // App todavía no registró el modal: quedarse adentro.
  pushHistoryGuard()
}

function pushHistoryGuard(): void {
  if (window.history.state && (window.history.state as { appGuard?: boolean }).appGuard === true) {
    return
  }
  window.history.pushState({ appGuard: true }, '')
}

function onNativeBackButton({ canGoBack }: { canGoBack: boolean }): void {
  if (allowLeave) {
    void CapApp.exitApp()
    return
  }
  if (stack.length > 0) {
    window.history.back()
    return
  }
  // Pila vacía: nunca history.back() aunque canGoBack sea true (saldría de la app).
  if (onEmptyBack) {
    onEmptyBack()
    return
  }
  if (canGoBack) {
    pushHistoryGuard()
  }
}

/**
 * Instala el listener global. Llamar una vez al cargar el módulo (main.tsx),
 * no desde un useEffect: el primer Atrás puede ganar la carrera al effect.
 */
export function installSystemBackHandler(): () => void {
  if (listenerInstalled) return () => {}
  listenerInstalled = true
  pushHistoryGuard()
  window.addEventListener('popstate', onPopState)

  if (Capacitor.isNativePlatform()) {
    void CapApp.addListener('backButton', onNativeBackButton).then(handle => {
      removeNative = () => {
        void handle.remove()
      }
    })
  }

  return () => {
    window.removeEventListener('popstate', onPopState)
    removeNative?.()
    removeNative = undefined
    listenerInstalled = false
    stack.length = 0
    ignorePop = 0
    onEmptyBack = null
    allowLeave = false
    leaveDrain = 0
  }
}

/** Qué hacer cuando no queda nada a lo que volver (mostrar “¿salir?”). */
export function setEmptyBackHandler(handler: (() => void) | null): void {
  onEmptyBack = handler
}

/** El usuario canceló el modal de salida: rearmar el guard y no salir. */
export function cancelPendingExit(): void {
  allowLeave = false
  leaveDrain = 0
  pushHistoryGuard()
}

/** Cierra la app nativa, o deja salir de la PWA. */
export async function exitApp(): Promise<void> {
  allowLeave = true
  leaveDrain = 0

  if (Capacitor.isNativePlatform()) {
    try {
      await CapApp.exitApp()
    } catch (err) {
      console.error('[backStack] CapApp.exitApp falló', err)
    }
    return
  }

  // window.close() solo funciona para ventanas abiertas por script, pero vale
  // el intento (hay entornos PWA que lo permiten dentro de un gesto de usuario).
  try { window.close() } catch { /* ignore */ }

  // Al llegar aquí el historial está en position 0 (el primer Atrás lo llevó
  // allí). history.go(-n) desde position 0 es "fuera de rango" per spec y
  // Chrome lo ignora → la app no se cierra.
  // Solución: pushear un estado para garantizar position > 0, y luego
  // history.go(-history.length) intenta ir a position ≤ -1 (antes del inicio
  // de la sesión). Chrome Android cierra la actividad PWA en ese caso.
  window.history.pushState({ appExit: true }, '')
  window.history.go(-window.history.length)
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
  leaveDrain = 0
  onEmptyBack = null
}
