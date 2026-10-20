/**
 * Consulta de PLU sobre la caja. No vende ni confirma el modal de abajo.
 * El listener vive acá, una sola vez, en fase capture sobre window:
 * corre antes que los atajos de document (cobro, pedido, bolsas).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { searchProductsByQuery } from '@carniceria/shared'
import type { AdminProductRow } from '../types/hw-api'
import { formatARS } from '../lib/datetime'
import { useCatalogSyncReload } from '../lib/useCatalogSyncReload'
import { ModalCloseButton, cx } from './ui'

interface Props {
  /** Sin local de sesión el atajo no abre. */
  storeId: string | null
}

function isCatalogFindShortcut(event: KeyboardEvent): boolean {
  if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false
  if (event.key !== 'f' && event.key !== 'F') return false
  if (event.code && event.code !== 'KeyF') return false
  return true
}

function saleUnitLabel(unit: AdminProductRow['unit']): string {
  return unit === 'unit' ? 'por unidad' : 'por kg'
}

/** Mismo orden que el catálogo: PLU, nombre, y precio con la unidad en un solo track. */
const RESULT_ROW =
  'grid grid-cols-[3.25rem_minmax(0,1fr)_13rem] items-center gap-x-2 min-w-0 rounded-lg px-2.5 py-2'

export default function CatalogQuickSearch({ storeId }: Props) {
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listBodyRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const openRef = useRef(false)
  const storeIdRef = useRef(storeId)
  const countRef = useRef(0)
  const requestTicket = useRef(0)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [marked, setMarked] = useState(0)
  const [products, setProducts] = useState<AdminProductRow[]>([])
  const [listHeight, setListHeight] = useState(0)

  storeIdRef.current = storeId

  const loadCatalog = useCallback(() => {
    const id = storeIdRef.current
    if (!id || typeof window.hw?.getAllProducts !== 'function') return
    const ticket = ++requestTicket.current
    void window.hw.getAllProducts(id).then(result => {
      if (ticket !== requestTicket.current || storeIdRef.current !== id) return
      if (!result.ok) return
      setProducts(result.data)
    })
  }, [])

  useEffect(() => {
    if (!storeId) {
      requestTicket.current += 1
      setProducts([])
      return
    }
    loadCatalog()
  }, [storeId, loadCatalog])

  useCatalogSyncReload(loadCatalog)

  const closeSearch = useCallback(() => {
    openRef.current = false
    setOpen(false)
    setQuery('')
    setMarked(0)
    setListHeight(0)
    const prev = previousFocus.current
    previousFocus.current = null
    if (prev && document.contains(prev)) prev.focus()
  }, [])

  const openSearch = useCallback(() => {
    const current = document.activeElement
    previousFocus.current = current instanceof HTMLElement ? current : null
    setQuery('')
    setMarked(0)
    openRef.current = true
    setOpen(true)
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isCatalogFindShortcut(event)) {
        if (!storeIdRef.current) return
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat) return
        if (openRef.current) closeSearch()
        else openSearch()
        return
      }

      if (!openRef.current) return

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeSearch()
        return
      }

      if (event.key === 'Enter' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (
        (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        && !event.altKey && !event.ctrlKey && !event.metaKey
      ) {
        event.preventDefault()
        event.stopPropagation()
        const count = countRef.current
        if (count === 0) return
        const step = event.key === 'ArrowDown' ? 1 : -1
        setMarked(index => {
          const current = Math.min(index, count - 1)
          return Math.min(count - 1, Math.max(0, current + step))
        })
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeSearch, openSearch])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
  }, [open])

  const results = useMemo(() => {
    if (!query.trim()) return []
    return searchProductsByQuery(products, query, {
      nameOf: product => product.name,
      pluOf: product => product.pluNumber ?? Number.NaN,
    })
  }, [products, query])

  countRef.current = results.length
  const markedIndex = results.length === 0 ? 0 : Math.min(marked, results.length - 1)

  useEffect(() => {
    if (!open) return
    const row = listRef.current?.querySelector<HTMLElement>('[data-catalog-marked="true"]')
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [open, markedIndex, results])

  useEffect(() => {
    if (!open) return
    const node = listBodyRef.current
    if (!node) return
    const measure = () => {
      const next = query.trim() ? node.scrollHeight : 0
      setListHeight(current => (Math.abs(current - next) < 1 ? current : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [open, query, results])

  if (!open) return null

  const trimmed = query.trim()

  return createPortal(
    <div className="fixed inset-0 z-[100] animate-overlay-fade">
      <div className="absolute inset-0 bg-overlay" aria-hidden />
      <div
        className="absolute inset-0 bg-overlay"
        data-catalog-search-backdrop=""
        onMouseDown={event => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          closeSearch()
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute left-1/2 top-[12vh] z-10 flex w-[min(40rem,calc(100%-2rem))] min-w-0 -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_12px_40px_rgba(28,28,30,0.16)]"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-ink">
            Buscar en el catálogo
          </h2>
          <ModalCloseButton onClick={closeSearch} />
        </div>

        <div className="shrink-0 px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={event => {
              setQuery(event.target.value)
              setMarked(0)
            }}
            placeholder="Nombre o PLU"
            aria-label="Nombre o PLU"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-line-strong bg-input px-3 py-2 text-sm text-ink placeholder:text-muted"
          />
        </div>

        <div
          className="grid height-reveal motion-reduce:transition-none"
          style={{ gridTemplateRows: `${listHeight}px` }}
        >
          <div className="min-h-0 overflow-hidden">
            <div ref={listBodyRef}>
              {trimmed !== '' && results.length === 0 && (
                <p className="border-t border-line px-4 py-3 text-sm text-ink">Ningún producto</p>
              )}

              {results.length > 0 && (
                <ul
                  ref={listRef}
                  aria-label="Resultados"
                  className="max-h-[min(20rem,50vh)] overflow-y-auto overscroll-contain border-t border-line p-1"
                >
                  {results.map((product, index) => {
                    const isMarked = index === markedIndex
                    const price = product.price != null ? formatARS(product.price) : 'Sin precio'
                    return (
                      <li
                        key={product.id}
                        data-catalog-marked={isMarked ? 'true' : undefined}
                        className={cx(
                          RESULT_ROW,
                          'border-b border-line last:border-b-0',
                          isMarked ? 'bg-accent-soft' : 'hover:bg-hover',
                          product.available ? 'text-ink' : 'text-muted',
                        )}
                      >
                        <span className="text-right font-mono text-base font-semibold tabular-nums text-muted">
                          {product.pluNumber ?? ''}
                        </span>
                        <span
                          className={cx(
                            'min-w-0 truncate pl-4 text-sm',
                            product.available && 'text-ink',
                          )}
                          title={product.name}
                        >
                          {product.name}
                        </span>
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="whitespace-nowrap text-left font-mono text-sm tabular-nums">
                            {price}
                          </span>
                          <span className="shrink-0 whitespace-nowrap text-sm">
                            {saleUnitLabel(product.unit)}
                          </span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
