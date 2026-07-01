/**
 * Tests del hook useBarcodeScanner.
 *
 * El hook escucha eventos `keydown` en el documento y dispara onScan() cuando
 * detecta una secuencia de dígitos a velocidad de lector USB.
 *
 * En jsdom los eventos de teclado se simulan con new KeyboardEvent.
 * Se usa vi.useFakeTimers() para controlar los timeouts de limpieza del buffer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBarcodeScanner } from '../useBarcodeScanner'

// Simula una pulsación de tecla a nivel de documento
function pressKey(key: string, activeTag = '') {
  // Configurar el elemento activo del documento si se pide
  if (activeTag) {
    const el = document.createElement(activeTag as keyof HTMLElementTagNameMap)
    document.body.appendChild(el)
    el.focus()
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

// Simula la secuencia de un lector: teclas rápidas + Enter
async function scanBarcode(digits: string) {
  for (const ch of digits) {
    pressKey(ch)
  }
  pressKey('Enter')
}

beforeEach(() => {
  vi.useFakeTimers()
  // Limpiar foco para que el hook no esté silenciado
  if (document.activeElement && document.activeElement !== document.body) {
    (document.activeElement as HTMLElement).blur()
  }
})

afterEach(() => {
  vi.useRealTimers()
  // Limpiar los elementos insertados para simular foco
  document.querySelectorAll('body > input, body > textarea, body > select').forEach(el => el.remove())
})

describe('useBarcodeScanner — detección básica', () => {
  it('llama onScan al recibir 13 dígitos seguidos de Enter', async () => {
    const onScan = vi.fn()
    renderHook(() => useBarcodeScanner({ onScan }))

    await scanBarcode('2001060000012')

    expect(onScan).toHaveBeenCalledOnce()
    expect(onScan).toHaveBeenCalledWith('2001060000012')
  })

  it('llama onScan al acumular exactamente 13 dígitos (sin Enter)', async () => {
    const onScan = vi.fn()
    renderHook(() => useBarcodeScanner({ onScan }))

    for (const ch of '2001060000012') pressKey(ch)

    expect(onScan).toHaveBeenCalledOnce()
    expect(onScan).toHaveBeenCalledWith('2001060000012')
  })

  it('no llama onScan si la secuencia es menor a 8 dígitos + Enter', async () => {
    const onScan = vi.fn()
    renderHook(() => useBarcodeScanner({ onScan }))

    await scanBarcode('123')

    expect(onScan).not.toHaveBeenCalled()
  })

  it('llama onScan con una secuencia de 10 dígitos + Enter (código parcial válido)', async () => {
    const onScan = vi.fn()
    renderHook(() => useBarcodeScanner({ onScan }))

    await scanBarcode('1234567890')

    expect(onScan).toHaveBeenCalledWith('1234567890')
  })
})

describe('useBarcodeScanner — no interferencia con campos', () => {
  it('no intercepta cuando el foco está en un input', async () => {
    const onScan = vi.fn()
    renderHook(() => useBarcodeScanner({ onScan }))

    // Crear un input y darle foco
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    await scanBarcode('2001060000012')

    expect(onScan).not.toHaveBeenCalled()
    input.remove()
  })

  it('no intercepta cuando el foco está en un textarea', async () => {
    const onScan = vi.fn()
    renderHook(() => useBarcodeScanner({ onScan }))

    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.focus()

    await scanBarcode('2001060000012')

    expect(onScan).not.toHaveBeenCalled()
    ta.remove()
  })
})

describe('useBarcodeScanner — descarte de buffer', () => {
  it('descarta el buffer si llega un carácter no-dígito (excepto Enter)', async () => {
    const onScan = vi.fn()
    renderHook(() => useBarcodeScanner({ onScan }))

    // Escribe 5 dígitos, luego una letra, luego Enter
    for (const ch of '20010') pressKey(ch)
    pressKey('a')
    pressKey('Enter')

    expect(onScan).not.toHaveBeenCalled()
  })

  it('descarta el buffer tras el timeout de limpieza', async () => {
    const onScan = vi.fn()
    renderHook(() => useBarcodeScanner({ onScan }))

    for (const ch of '20010') pressKey(ch)

    // Avanzar tiempo más allá del timeout de limpieza (MAX_GAP_MS × 4 = 200ms)
    await vi.advanceTimersByTimeAsync(250)
    pressKey('Enter')

    expect(onScan).not.toHaveBeenCalled()
  })
})

describe('useBarcodeScanner — disabled', () => {
  it('no intercepta nada cuando disabled=true', async () => {
    const onScan = vi.fn()
    renderHook(() => useBarcodeScanner({ onScan, disabled: true }))

    await scanBarcode('2001060000012')

    expect(onScan).not.toHaveBeenCalled()
  })
})
