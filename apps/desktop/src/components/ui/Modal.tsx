import { createContext, useContext, useEffect, useId, useRef, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx'

const dismissStack: Array<{ close: () => void }> = []

/** Cierre compartido: Escape (solo el modal de arriba) y clic que empieza y termina en el fondo. */
export function useModalDismiss(
  onClose: () => void,
  opts?: { escape?: boolean; overlay?: boolean },
) {
  const escape = opts?.escape !== false
  const overlay = opts?.overlay !== false
  const onCloseRef = useRef(onClose)
  const overlayDownRef = useRef(false)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!escape) return
    const entry = { close: () => onCloseRef.current() }
    dismissStack.push(entry)
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (dismissStack[dismissStack.length - 1] !== entry) return
      event.preventDefault()
      event.stopPropagation()
      entry.close()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const index = dismissStack.indexOf(entry)
      if (index >= 0) dismissStack.splice(index, 1)
    }
  }, [escape])

  return {
    onPointerDown(event: ReactPointerEvent) {
      if (!overlay) return
      // jsdom despacha pointerdown como Event y no trae button; en el browser el primario es 0.
      const button = typeof event.button === 'number' ? event.button : event.nativeEvent.button
      const primary = button == null || button === 0
      overlayDownRef.current = primary && event.target === event.currentTarget
    },
    onPointerUp(event: ReactPointerEvent) {
      const started = overlayDownRef.current
      overlayDownRef.current = false
      if (!overlay || !started) return
      if (event.target === event.currentTarget) onCloseRef.current()
    },
    onPointerCancel() {
      overlayDownRef.current = false
    },
  }
}

const CLOSE_ICON = (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
  </svg>
)

export function ModalCloseButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink disabled:opacity-40"
      aria-label="Cerrar"
      title="Cerrar"
    >
      {CLOSE_ICON}
    </button>
  )
}

/** Fondo de un modal armado a mano: Escape y clic afuera, sin cerrar por arrastre. */
export function ModalLayer({
  onClose,
  enabled = true,
  escape = enabled,
  overlay = enabled,
  className,
  children,
}: {
  onClose: () => void
  enabled?: boolean
  escape?: boolean
  overlay?: boolean
  className?: string
  children: ReactNode
}) {
  const dismiss = useModalDismiss(onClose, { escape, overlay })
  return (
    <div className={className} {...(overlay ? dismiss : {})}>
      {children}
    </div>
  )
}

const ModalSuggestLayerContext = createContext<RefObject<HTMLElement | null> | null>(null)

export function useModalSuggestLayer() {
  return useContext(ModalSuggestLayerContext)
}

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'
/** hug: alto al contenido. workspace: alto de trabajo, tope moderado. */
export type ModalFrame = 'hug' | 'workspace'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  header?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: ModalSize
  frame?: ModalFrame
  closeOnOverlay?: boolean
  closeOnEscape?: boolean
  className?: string
}

const WIDTH: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

/** Tope: el zoom de Electron agranda el CSS; 100dvh es la ventana visible. */
const PANEL_CAP = 'max-h-[min(48rem,calc(100dvh-2rem))]'

const FRAME: Record<ModalFrame, string> = {
  hug: PANEL_CAP,
  workspace: `h-[min(44rem,calc(100dvh-2rem))] ${PANEL_CAP}`,
}

const BODY =
  'min-h-0 min-w-0 flex-auto overflow-y-auto overscroll-contain px-5 py-4 text-ink'

export function Modal({
  open,
  onClose,
  title,
  header,
  children,
  footer,
  size = 'md',
  frame = 'hug',
  closeOnOverlay = true,
  closeOnEscape = true,
  className,
}: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const suggestLayerRef = useRef<HTMLElement | null>(null)
  const dismiss = useModalDismiss(onClose, {
    escape: open && closeOnEscape,
    overlay: open && closeOnOverlay,
  })

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    panelRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [open])

  if (!open) return null

  const heading = header ?? (
    title != null && title !== '' ? (
      <>
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-ink" title={typeof title === 'string' ? title : undefined}>
          {title}
        </h2>
        <ModalCloseButton onClick={onClose} />
      </>
    ) : null
  )

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-overlay-fade"
      role="presentation"
    >
      <div
        data-modal-overlay=""
        className={cx('absolute inset-0 bg-overlay', !closeOnOverlay && 'pointer-events-none')}
        {...(closeOnOverlay ? dismiss : undefined)}
      />
      <ModalSuggestLayerContext.Provider value={suggestLayerRef}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={header == null && title != null && title !== '' ? titleId : undefined}
        aria-label={header != null && typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cx(
          'relative z-10 flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl bg-panel',
          'shadow-[0_12px_40px_rgba(28,28,30,0.16)] outline-none animate-modal-enter modal-panel-grow',
          FRAME[frame],
          WIDTH[size],
          className,
        )}
      >
        {heading != null && (
          <div className="relative z-20 flex shrink-0 min-w-0 items-center gap-2 border-b border-line px-5 py-3.5">
            {heading}
          </div>
        )}
        {children != null && children !== false && (
          <div className="relative flex min-h-0 min-w-0 flex-auto flex-col overflow-hidden">
            <div className={BODY}>
              {children}
            </div>
            <div
              ref={node => { suggestLayerRef.current = node }}
              className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
            />
          </div>
        )}
        {footer != null && (
          <div className={cx(
            'relative z-20 flex shrink-0 items-center justify-end gap-2 px-5 py-3',
            children != null && children !== false && 'border-t border-line',
          )}>
            {footer}
          </div>
        )}
      </div>
      </ModalSuggestLayerContext.Provider>
    </div>,
    document.body,
  )
}
