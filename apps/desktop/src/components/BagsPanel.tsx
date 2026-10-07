import { useState } from 'react'
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

export default function BagsPanel({ products, lines, onAdd, onRemove }: Props) {
  const bags = products.filter(product => product.category === 'bags')
  const [open, setOpen] = useState(false)

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
          open
            ? 'border-accent bg-accent-soft text-ink'
            : 'border-line bg-panel text-ink hover:bg-hover'
        }`}
      >
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
        </svg>
        Añadir bolsas
      </button>
      {open && (
        <div className="mt-2 min-w-0 rounded-lg border border-line bg-raised">
          {bags.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-muted">No hay bolsas en el catálogo.</p>
          ) : (
            <ul aria-label="Bolsas" className="max-h-48 min-w-0 space-y-0.5 overflow-y-auto p-1">
              {bags.map(product => {
                const price = listPrice(product)
                const inCart = bagQuantityInCart(lines, product.id)
                const canAdd = price != null
                const canRemove = inCart > 0
                return (
                  <li key={product.id} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1">
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
