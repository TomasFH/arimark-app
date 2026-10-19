import type { ReactNode } from 'react'
import { cx } from './cx'

export interface ListRowProps {
  title: string
  subtitle?: string
  leading?: ReactNode
  trailing?: ReactNode
  selected?: boolean
  onClick?: () => void
  disabled?: boolean
  /** Filas del menú de caja: menos alto, icono un punto más chico. */
  dense?: boolean
  /** Acción destructiva: mismo alto y peso, solo cambia el color del título. */
  tone?: 'default' | 'danger'
}

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  selected = false,
  onClick,
  disabled = false,
  dense = false,
  tone = 'default',
}: ListRowProps) {
  const content = (
    <>
      {leading != null && (
        <div className={cx('shrink-0', dense && '[&_svg]:h-4 [&_svg]:w-4')}>{leading}</div>
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cx(
            'min-w-0 truncate text-sm font-medium',
            tone === 'danger' ? 'text-danger' : 'text-ink',
          )}
          title={title}
        >
          {title}
        </p>
        {subtitle != null && subtitle !== '' && (
          <p className="min-w-0 truncate text-xs text-muted" title={subtitle}>
            {subtitle}
          </p>
        )}
      </div>
      {trailing != null && <div className="shrink-0">{trailing}</div>}
    </>
  )

  const classes = cx(
    'flex w-full min-w-0 items-center text-left transition-colors',
    dense ? 'gap-2 px-3 py-1.5' : 'gap-3 px-4 py-3',
    selected ? 'bg-accent-soft' : 'bg-transparent hover:bg-hover',
    onClick && !disabled && 'cursor-pointer',
    disabled && 'pointer-events-none opacity-40',
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={classes}>
        {content}
      </button>
    )
  }

  return <div className={classes}>{content}</div>
}
