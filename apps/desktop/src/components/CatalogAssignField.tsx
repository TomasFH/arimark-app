import { useState } from 'react'
import { searchProductsByQuery } from '@carniceria/shared'
import { formatARS } from '../lib/datetime'
import type { ProductRow } from '../types/hw-api'

interface Props {
  products: ProductRow[]
  onAssign: (product: ProductRow) => void
}

/** Typeahead por nombre o PLU desde el primer carácter. */
export default function CatalogAssignField({ products, onAssign }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const suggestions = searchProductsByQuery(products, query, {
    nameOf: product => product.name,
    pluOf: product => product.pluNumber,
  })

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
        }}
        onFocus={() => query.trim() && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full min-w-0 rounded-md border border-line bg-app px-2 py-1 text-xs text-ink focus:border-line-accent focus:outline-none"
      />
      {open && suggestions.length > 0 && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-line bg-panel">
          {suggestions.map(product => (
            <li key={product.id}>
              <button
                type="button"
                onMouseDown={() => {
                  onAssign(product)
                  setQuery('')
                  setOpen(false)
                }}
                className="flex w-full min-w-0 items-center gap-1 px-2 py-1.5 text-left hover:bg-hover"
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
          ))}
        </ul>
      )}
    </div>
  )
}
