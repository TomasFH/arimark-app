import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { StoreRow } from '../types/hw-api'

interface Props {
  id?: string
  stores: StoreRow[]
  value: string
  onChange: (storeId: string) => void
}

const ALL = 'Todos los locales'

export default function HistoryStoreSelect({ id, stores, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const selectedName = value === 'all'
    ? ALL
    : stores.find(store => store.id === value)?.name ?? 'Local'

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('es')
    if (!needle) return stores
    return stores.filter(store => store.name.toLocaleLowerCase('es').includes(needle))
  }, [query, stores])

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function choose(storeId: string) {
    onChange(storeId)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative z-20">
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(current => !current)}
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-input px-2.5 text-left text-sm text-ink hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="min-w-0 flex-1 truncate" title={selectedName}>{selectedName}</span>
        <svg className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] overflow-hidden rounded-lg border border-line bg-panel shadow-[0_8px_24px_rgba(28,28,30,0.16)]">
          <div className="border-b border-line p-2">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Buscar local"
              aria-label="Buscar local"
              className="h-8 w-full rounded-md border border-line bg-input px-2 text-sm text-ink placeholder:text-subtle focus:border-line-accent focus:outline-none"
            />
          </div>
          <ul id={listId} role="listbox" aria-label="Locales" className="max-h-60 overflow-y-auto py-1">
            <StoreOption
              name={ALL}
              selected={value === 'all'}
              onChoose={() => choose('all')}
            />
            {visible.map(store => (
              <StoreOption
                key={store.id}
                name={store.name}
                selected={value === store.id}
                onChoose={() => choose(store.id)}
              />
            ))}
            {visible.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted">Ningún local con ese nombre</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function StoreOption({ name, selected, onChoose }: { name: string; selected: boolean; onChoose: () => void }) {
  return (
    <li role="presentation">
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onChoose}
        className={`flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover ${
          selected ? 'bg-accent-soft text-ink' : 'text-ink'
        }`}
      >
        <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
        {selected && (
          <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M5 10.5l3 3 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </li>
  )
}
