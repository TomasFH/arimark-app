/**
 * Gestos del celu: pellizco vs pull-to-refresh, y tap que selecciona texto
 * (Chrome “buscar en Google”).
 *
 * Chrome dispara recargar página si el documento scrollea hacia abajo en el
 * tope. Durante un pellizco un dedo suele ir para abajo y se mezcla con eso.
 * Mientras hay 2 dedos (y un instante después) se bloquea el scroll de 1 dedo.
 */

export function isTextSelectableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest('input, textarea, select, [contenteditable="true"]') != null
}

export function installTouchGuards(): () => void {
  const root = document.documentElement
  let pinchLock = false
  let pinchTimer: ReturnType<typeof setTimeout> | undefined

  function setPinching(on: boolean): void {
    pinchLock = on
    root.classList.toggle('is-pinching', on)
  }

  function syncZoomed(): void {
    const scale = window.visualViewport?.scale ?? 1
    root.classList.toggle('is-zoomed', scale > 1.02)
  }

  function onTouchStart(e: TouchEvent): void {
    if (e.touches.length >= 2) {
      if (pinchTimer) clearTimeout(pinchTimer)
      setPinching(true)
    }
  }

  function onTouchEnd(e: TouchEvent): void {
    if (e.touches.length >= 2) return
    if (pinchTimer) clearTimeout(pinchTimer)
    pinchTimer = setTimeout(() => setPinching(false), 400)
  }

  function onTouchMove(e: TouchEvent): void {
    if (e.touches.length >= 2) return
    if (!pinchLock) return
    e.preventDefault()
  }

  function onContextMenu(e: Event): void {
    if (!isTextSelectableTarget(e.target)) e.preventDefault()
  }

  function onSelectStart(e: Event): void {
    if (!isTextSelectableTarget(e.target)) e.preventDefault()
  }

  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
  document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true })
  document.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true })
  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
  document.addEventListener('contextmenu', onContextMenu)
  document.addEventListener('selectstart', onSelectStart)

  const vv = window.visualViewport
  vv?.addEventListener('resize', syncZoomed)
  vv?.addEventListener('scroll', syncZoomed)
  syncZoomed()

  return () => {
    if (pinchTimer) clearTimeout(pinchTimer)
    setPinching(false)
    root.classList.remove('is-zoomed')
    document.removeEventListener('touchstart', onTouchStart, { capture: true })
    document.removeEventListener('touchend', onTouchEnd, { capture: true })
    document.removeEventListener('touchcancel', onTouchEnd, { capture: true })
    document.removeEventListener('touchmove', onTouchMove, { capture: true })
    document.removeEventListener('contextmenu', onContextMenu)
    document.removeEventListener('selectstart', onSelectStart)
    vv?.removeEventListener('resize', syncZoomed)
    vv?.removeEventListener('scroll', syncZoomed)
  }
}
