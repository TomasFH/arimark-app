import { useCallback, useState, type KeyboardEvent } from 'react'
import { searchProductsByQuery } from '@carniceria/shared'
import { formatARS } from '../lib/datetime'
import type { ProductRow } from '../types/hw-api'

interface Props {
  products: ProductRow[]
  onAssign: (product: ProductRow) => void
}

function markedIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return ((index % count) + count) % count
}

/** Typeahead por nombre o PLU desde el primer carácter. */
export default function CatalogAssignField({ products, onAssign }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const suggestions = searchProductsByQuery(products, query, {
    nameOf: product => product.name,
    pluOf: product => product.pluNumber,
  })
  const listOpen = open && suggestions.length > 0
  const current = markedIndex(highlight, suggestions.length)

  const scrollMarkedRow = useCallback((node: HTMLLIElement | null) => {
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  function assign(product: ProductRow): void {
    onAssign(product)
    setQuery('')
    setOpen(false)
    setHighlight(0)
  }

  // Captura: la flecha marca una fila antes de que el campo mueva el cursor.
  function handleKeyDownCapture(event: KeyboardEvent<HTMLInputElement>): void {
    if (!listOpen) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setHighlight(index => markedIndex(markedIndex(index, suggestions.length) + step, suggestions.length))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const pick = suggestions[current]
      if (pick) assign(pick)
    }
  }

  return (
    <div className="relative mt-1 min-w-0">
      <label className="mb-0.5 block text-[10px] text-muted">Asignar producto</label>
      <input
        type="text"
        value={query}
        maxLength={40}
        autoComplete="off"
        onChange={event => {
          setQuery(event.target.value)
          setOpen(true)
          setHighlight(0)
        }}
        onFocus={() => query.trim() && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDownCapture={handleKeyDownCapture}
        className="w-full min-w-0 rounded-md border border-line bg-app px-2 py-1 text-xs text-ink focus:border-line-accent focus:outline-none"
      />
      {listOpen && (
        <ul className="mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-line bg-panel">
          {suggestions.map((product, index) => {
            const marked = index === current
            return (
              <li
                key={product.id}
                ref={marked ? scrollMarkedRow : undefined}
                data-assign-marked={marked ? 'true' : undefined}
                className={`w-full ${marked ? 'bg-accent-soft' : ''}`}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={() => assign(product)}
                  onMouseEnter={() => setHighlight(index)}
                  className={`flex w-full min-w-0 items-center gap-1 px-2 py-1.5 text-left ${
                    marked ? 'bg-accent-soft' : 'hover:bg-hover'
                  }`}
                >
                  <span className="shrink-0 text-[10px] font-bold text-muted">{product.pluNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-[10px] text-ink" title={product.name}>
                    {product.name}
                  </span>
                  {product.price != null && (
                    <span className="shrink-0 text-[10px] text-muted">
                      {formatARS(product.price)}/{product.unit === 'unit' ? 'u.' : 'kg'}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
