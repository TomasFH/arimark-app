/**
 * Modo de emergencia: ingreso de ítems cuando la balanza no está disponible.
 *
 * Pestaña "Barcode": la cajera escanea (o tipea) el código EAN-13 del ticket físico.
 *   El parser extrae PLU + precio total y genera un ScaleOrder sintético.
 *   Formato: 13 dígitos, prefijo "20" → 20[PLU 3 dig][precio_cts 7 dig][check]
 *
 * Pestaña "Manual": la cajera ingresa el número PLU + precio total en pesos.
 *   Útil cuando no hay lector de código de barras disponible.
 *
 * En ambos casos el ScaleOrder sintético se agrega directamente a la cola
 * sin pasar por hardware ni IPC.
 */

import { useRef, useState } from 'react'
import { parseKretzBarcode, centsToARS } from '../lib/kretzBarcode'
import NumericInput from './NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import type { ScaleOrder } from '../types/hw-api'
import { formatARS } from '../lib/datetime'

type Tab = 'barcode' | 'manual'

interface Props {
  onOrder: (order: ScaleOrder) => void
}

function buildSyntheticOrder(pluNumber: string, totalARS: number): ScaleOrder {
  return {
    channel: 'A',
    items: [
      {
        productCode: String(parseInt(pluNumber, 10)),
        productName: `PLU ${parseInt(pluNumber, 10)}`,
        weightKg: 1,
        unitPrice: totalARS,
        subtotal: totalARS,
      },
    ],
    total: totalARS,
    timestamp: new Date().toISOString(),
  }
}

export default function EmergencyBarcodeInput({ onOrder }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('barcode')

  // --- Barcode state ---
  const [barcode, setBarcode] = useState('')
  const [barcodeError, setBarcodeError] = useState('')
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  // --- Manual state ---
  const [pluRaw, setPluRaw] = useState('')
  const [priceRaw, setPriceRaw] = useState('')
  const [manualError, setManualError] = useState('')

  function handleToggle() {
    setOpen(prev => {
      const next = !prev
      if (next) {
        resetAll()
        if (tab === 'barcode') {
          setTimeout(() => barcodeInputRef.current?.focus(), 50)
        }
      }
      return next
    })
  }

  function resetAll() {
    setBarcode('')
    setBarcodeError('')
    setPluRaw('')
    setPriceRaw('')
    setManualError('')
  }

  function handleTabChange(next: Tab) {
    setTab(next)
    resetAll()
    if (next === 'barcode') {
      setTimeout(() => barcodeInputRef.current?.focus(), 50)
    }
  }

  // ── Barcode ──────────────────────────────────────────────────────────────

  function submitBarcode(raw: string) {
    setBarcodeError('')
    const parsed = parseKretzBarcode(raw.trim())
    if (!parsed) {
      setBarcodeError('Código inválido. Verificar que sea el código del ticket KRETZ (13 dígitos).')
      return
    }
    onOrder(buildSyntheticOrder(parsed.pluNumber, centsToARS(parsed.totalCents)))
    setBarcode('')
    setOpen(false)
  }

  function handleBarcodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    setBarcode(raw)
    setBarcodeError('')

    // Auto-submit cuando la lectora depositó exactamente 13 dígitos
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 13) {
      const parsed = parseKretzBarcode(digits)
      if (parsed) {
        onOrder(buildSyntheticOrder(parsed.pluNumber, centsToARS(parsed.totalCents)))
        setBarcode('')
        setOpen(false)
      }
    }
  }

  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    submitBarcode(barcode)
  }

  const barcodePreview = (() => {
    const parsed = parseKretzBarcode(barcode.trim())
    if (!parsed) return null
    return { plu: parseInt(parsed.pluNumber, 10), total: centsToARS(parsed.totalCents) }
  })()

  // ── Manual ───────────────────────────────────────────────────────────────

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    setManualError('')

    const plu = parseNumericInput(pluRaw)
    const price = parseNumericInput(priceRaw)

    if (plu === null || plu <= 0 || plu > 999) {
      setManualError('Número PLU inválido (debe ser entre 1 y 999).')
      return
    }
    if (price === null || price <= 0) {
      setManualError('Precio inválido. Ingresá el monto en pesos enteros.')
      return
    }

    onOrder(buildSyntheticOrder(String(plu), price))
    setPluRaw('')
    setPriceRaw('')
    setOpen(false)
  }

  // ── Render ───────────────────────────────────────────────────────────────

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
        {open ? '▲ Cerrar ingreso de emergencia' : '⚡ Ingreso sin balanza'}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {/* Tabs */}
          <div className="flex rounded-md overflow-hidden border border-gray-700 text-[10px] font-semibold">
            <button
              type="button"
              onClick={() => handleTabChange('barcode')}
              className={`flex-1 py-1 transition-colors ${
                tab === 'barcode'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-900 text-gray-400 hover:text-gray-200'
              }`}
            >
              Código de barras
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('manual')}
              className={`flex-1 py-1 transition-colors ${
                tab === 'manual'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-900 text-gray-400 hover:text-gray-200'
              }`}
            >
              PLU + precio
            </button>
          </div>

          {tab === 'barcode' && (
            <form onSubmit={handleBarcodeSubmit} className="space-y-2">
              <p className="text-[10px] text-gray-500 leading-snug">
                Escaneá o ingresá el código del ticket KRETZ (13 dígitos).
              </p>
              <input
                ref={barcodeInputRef}
                type="text"
                inputMode="numeric"
                value={barcode}
                onChange={handleBarcodeChange}
                placeholder="2001060000012"
                className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
              />
              {barcodePreview && (
                <p className="text-[10px] text-green-400">
                  PLU {barcodePreview.plu} · {formatARS(barcodePreview.total)}
                </p>
              )}
              {barcodeError && (
                <p className="text-[10px] text-red-400">{barcodeError}</p>
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

          {tab === 'manual' && (
            <form onSubmit={handleManualSubmit} className="space-y-2">
              <p className="text-[10px] text-gray-500 leading-snug">
                Ingresá el número PLU del producto y el precio total en pesos.
              </p>
              <div className="flex gap-2">
                <div className="w-20 shrink-0">
                  <label className="block text-[9px] text-gray-500 mb-0.5">PLU</label>
                  <NumericInput
                    value={pluRaw}
                    onChange={v => { setPluRaw(v); setManualError('') }}
                    placeholder="ej. 5"
                    className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[9px] text-gray-500 mb-0.5">Precio total ($)</label>
                  <NumericInput
                    value={priceRaw}
                    onChange={v => { setPriceRaw(v); setManualError('') }}
                    placeholder="ej. 17.535"
                    className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>
              {priceRaw && parseNumericInput(priceRaw) !== null && parseNumericInput(pluRaw) !== null && (
                <p className="text-[10px] text-green-400">
                  PLU {parseNumericInput(pluRaw)} · {formatARS(parseNumericInput(priceRaw)!)}
                </p>
              )}
              {manualError && (
                <p className="text-[10px] text-red-400">{manualError}</p>
              )}
              <button
                type="submit"
                disabled={!pluRaw.trim() || !priceRaw.trim()}
                className="w-full rounded-md bg-orange-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
              >
                Agregar a la cola
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
