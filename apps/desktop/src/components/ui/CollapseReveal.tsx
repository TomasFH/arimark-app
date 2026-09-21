import type { ReactNode } from 'react'
import { cx } from './cx'

/**
 * Estira o contrae un bloque en el flujo (misma curva que .modal-panel-grow).
 */
export function CollapseReveal({
  open,
  children,
  className,
}: {
  open: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div
      ref={(node) => {
        if (node) node.inert = !open
      }}
      className={cx(
        'grid height-reveal motion-reduce:transition-none',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
      aria-hidden={!open}
    >
      <div className={cx('min-h-0 overflow-hidden', !open && 'pointer-events-none', className)}>
        {children}
      </div>
    </div>
  )
}
