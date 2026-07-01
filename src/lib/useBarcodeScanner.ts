/**
 * Hook para capturar input de un lector de código de barras USB (keyboard-wedge).
 *
 * Los lectores USB envían las teclas a muy alta velocidad (< 30 ms entre caracteres)
 * seguidas de Enter. Este hook detecta esa secuencia sin necesidad de que la cajera
 * enfoque ningún campo: escucha globalmente en el documento.
 *
 * Regla de no-interferencia: si el foco está en un input, textarea o select
 * (por ejemplo mientras la cajera escribe en el campo PLU o en las notas),
 * el hook se silencia para no pisar el ingreso manual.
 *
 * Secuencia de detección:
 *  1. Tecla con dígito fuera de un campo de texto → inicia buffer y temporizador.
 *  2. Dígitos siguientes con gap < MAX_GAP_MS → se acumulan en el buffer.
 *  3. Enter → dispara onScan() inmediatamente con lo acumulado.
 *  4. 13 dígitos acumulados → dispara onScan() sin esperar Enter (auto-submit).
 *  5. Gap > MAX_GAP_MS entre dígitos → se descarta el buffer (era tipeo manual).
 *  6. Carácter no-dígito (excepto Enter) → descarta el buffer.
 *
 * Umbral elegido: 50 ms entre teclas distingue cómodo al lector (~2 ms entre chars)
 * de la cajera más rápida (~100–150 ms entre chars al tipear).
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

  const clearBuffer = useCallback(() => {
    bufferRef.current = ''
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const flush = useCallback(
    (digits: string) => {
      clearBuffer()
      if (digits.length >= MIN_SCAN_LENGTH) {
        onScan(digits)
      }
    },
    [onScan, clearBuffer]
  )

  useEffect(() => {
    if (disabled) {
      clearBuffer()
      return
    }

    function onKeyDown(e: KeyboardEvent) {
      // Si el foco está en un campo editable, no interceptar.
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return

      const now = Date.now()

      if (e.key === 'Enter') {
        const digits = bufferRef.current
        flush(digits)
        // Prevenir submit de formularios si hubiera alguno enfocado
        if (digits.length >= MIN_SCAN_LENGTH) e.preventDefault()
        return
      }

      if (!/^\d$/.test(e.key)) {
        // Carácter inesperado: descarta el buffer en curso (no es un código de barras)
        clearBuffer()
        return
      }

      // Verificar velocidad de tipeo solo cuando ya hay algo acumulado
      if (bufferRef.current.length > 0) {
        const gap = now - lastKeyTimeRef.current
        if (gap > MAX_GAP_MS) {
          // Muy lento para ser un lector → descartar y empezar de cero con este dígito
          clearBuffer()
        }
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
