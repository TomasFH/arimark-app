import { createContext, useContext, useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx'

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
  children: ReactNode
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
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    panelRef.current?.focus()

    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !closeOnEscape) return
      event.stopPropagation()
      onCloseRef.current()
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [open, closeOnEscape])

  if (!open) return null

  const heading = header ?? (
    title != null && title !== '' ? (
      <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-ink" title={typeof title === 'string' ? title : undefined}>
        {title}
      </h2>
    ) : null
  )

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-overlay-fade"
      role="presentation"
    >
      <div
        className={cx('absolute inset-0 bg-overlay', !closeOnOverlay && 'pointer-events-none')}
        onClick={closeOnOverlay ? onClose : undefined}
      />
      <ModalSuggestLayerContext.Provider value={suggestLayerRef}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title != null && header == null ? titleId : undefined}
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
        <div className="relative flex min-h-0 min-w-0 flex-auto flex-col overflow-hidden">
          <div className={BODY}>
            {children}
          </div>
          <div
            ref={node => { suggestLayerRef.current = node }}
            className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
          />
        </div>
        {footer != null && (
          <div className="relative z-20 flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        )}
      </div>
      </ModalSuggestLayerContext.Provider>
    </div>,
    document.body,
  )
}
