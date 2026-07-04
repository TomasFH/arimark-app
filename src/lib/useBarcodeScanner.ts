/**
 * Hook para capturar input de un lector de código de barras USB (keyboard-wedge).
 *
 * Los lectores USB envían las teclas a muy alta velocidad (< 30 ms entre caracteres)
 * seguidas de Enter. Este hook detecta esa secuencia globalmente en el documento.
 *
 * Comportamiento con campos de texto enfocados:
 *  - Si el foco está en un input/textarea SIN data-barcode-input, el hook intercepta
 *    igualmente: previene que los dígitos del scanner contaminen el campo y, al
 *    completar la lectura, restaura el valor previo del campo mediante el setter
 *    nativo (compatible con React controlled inputs).
 *  - Si el campo tiene data-barcode-input="true" (el input de "Código manual" en
 *    ScanInput), el hook se silencia porque ese campo ya procesa barcodes por sí solo.
 *  - Si disabled=true (ej. modal de cobro abierto), el hook no hace nada.
 *
 * Secuencia de detección:
 *  1. Primer dígito → inicia buffer. Si hay campo enfocado, el dígito entra al campo.
 *  2. Segundo dígito con gap < MAX_GAP_MS → modo scanner confirmado.
 *     Si hay campo enfocado: guarda el valor previo y activa intercepción.
 *  3. Dígitos siguientes en modo intercepción → preventDefault (no van al campo).
 *  4. 13 dígitos → auto-flush sin esperar Enter.
 *  5. Enter → flush con lo acumulado (mínimo MIN_SCAN_LENGTH dígitos).
 *     Si el flush vino del auto-flush (13 dígitos), el Enter residual del lector
 *     también se bloquea para no disparar el formulario enfocado.
 *  6. Gap > MAX_GAP_MS o carácter no-dígito → descarta buffer.
 */

import { useCallback, useEffect, useRef } from 'react'

const MAX_GAP_MS = 50
/** Longitud mínima para considerar que el Enter cierra un código. */
const MIN_SCAN_LENGTH = 8

interface Options {
  /** Llamado al detectar un código completo. Recibe solo los dígitos, sin Enter. */
  onScan: (digits: string) => void
  /** Suspende la escucha global (útil cuando hay un modal abierto con campos propios). */
  disabled?: boolean
}

export function useBarcodeScanner({ onScan, disabled = false }: Options): void {
  const bufferRef = useRef('')
  const lastKeyTimeRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Interception state: se activa cuando el 2° dígito rápido llega con un campo enfocado
  const interceptedFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const fieldOriginalValueRef = useRef('')
  const interceptingRef = useRef(false)
  // Bloquea el Enter residual que el lector envía tras el auto-flush de 13 dígitos
  const pendingEnterBlockRef = useRef(false)

  const clearBuffer = useCallback(() => {
    bufferRef.current = ''
    interceptedFieldRef.current = null
    fieldOriginalValueRef.current = ''
    interceptingRef.current = false
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  /** Restaura el campo al valor que tenía antes de que el scanner empezara a escribir. */
  const restoreField = useCallback(() => {
    const el = interceptedFieldRef.current
    if (!el) return
    const proto =
      el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (nativeSetter) {
      nativeSetter.call(el, fieldOriginalValueRef.current)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }, [])

  const flush = useCallback(
    (digits: string) => {
      const wasIntercepting = interceptingRef.current
      if (wasIntercepting) {
        restoreField()
        // El lector enviará un Enter después del auto-flush de 13 dígitos; bloquearlo
        pendingEnterBlockRef.current = true
      }
      clearBuffer()
      if (digits.length >= MIN_SCAN_LENGTH) {
        onScan(digits)
      }
    },
    [onScan, clearBuffer, restoreField]
  )

  useEffect(() => {
    if (disabled) {
      clearBuffer()
      return
    }

    function onKeyDown(e: KeyboardEvent) {
      const now = Date.now()
      const activeEl = document.activeElement
      const tag = (activeEl?.tagName ?? '').toLowerCase()
      const isEditableField = tag === 'input' || tag === 'textarea'

      // El input dedicado a barcodes maneja sus propios scans — no interceptar
      if (isEditableField && (activeEl as HTMLElement).dataset.barcodeInput === 'true') return

      if (e.key === 'Enter') {
        const digits = bufferRef.current
        if (digits.length >= MIN_SCAN_LENGTH) {
          e.preventDefault()
          flush(digits)
        } else if (pendingEnterBlockRef.current) {
          // Enter residual del lector tras un auto-flush de 13 dígitos en campo enfocado
          e.preventDefault()
          pendingEnterBlockRef.current = false
        } else {
          clearBuffer()
        }
        return
      }

      // Cualquier carácter no-dígito (excepto Enter) cancela el buffer en curso
      if (!/^\d$/.test(e.key)) {
        clearBuffer()
        pendingEnterBlockRef.current = false
        return
      }

      pendingEnterBlockRef.current = false

      if (bufferRef.current.length > 0) {
        const gap = now - lastKeyTimeRef.current
        if (gap > MAX_GAP_MS) {
          // Muy lento para ser un lector → descarta y empieza de cero con este dígito
          clearBuffer()
        } else if (isEditableField && !interceptingRef.current) {
          // 2° dígito rápido con campo enfocado → modo scanner confirmado
          // El 1er dígito ya entró al campo; guardar el valor sin ese primer carácter
          const el = activeEl as HTMLInputElement | HTMLTextAreaElement
          interceptedFieldRef.current = el
          fieldOriginalValueRef.current =
            el.value.length > 0 ? el.value.slice(0, -1) : ''
          interceptingRef.current = true
        }
      }

      // En modo intercepción: prevenir que los dígitos del scanner lleguen al campo
      if (interceptingRef.current) {
        e.preventDefault()
      }

      lastKeyTimeRef.current = now
      bufferRef.current += e.key

      // Auto-submit al alcanzar la longitud exacta del EAN-13
      if (bufferRef.current.length === 13) {
        flush(bufferRef.current)
        return
      }

      // Temporizador de seguridad: si no llegan más teclas, limpiar el buffer
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(clearBuffer, MAX_GAP_MS * 4)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      clearBuffer()
    }
  }, [disabled, flush, clearBuffer])
}
