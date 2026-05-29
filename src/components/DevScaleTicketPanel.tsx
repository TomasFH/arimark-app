import { useState } from 'react'
import NumericInput from './NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import type { ScaleChannel } from '../types/hw-api'

/** Productos del seed sandbox — códigos de barcode KRETZ (P001…). */
const DEV_SCALE_PRODUCTS = [
  { code: 'P001', name: 'Asado', defaultPrice: 8500 },
  { code: 'P002', name: 'Vacío', defaultPrice: 9200 },
  { code: 'P003', name: 'Costilla', defaultPrice: 7800 },
  { code: 'P004', name: 'Pollo entero', defaultPrice: 5500 },
  { code: 'P005', name: 'Cerdo bondiola', defaultPrice: 6800 },
] as const

const CHANNELS: ScaleChannel[] = ['A', 'B', 'C', 'D']

const isSandbox = import.meta.env['VITE_APP_ENV'] === 'sandbox'

interface PendingItem {
  productCode: string
  productName: string
  weightKg: number
  unitPrice: number
  subtotal: number
}

type ChannelState = Record<ScaleChannel, PendingItem[]>

const emptyChannels = (): ChannelState => ({ A: [], B: [], C: [], D: [] })

function parseWeight(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.')
  if (!normalized) return null
  const value = Number.parseFloat(normalized)
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Panel de desarrollo (solo sandbox): simula el flujo de la balanza KRETZ.
 * - Selector de canal (A/B/C/D) para simular distintos carniceros en paralelo.
 * - "Agregar producto al pedido" acumula ítems en el canal seleccionado.
 * - "Cerrar pedido y enviar a la cola" simula la impresión del ticket físico.
 * No se renderiza en producción.
 */
export default function DevScaleTicketPanel() {
  const [activeChannel, setActiveChannel] = useState<ScaleChannel>('A')
  const [channels, setChannels] = useState<ChannelState>(emptyChannels())

  // Formulario de producto
  const [productCode, setProductCode] = useState(DEV_SCALE_PRODUCTS[0].code)
  const [weightKg, setWeightKg] = useState('1,500')
  const [unitPrice, setUnitPrice] = useState(String(DEV_SCALE_PRODUCTS[0].defaultPrice))

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!isSandbox) return null

  function handleProductChange(code: string) {
    setProductCode(code)
    const product = DEV_SCALE_PRODUCTS.find(p => p.code === code)
    if (product) setUnitPrice(String(product.defaultPrice))
  }

  function handleAddProduct() {
    const weight = parseWeight(weightKg)
    const price = parseNumericInput(unitPrice)

    if (weight === null) {
      setError('Ingresá un peso válido (ej. 1,500).')
      return
    }
    if (price === null || price <= 0) {
      setError('Ingresá un precio por kg válido.')
      return
    }

    setError('')
    const product = DEV_SCALE_PRODUCTS.find(p => p.code === productCode)
    const item: PendingItem = {
      productCode,
      productName: product?.name ?? productCode,
      weightKg: weight,
      unitPrice: price,
      subtotal: parseFloat((weight * price).toFixed(2)),
    }

    setChannels(prev => ({
      ...prev,
      [activeChannel]: [...prev[activeChannel], item],
    }))
    setWeightKg('1,500')
  }

  function removeItem(index: number) {
    setChannels(prev => ({
      ...prev,
      [activeChannel]: prev[activeChannel].filter((_, i) => i !== index),
    }))
  }

  async function handleCloseOrder() {
    const items = channels[activeChannel]
    if (items.length === 0) {
      setError('Agregá al menos un producto al pedido antes de cerrarlo.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const result = await window.hw.injectMockOrder({
        channel: activeChannel,
        items: items.map(i => ({
          productCode: i.productCode,
          weightKg: i.weightKg,
          unitPrice: i.unitPrice,
        })),
      })

      if (!result.ok) {
        setError(result.error ?? 'No se pudo enviar el pedido.')
      } else {
        // Limpiar el canal cerrado
        setChannels(prev => ({ ...prev, [activeChannel]: [] }))
      }
    } catch {
      setError('Error de comunicación con el proceso principal.')
    } finally {
      setLoading(false)
    }
  }

  const currentItems = channels[activeChannel]
  const currentTotal = currentItems.reduce((s, i) => s + i.subtotal, 0)
  const previewWeight = parseWeight(weightKg)
  const previewPrice = parseNumericInput(unitPrice)
  const previewSubtotal =
    previewWeight !== null && previewPrice !== null
      ? parseFloat((previewWeight * previewPrice).toFixed(2))
      : null

  return (
    <div className="border-t border-yellow-700/50 bg-yellow-950/20 p-3 space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-yellow-500">
        Dev — simular balanza
      </p>

      {/* Selector de canal */}
      <div className="flex gap-1">
        {CHANNELS.map(ch => {
          const itemCount = channels[ch].length
          return (
            <button
              key={ch}
              onClick={() => { setActiveChannel(ch); setError('') }}
              className={`flex-1 rounded py-1 text-xs font-bold transition-colors relative ${
                activeChannel === ch
                  ? 'bg-yellow-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {ch}
              {itemCount > 0 && (
                <span className="ml-1 text-[10px] text-yellow-300">({itemCount})</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Formulario de producto */}
      <div className="space-y-1.5">
        <select
          value={productCode}
          onChange={e => handleProductChange(e.target.value)}
          className="w-full rounded bg-gray-800 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-yellow-500"
        >
          {DEV_SCALE_PRODUCTS.map(p => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="text-[10px] text-gray-500">Peso (kg)</label>
            <input
              type="text"
              inputMode="decimal"
              value={weightKg}
              onChange={e => setWeightKg(e.target.value)}
              placeholder="1,500"
              className="w-full rounded bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-yellow-500"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">$/kg</label>
            <NumericInput
              value={unitPrice}
              onChange={setUnitPrice}
              placeholder="0"
              className="w-full rounded bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-yellow-500"
            />
          </div>
        </div>

        {previewSubtotal !== null && (
          <p className="text-[10px] text-gray-600">
            Subtotal: {formatARS(previewSubtotal)}
          </p>
        )}
      </div>

      {/* Botón agregar producto */}
      <button
        type="button"
        onClick={handleAddProduct}
        className="w-full rounded border border-yellow-700/60 bg-yellow-900/30 py-1.5 text-xs font-medium text-yellow-300 hover:bg-yellow-900/50"
      >
        + Agregar producto al pedido
      </button>

      {/* Lista de productos del canal activo */}
      {currentItems.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-gray-500 uppercase">Canal {activeChannel} — pedido abierto</p>
          {currentItems.map((item, i) => (
            <div key={i} className="flex items-center justify-between rounded bg-gray-800/60 px-2 py-1">
              <div className="min-w-0 flex-1">
                <span className="text-xs text-white truncate">{item.productName}</span>
                <span className="ml-1 text-[10px] text-gray-500">
                  {item.weightKg.toFixed(3)} kg
                </span>
              </div>
              <div className="flex items-center gap-2 ml-1 shrink-0">
                <span className="text-xs text-amber-400">{formatARS(item.subtotal)}</span>
                <button
                  onClick={() => removeItem(i)}
                  className="text-[10px] text-gray-600 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          <div className="flex justify-between pt-0.5">
            <span className="text-[10px] text-gray-500">Total pedido</span>
            <span className="text-xs font-bold text-amber-400">{formatARS(currentTotal)}</span>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded bg-red-900/40 px-2 py-1 text-xs text-red-300">{error}</p>
      )}

      {/* Botón cerrar pedido */}
      <button
        type="button"
        onClick={handleCloseOrder}
        disabled={loading || currentItems.length === 0}
        className="w-full rounded border border-amber-600 bg-amber-900/40 py-2 text-xs font-bold text-amber-300 hover:bg-amber-900/60 disabled:opacity-40"
      >
        {loading ? 'Enviando…' : `Cerrar pedido canal ${activeChannel} y enviar a la cola`}
      </button>
    </div>
  )
}
