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
}

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  selected = false,
  onClick,
  disabled = false,
}: ListRowProps) {
  const content = (
    <>
      {leading != null && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <p className="min-w-0 truncate text-sm font-medium text-ink" title={title}>
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
    'flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors',
    selected ? 'bg-accent-soft' : 'bg-panel hover:bg-hover',
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
