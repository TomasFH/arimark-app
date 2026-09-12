import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
  children: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg shadow-[0_1px_2px_rgba(28,28,30,0.18)] hover:bg-[color-mix(in_srgb,var(--accent)_86%,black)] active:bg-[color-mix(in_srgb,var(--accent)_76%,black)]',
  secondary:
    'bg-panel text-ink border border-line hover:bg-hover active:bg-hover',
  ghost:
    'bg-transparent text-ink hover:bg-hover active:bg-hover',
  danger:
    'bg-danger text-accent-fg shadow-[0_1px_2px_rgba(28,28,30,0.18)] hover:bg-[color-mix(in_srgb,var(--danger)_86%,black)] active:bg-[color-mix(in_srgb,var(--danger)_76%,black)]',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-base gap-2 rounded-xl',
}

function Spinner({ className }: { className: string }) {
  return (
    <svg className={cx('animate-spin shrink-0', className)} viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle className="opacity-25" cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2.5" />
      <path className="opacity-90" d="M18 10a8 8 0 0 0-8-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    disabled,
    className,
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center font-semibold tracking-tight transition-colors duration-150',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANT[variant],
        SIZE[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      {children}
    </button>
  )
})
