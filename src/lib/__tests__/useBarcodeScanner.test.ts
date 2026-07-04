/**
 * Tests del hook useBarcodeScanner.
 *
 * El hook escucha eventos `keydown` en el documento y dispara onScan() cuando
 * detecta una secuencia de dígitos a velocidad de lector USB.
 *
 * Nota: en jsdom los eventos dispatched en `document` no actualizan el .value
 * de los inputs (eso requeriría despacharlos directamente en el elemento).
 * Por eso los tests de restauración de campo verifican que onScan se llame,
 * no el .value resultante (eso se cubre con pruebas E2E o manuales).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBarcodeScanner } from '../useBarcodeScanner'

// Simula una pulsación de tecla a nivel de documento
function pressKey(key: string) {
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
  // Asegurar que no haya foco en ningún campo al inicio
  if (document.activeElement && document.activeElement !== document.body) {
    ;(document.activeElement as HTMLElement).blur()
  }
})

afterEach(() => {
  vi.useRealTimers()
  // Limpiar los elementos insertados para simular foco
  document.querySelectorAll('body > input, body > textarea, body > select').forEach(el =>
    el.remove()
  )
})

describe('useBarcodeScanner — detección básica (sin campo enfocado)', () => {
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

describe('useBarcodeScanner — intercepción con campo enfocado', () => {
  it('llama onScan aunque el foco esté en un input', async () => {
    const onScan = vi.fn()
    renderHook(() => useBarcodeScanner({ onScan }))

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    await scanBarcode('2001060000012')

    expect(onScan).toHaveBeenCalledWith('2001060000012')
    input.remove()
  })

  it('llama onScan aunque el foco esté en un textarea', async () => {
    const onScan = vi.fn()
    renderHook(() => useBarcodeScanner({ onScan }))

    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.focus()

    await scanBarcode('2001060000012')

    expect(onScan).toHaveBeenCalledWith('2001060000012')
    ta.remove()
  })

  it('NO intercepta si el input tiene data-barcode-input="true"', async () => {
    const onScan = vi.fn()
    renderHook(() => useBarcodeScanner({ onScan }))

    const input = document.createElement('input')
    input.dataset.barcodeInput = 'true'
    document.body.appendChild(input)
    input.focus()

    await scanBarcode('2001060000012')

    // El campo con data-barcode-input maneja sus propios scans; el hook se silencia
    expect(onScan).not.toHaveBeenCalled()
    input.remove()
  })

  it('NO intercepta cuando disabled=true aunque haya campo enfocado', async () => {
    const onScan = vi.fn()
    renderHook(() => useBarcodeScanner({ onScan, disabled: true }))

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    await scanBarcode('2001060000012')

    expect(onScan).not.toHaveBeenCalled()
    input.remove()
  })
})

describe('useBarcodeScanner — descarte de buffer', () => {
  it('descarta el buffer si llega un carácter no-dígito (excepto Enter)', async () => {
    const onScan = vi.fn()
    renderHook(() => useBarcodeScanner({ onScan }))

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
