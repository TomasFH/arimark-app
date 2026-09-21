import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useModalSuggestLayer } from './Modal'

/**
 * Lista anclada al campo, recortada al cuerpo del modal.
 * No cambia el alto del panel ni se pinta sobre header/footer.
 */
export function SuggestPopover({
  anchorRef,
  open,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  children: ReactNode
}) {
  const layerRef = useModalSuggestLayer()
  const [box, setBox] = useState<{
    top?: number
    bottom?: number
    left: number
    width: number
    maxHeight: number
  } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setBox(null)
      return
    }

    let raf = 0
    let alive = true

    function round(n: number) {
      return Math.round(n)
    }

    function update() {
      const el = anchorRef.current
      const layer = layerRef?.current
      if (!el || !layer) return
      const r = el.getBoundingClientRect()
      const layerBox = layer.getBoundingClientRect()
      const gap = 4
      const cap = 224
      const left = round(r.left - layerBox.left)
      const width = round(r.width)
      const below = layerBox.bottom - r.bottom - gap
      const above = r.top - layerBox.top - gap
      const placeAbove = below < 72 && above > below && above > 48
      const next = placeAbove
        ? {
            bottom: round(layerBox.bottom - r.top + gap),
            top: undefined as number | undefined,
            left,
            width,
            maxHeight: round(Math.max(0, Math.min(cap, above))),
          }
        : {
            top: round(r.bottom - layerBox.top + gap),
            bottom: undefined as number | undefined,
            left,
            width,
            maxHeight: round(Math.max(0, Math.min(cap, below))),
          }
      setBox(prev => {
        if (
          prev
          && prev.top === next.top
          && prev.bottom === next.bottom
          && prev.left === next.left
          && prev.width === next.width
          && prev.maxHeight === next.maxHeight
        ) return prev
        return next
      })
    }

    function tick() {
      if (!alive) return
      update()
      raf = requestAnimationFrame(tick)
    }

    update()
    raf = requestAnimationFrame(tick)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [open, anchorRef, layerRef])

  const layer = layerRef?.current
  if (!open || box == null || layer == null || box.maxHeight < 32) return null

  return createPortal(
    <div
      className="pointer-events-auto absolute overflow-y-auto rounded-lg border border-line bg-raised shadow-[0_8px_24px_rgba(28,28,30,0.18)] [scrollbar-gutter:stable]"
      style={{
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        maxHeight: box.maxHeight,
      }}
    >
      {children}
    </div>,
    layer,
  )
}
