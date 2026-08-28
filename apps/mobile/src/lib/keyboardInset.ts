import { useEffect, useState } from 'react'

/**
 * Cuánto tapa el teclado virtual el layout (px).
 * Si el navegador ya achica el viewport (`interactive-widget=resizes-content`),
 * da 0 y no hay que compensar.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    function update(): void {
      const current = window.visualViewport
      if (!current) return
      const overlap = Math.max(0, window.innerHeight - current.height - current.offsetTop)
      setInset(Math.round(overlap))
    }

    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    update()
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
