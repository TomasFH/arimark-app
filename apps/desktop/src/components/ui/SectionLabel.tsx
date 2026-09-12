import type { HTMLAttributes } from 'react'
import { cx } from './cx'

export type SectionLabelProps = HTMLAttributes<HTMLParagraphElement>

/** Etiqueta de grupo en menús y listas. No usar como kicker encima de un título de pantalla. */
export function SectionLabel({ className, children, ...rest }: SectionLabelProps) {
  const text = typeof children === 'string' ? children : undefined
  return (
    <p
      className={cx('mb-2 min-w-0 truncate text-xs font-semibold text-muted', className)}
      title={text}
      {...rest}
    >
      {children}
    </p>
  )
}
