/**
 * Modo de emergencia: ingreso manual de tickets KRETZ cuando la balanza
 * no está disponible o no hay conexión.
 *
 * La cajera escanea (o tipea) el código de barras del ticket físico.
 * El parser extrae PLU + precio total y genera un ScaleOrder sintético
 * que se agrega directamente a la cola sin pasar por hardware ni IPC.
 *
 * Formato esperado: 13 dígitos EAN-13, prefijo "20"
 *   20 [PLU 3 dig] [precio_centavos 7 dig] [check EAN-13]
 */

import { useRef, useState } from 'react'
import { parseKretzBarcode, centsToARS } from '../lib/kretzBarcode'
import type { ScaleOrder } from '../types/hw-api'
import { formatARS } from '../lib/datetime'

interface Props {
  onOrder: (order: ScaleOrder) => void
}

export default function EmergencyBarcodeInput({ onOrder }: Props) {
  const [open, setOpen] = useState(false)
  const [barcode, setBarcode] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function handleToggle() {
    setOpen(prev => {
      const next = !prev
      if (next) {
        setBarcode('')
        setError('')
        setTimeout(() => inputRef.current?.focus(), 50)
      }
      return next
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const parsed = parseKretzBarcode(barcode.trim())
    if (!parsed) {
      setError('Código inválido. Verificar que sea el código del ticket KRETZ (13 dígitos).')
      return
    }

    const order: ScaleOrder = {
      channel: 'A',
      items: [
        {
          productCode: parsed.pluNumber,
          productName: `PLU ${parseInt(parsed.pluNumber, 10)}`,
          // Precio total del barcode tratado como "1 unidad al precio total"
          weightKg: 1,
          unitPrice: centsToARS(parsed.totalCents),
          subtotal: centsToARS(parsed.totalCents),
        },
      ],
      total: centsToARS(parsed.totalCents),
      timestamp: new Date().toISOString(),
    }

    onOrder(order)
    setBarcode('')
    setOpen(false)
  }

  function handleBarcodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    setBarcode(raw)
    setError('')

    // Auto-submit si la lectora envió exactamente 13 dígitos (sin Enter)
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 13) {
      const parsed = parseKretzBarcode(digits)
      if (parsed) {
        const order: ScaleOrder = {
          channel: 'A',
          items: [
            {
              productCode: parsed.pluNumber,
              productName: `PLU ${parseInt(parsed.pluNumber, 10)}`,
              weightKg: 1,
              unitPrice: centsToARS(parsed.totalCents),
              subtotal: centsToARS(parsed.totalCents),
            },
          ],
          total: centsToARS(parsed.totalCents),
          timestamp: new Date().toISOString(),
        }
        onOrder(order)
        setBarcode('')
        setOpen(false)
        return
      }
    }
  }

  const preview = (() => {
    const parsed = parseKretzBarcode(barcode.trim())
    if (!parsed) return null
    return { plu: parseInt(parsed.pluNumber, 10), total: centsToARS(parsed.totalCents) }
  })()

  return (
    <div className="border-t border-gray-800 px-3 py-2">
      <button
        type="button"
        onClick={handleToggle}
        className={`w-full rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
          open
            ? 'border-orange-500 bg-orange-500/10 text-orange-300'
            : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-orange-500/50 hover:text-orange-300'
        }`}
      >
        {open ? '▲ Cerrar ingreso de emergencia' : '⚡ Escanear ticket (sin balanza)'}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="mt-2 space-y-2">
          <p className="text-[10px] text-gray-500 leading-snug">
            Posicioná la lectora sobre el código del ticket e ingresá o escanéalo.
          </p>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={barcode}
            onChange={handleBarcodeChange}
            placeholder="Código de barras del ticket"
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
          />

          {preview && (
            <p className="text-[10px] text-green-400">
              PLU {preview.plu} · {formatARS(preview.total)}
            </p>
          )}

          {error && (
            <p className="text-[10px] text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={!barcode.trim()}
            className="w-full rounded-md bg-orange-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
          >
            Agregar a la cola
          </button>
        </form>
      )}
    </div>
  )
}
