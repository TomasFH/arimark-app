import type { SVGAttributes } from 'react'
import { cx } from './cx'

export interface BrandMarkProps extends SVGAttributes<SVGSVGElement> {
  size?: number
}

/**
 * Sello geométrico neutro (hexágono). Reemplaza el emoji de carne.
 * No contiene nombre ni marca de cliente.
 */
export function BrandMark({ size = 32, className, ...rest }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cx('shrink-0', className)}
      {...rest}
    >
      <rect width="32" height="32" rx="8" fill="var(--bg-accent-soft)" />
      <path
        d="M16 6.5 24.5 11.4v9.2L16 25.5l-8.5-4.9v-9.2L16 6.5Z"
        fill="var(--accent)"
      />
      <path
        d="M16 11.2 20.4 13.7v5.1L16 21.3l-4.4-2.5v-5.1L16 11.2Z"
        fill="var(--accent-fg)"
        fillOpacity="0.22"
      />
    </svg>
  )
}
