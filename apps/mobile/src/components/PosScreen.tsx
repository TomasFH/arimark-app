/**
 * Pantalla principal del POS móvil.
 * Permite escanear códigos (cámara), entrada manual, y confirmar venta.
 * Persiste ventas en IndexedDB para sync posterior.
 */
import { useState, useRef, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { parseKretzBarcode } from '@carniceria/shared'
import { startBarcodeScanning } from '../lib/barcodeScanner'
import { findByPlu } from '../lib/catalog'
import { db } from '../lib/db'
import { triggerSync } from '../lib/sync'
import { PaymentModal } from './PaymentModal'
import { ManualEntry } from './ManualEntry'
import type { CatalogProduct, LocalShift, SaleItemDraft, SalePaymentDraft } from '../types/pos'

interface Props {
  shift: LocalShift
  catalog: CatalogProduct[]
  onCloseShift: () => void
}

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = ok ? 1200 : 400
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (ok ? 0.08 : 0.25))
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.25))
  } catch { /* AudioContext no disponible */ }
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 0,
  }).format(n)
}

export function PosScreen({ shift, catalog, onCloseShift }: Props) {
  const [items, setItems] = useState<SaleItemDraft[]>([])
  const [showScanner, setShowScanner] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const stopScanRef = useRef<(() => void) | null>(null)
  const processingRef = useRef(false)

  const total = items.reduce((s, i) => s + i.subtotal, 0)

  const handleBarcode = useCallback((digits: string) => {
    if (processingRef.current) return
    processingRef.current = true

    const parsed = parseKretzBarcode(digits)
    if (!parsed) {
      setScanError('Código no válido')
      beep(false)
      setTimeout(() => { processingRef.current = false; setScanError(null) }, 1500)
      return
    }

    const product = findByPlu(catalog, parseInt(parsed.pluNumber, 10))
    if (!product) {
      setScanError(`PLU ${parseInt(parsed.pluNumber, 10)} no encontrado en el catálogo`)
      beep(false)
      setTimeout(() => { processingRef.current = false; setScanError(null) }, 2000)
      return
    }

    const totalCents = parsed.totalCents
    const totalPesos = totalCents / 100
    const weightKg = product.unit === 'kg' && product.price > 0
      ? Math.round((totalPesos / product.price) * 1000) / 1000
      : null

    const item: SaleItemDraft = {
      productId: product.productId,
      productName: product.name,
      pluNumber: product.pluNumber,
      quantity: product.unit === 'kg' ? (weightKg ?? 1) : 1,
      unitPrice: product.price,
      subtotal: totalPesos,
      weightKg,
      manualEntry: false,
    }

    setItems(prev => [...prev, item])
    setLastScan(product.name)
    beep(true)
    setTimeout(() => {
      processingRef.current = false
      setLastScan(null)
    }, 1200)
  }, [catalog])

  function openScanner() {
    setShowScanner(true)
    setScanError(null)

    if (!videoRef.current) return
    void startBarcodeScanning(videoRef.current, handleBarcode).then(ctrl => {
      stopScanRef.current = () => ctrl.stop()
    })
  }

  function closeScanner() {
    stopScanRef.current?.()
    stopScanRef.current = null
    setShowScanner(false)
    setScanError(null)
  }

  function removeItem(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  async function confirmSale(payments: SalePaymentDraft[], notes: string) {
    setSaving(true)
    setShowPayment(false)

    const saleId = uuidv4()
    await db.sales.put({
      id: saleId,
      shiftId: shift.id,
      storeId: shift.storeId,
      total,
      items,
      payments,
      notes: notes || null,
      manualEntry: items.some(i => i.manualEntry),
      createdAt: new Date().toISOString(),
      createdBy: shift.userId,
      syncStatus: 'pending',
      syncedAt: null,
    })

    setSaving(false)
    setItems([])
    setSuccess(true)
    setTimeout(() => setSuccess(false), 2000)

    // Disparar sync en background — no bloquea la UI.
    triggerSync().catch(() => { /* silencioso */ })
  }

  async function closeShift() {
    await db.shifts.update(shift.id, {
      closedAt: new Date().toISOString(),
      closingCash: 0,
    })
    onCloseShift()
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-white font-semibold text-sm">{shift.displayName}</p>
          <p className="text-gray-400 text-xs">Local {shift.storeId} · POS móvil</p>
        </div>
        <button
          onClick={closeShift}
          className="text-xs text-gray-400 hover:text-red-400 border border-gray-700 hover:border-red-700 px-3 py-1.5 rounded-lg transition-colors"
        >
          Cerrar turno
        </button>
      </div>

      {/* Feedback de escaneo */}
      {lastScan && (
        <div className="bg-green-800 text-green-100 text-sm font-semibold text-center py-2 px-4 animate-pulse">
          ✓ {lastScan}
        </div>
      )}
      {scanError && (
        <div className="bg-red-900 text-red-200 text-sm font-semibold text-center py-2 px-4">
          ✕ {scanError}
        </div>
      )}
      {success && (
        <div className="bg-green-700 text-white text-sm font-bold text-center py-2 px-4">
          ✓ Venta confirmada
        </div>
      )}

      {/* Lista de items del pedido */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {items.length === 0 ? (
          <div className="text-center text-gray-600 mt-16">
            <p className="text-5xl mb-3">🛒</p>
            <p className="text-sm">Escaneá un código de barras<br />o ingresá un producto manualmente</p>
          </div>
        ) : (
          items.map((item, idx) => (
            <div
              key={idx}
              className="bg-gray-900 rounded-xl px-4 py-3 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{item.productName}</p>
                <p className="text-gray-400 text-xs">
                  {item.weightKg !== null
                    ? `${item.weightKg.toFixed(3)} kg · ${formatARS(item.unitPrice)}/kg`
                    : `${item.quantity} ud · ${formatARS(item.unitPrice)}`}
                  {item.manualEntry && <span className="text-orange-400 ml-1">· manual</span>}
                </p>
              </div>
              <span className="text-white font-bold shrink-0">{formatARS(item.subtotal)}</span>
              <button
                onClick={() => removeItem(idx)}
                className="text-gray-600 hover:text-red-400 text-lg leading-none shrink-0 transition-colors"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      {/* Scanner embebido */}
      {showScanner && (
        <div className="relative bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full"
            style={{ maxHeight: '45vw', objectFit: 'cover' }}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="border-2 border-red-500 rounded w-3/4 h-12 opacity-70" />
          </div>
          <button
            onClick={closeScanner}
            className="absolute top-2 right-2 bg-black/60 text-white text-sm px-3 py-1.5 rounded-lg"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="bg-gray-900 border-t border-gray-800 px-4 pt-3 pb-4 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">{items.length} producto{items.length !== 1 ? 's' : ''}</span>
          <span className="text-white font-bold text-xl">{formatARS(total)}</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => showScanner ? closeScanner() : openScanner()}
            className={`py-3 rounded-xl font-semibold text-sm transition-colors ${
              showScanner
                ? 'bg-orange-700 hover:bg-orange-600 text-white'
                : 'bg-gray-800 hover:bg-gray-700 text-white'
            }`}
          >
            {showScanner ? '📷 Cerrar' : '📷 Escanear'}
          </button>

          <button
            onClick={() => setShowManual(true)}
            className="bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-xl font-semibold text-sm transition-colors"
          >
            ✏️ Manual
          </button>

          <button
            onClick={() => setShowPayment(true)}
            disabled={items.length === 0 || saving}
            className="bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold text-sm transition-colors"
          >
            💰 Cobrar
          </button>
        </div>
      </div>

      {showManual && (
        <ManualEntry
          catalog={catalog}
          onAdd={item => { setItems(prev => [...prev, item]); setShowManual(false) }}
          onClose={() => setShowManual(false)}
        />
      )}

      {showPayment && (
        <PaymentModal
          total={total}
          onConfirm={confirmSale}
          onCancel={() => setShowPayment(false)}
        />
      )}
    </div>
  )
}
