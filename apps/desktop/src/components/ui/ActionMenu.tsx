import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx'

export interface ActionMenuItem {
  id: string
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  icon?: ReactNode
}

export interface ActionMenuProps {
  items: ActionMenuItem[]
  align?: 'start' | 'end'
  label?: string
  trigger?: ReactNode
}

const MENU_WIDTH = 224

export function ActionMenu({ items, align = 'end', label = 'Más acciones', trigger }: ActionMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const menuId = useId()

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const left = align === 'end'
      ? Math.min(window.innerWidth - MENU_WIDTH - 8, Math.max(8, rect.right - MENU_WIDTH))
      : Math.min(window.innerWidth - MENU_WIDTH - 8, Math.max(8, rect.left))
    const below = rect.bottom + 6
    const menuHeight = menuRef.current?.offsetHeight ?? 0
    const top = below + menuHeight > window.innerHeight - 8
      ? Math.max(8, rect.top - menuHeight - 6)
      : below
    setCoords({ top, left })
  }, [open, align, items.length])

  useEffect(() => {
    if (!open) return

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function close(): void {
    setOpen(false)
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(v => !v)}
        className={cx(
          'flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors',
          'hover:bg-hover hover:text-ink',
          open && 'bg-hover text-ink',
        )}
      >
        {trigger ?? (
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <circle cx="3.5" cy="8" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="12.5" cy="8" r="1.3" />
          </svg>
        )}
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-50" onClick={close} />
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            style={{ top: coords.top, left: coords.left, width: MENU_WIDTH }}
            className="fixed z-[51] overflow-hidden rounded-xl bg-panel shadow-[0_8px_28px_rgba(28,28,30,0.16)] ring-1 ring-line"
          >
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return
                  item.onSelect()
                  close()
                }}
                className={cx(
                  'flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors',
                  'disabled:pointer-events-none disabled:opacity-40',
                  index === 0 && 'rounded-t-xl',
                  index === items.length - 1 && 'rounded-b-xl',
                  item.danger ? 'text-danger hover:bg-hover' : 'text-ink hover:bg-hover',
                )}
              >
                {item.icon != null && <span className="shrink-0">{item.icon}</span>}
                <span className="min-w-0 flex-1 truncate" title={item.label}>{item.label}</span>
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
