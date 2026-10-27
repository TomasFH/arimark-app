/**
 * Precio de una sola venta cuando el PLU está en 0 en la lista.
 * No escribe el catálogo. Cerrar no agrega la línea.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import NumericInput from './NumericInput'
import { Button, Modal } from './ui'
import { buildItemFromBarcode } from '../lib/barcodeItem'
import { formatARS, formatKg } from '../lib/datetime'
import { parseNumericInput } from '../lib/numericInput'
import type { ProductRow } from '../types/hw-api'

interface Props {
  product: ProductRow
  /** Importe del ticket, en pesos. */
  ticketTotal: number
  onConfirm: (unitPrice: number) => void
  onClose: () => void
}

function kilosUsables(weightKg: number): boolean {
  return Math.round(weightKg * 1000) / 1000 > 0
}

export default function OpenPriceModal({ product, ticketTotal, onConfirm, onClose }: Props) {
  const [priceRaw, setPriceRaw] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const perUnit = product.unit === 'unit'
  const priceLabel = perUnit ? 'Precio por unidad ($)' : 'Precio por kilo ($)'

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const typed = parseNumericInput(priceRaw)
  const preview = typed != null && typed > 0
    ? buildItemFromBarcode(product.pluNumber, ticketTotal, product, typed)
    : null
  const detail = preview == null
    ? ''
    : preview.unit === 'unit'
      ? `${Math.round(preview.weightKg)} u. × ${formatARS(preview.unitPrice)}/u.`
      : `${formatKg(preview.weightKg)} @ ${formatARS(preview.unitPrice)}/kg`

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (typed == null || typed <= 0) {
      setError('Ingresá un precio entero mayor a cero.')
      inputRef.current?.focus()
      return
    }
    const item = buildItemFromBarcode(product.pluNumber, ticketTotal, product, typed)
    if (product.unit === 'kg' && !kilosUsables(item.weightKg)) {
      setError('Ese precio no deja kilos en el ticket. Ingresá un precio menor.')
      inputRef.current?.focus()
      return
    }
    setError('')
    onConfirm(typed)
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Precio de esta venta"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="open-price-form">
            Agregar
          </Button>
        </>
      )}
    >
      <form id="open-price-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink" title={product.name}>
            {product.name}
          </p>
          <p className="mt-1 text-xs text-muted">Vale solo para este ticket.</p>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs text-muted">Total del ticket</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
            {formatARS(Math.round(ticketTotal))}
          </span>
        </div>

        <div>
          <label htmlFor={inputId} className="mb-1 block text-xs text-muted">
            {priceLabel}
          </label>
          <NumericInput
            id={inputId}
            ref={inputRef}
            value={priceRaw}
            onChange={value => {
              setPriceRaw(value)
              setError('')
            }}
            autoComplete="off"
            placeholder=""
            className="w-full rounded-lg border border-line bg-input px-3 py-2 text-sm text-ink placeholder:text-subtle focus:border-line-accent focus:outline-none"
          />
          {error && (
            <p className="mt-1.5 text-xs text-danger" role="alert">
              {error}
            </p>
          )}
        </div>

        {preview && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-raised px-3 py-2.5">
            <p className="min-w-0 truncate text-xs text-muted" title={detail}>
              {detail}
            </p>
            <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
              {formatARS(preview.subtotal)}
            </p>
          </div>
        )}
      </form>
    </Modal>
  )
}
