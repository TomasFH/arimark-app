import type { ReactNode } from 'react'
import { BrandMark } from './BrandMark'

export interface ScreenHeaderProps {
  title: string
  subtitle?: string
  onBack?: () => void
  mark?: boolean
  actions?: ReactNode
}

export function ScreenHeader({ title, subtitle, onBack, mark = false, actions }: ScreenHeaderProps) {
  return (
    <header className="flex min-w-0 w-full shrink-0 items-center gap-3 border-b border-line bg-panel px-6 py-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          title="Volver"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {mark && <BrandMark size={32} className="shrink-0" />}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold tracking-tight text-ink" title={title}>
          {title}
        </h1>
        {subtitle != null && subtitle !== '' && (
          <p className="truncate text-xs text-muted" title={subtitle}>
            {subtitle}
          </p>
        )}
      </div>
      {actions != null && (
        <div className="flex shrink-0 items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  )
}
