import { useEffect, useMemo, useRef, useState } from 'react'
import { bagQuantityInCart } from '../lib/bags'
import { formatARS } from '../lib/datetime'
import type { ProductRow } from '../types/hw-api'

interface Line {
  productId: string | null
  weightKg: number
  unit: 'kg' | 'unit'
}

interface Props {
  products: ProductRow[]
  lines: readonly Line[]
  onAdd: (product: ProductRow, quantity: number) => void
  onRemove: (productId: string, quantity: number) => void
  /** F7 y las flechas. Apagado cuando otro panel de bolsas está delante. */
  shortcuts?: boolean
}

const stepButtonClass =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-ink transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40'

function listPrice(product: ProductRow): number | null {
  const price = product.price
  if (price == null || !(price > 0)) return null
  return price
}

function quantityLabel(unit: 'kg' | 'unit', quantity: number): string {
  if (unit === 'unit') return String(Math.round(quantity))
  return quantity.toLocaleString('es-AR', { maximumFractionDigits: 3 })
}

function markedIndex(index: number, count: number): number {
  if (count <= 0) return 0
  const normalized = ((index % count) + count) % count
  return normalized
}

export default function BagsPanel({ products, lines, onAdd, onRemove, shortcuts = true }: Props) {
  const bags = useMemo(
    () => products.filter(product => product.category === 'bags'),
    [products],
  )
  const [open, setOpen] = useState(false)
  const [marked, setMarked] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const stateRef = useRef({ open, bags, lines, marked, onAdd, onRemove })
  stateRef.current = { open, bags, lines, marked, onAdd, onRemove }
  const current = markedIndex(marked, bags.length)

  useEffect(() => {
    if (!shortcuts) return
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const state = stateRef.current
      if (event.key === 'F7') {
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat) return
        setOpen(value => !value)
        return
      }
      if (!state.open) return
      const count = state.bags.length
      const index = markedIndex(state.marked, count)
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        if (count === 0) return
        const step = event.key === 'ArrowDown' ? 1 : -1
        setMarked(markedIndex(index + step, count))
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat) return
        const product = state.bags[index]
        if (!product || listPrice(product) == null) return
        state.onAdd(product, 1)
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat) return
        const product = state.bags[index]
        if (!product || bagQuantityInCart(state.lines, product.id) <= 0) return
        state.onRemove(product.id, 1)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [shortcuts])

  useEffect(() => {
    if (!open) return
    const row = listRef.current?.querySelector<HTMLElement>('[data-bag-marked="true"]')
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [open, current])

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-keyshortcuts="F7"
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
          open
            ? 'border-accent bg-accent-soft text-ink'
            : 'border-line bg-panel text-ink hover:bg-hover'
        }`}
      >
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
        </svg>
        <span className="whitespace-nowrap">
          Añadir bolsas <span className="font-medium text-muted" aria-hidden>(F7)</span>
        </span>
      </button>
      {open && (
        <div className="mt-2 min-w-0 rounded-lg border border-line bg-raised">
          {bags.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-muted">No hay bolsas en el catálogo.</p>
          ) : (
            <ul ref={listRef} aria-label="Bolsas" className="max-h-48 min-w-0 space-y-0.5 overflow-y-auto p-1">
              {bags.map((product, index) => {
                const price = listPrice(product)
                const inCart = bagQuantityInCart(lines, product.id)
                const canAdd = price != null
                const canRemove = inCart > 0
                return (
                  <li
                    key={product.id}
                    data-bag-marked={index === current ? 'true' : undefined}
                    className={`flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 ${
                      index === current ? 'bg-accent-soft' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink" title={product.name}>
                      {product.name}
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                      {price != null ? formatARS(price) : 'Sin precio'}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className={stepButtonClass}
                        aria-label={`Sacar ${product.name}`}
                        disabled={!canRemove}
                        onClick={() => {
                          if (inCart <= 0) return
                          onRemove(product.id, 1)
                        }}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <path strokeLinecap="round" d="M6 12h12" />
                        </svg>
                      </button>
                      <span
                        className="w-7 text-center font-mono text-sm font-semibold tabular-nums text-ink"
                        aria-label={`Cantidad de ${product.name}`}
                      >
                        {quantityLabel(product.unit, inCart)}
                      </span>
                      <button
                        type="button"
                        className={stepButtonClass}
                        aria-label={`Sumar ${product.name}`}
                        title={canAdd ? undefined : 'Sin precio de lista'}
                        disabled={!canAdd}
                        onClick={() => {
                          if (price == null) return
                          onAdd(product, 1)
                        }}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <path strokeLinecap="round" d="M12 6v12M6 12h12" />
                        </svg>
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
