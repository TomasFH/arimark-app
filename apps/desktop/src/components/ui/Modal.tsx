import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  header?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: ModalSize
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

export function Modal({
  open,
  onClose,
  title,
  header,
  children,
  footer,
  size = 'md',
  closeOnOverlay = true,
  closeOnEscape = true,
  className,
}: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
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
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title != null && header == null ? titleId : undefined}
        tabIndex={-1}
        className={cx(
          'relative z-10 flex w-full min-w-0 max-h-[min(90vh,44rem)] flex-col overflow-hidden rounded-2xl bg-panel',
          'shadow-[0_12px_40px_rgba(28,28,30,0.16)] outline-none animate-modal-enter',
          WIDTH[size],
          className,
        )}
      >
        {heading != null && (
          <div className="flex min-w-0 items-center gap-2 border-b border-line px-5 py-3.5">
            {heading}
          </div>
        )}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4 text-ink">
          {children}
        </div>
        {footer != null && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
