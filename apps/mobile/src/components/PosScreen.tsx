/**
 * Pantalla principal del POS móvil.
 * Permite escanear códigos (cámara), entrada manual, y confirmar venta.
 * Persiste ventas en IndexedDB para sync posterior.
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { parseKretzBarcode } from '@carniceria/shared'
import { startBarcodeScanning } from '../lib/barcodeScanner'
import { findByPlu } from '../lib/catalog'
import { db } from '../lib/db'
import { triggerSync } from '../lib/sync'
import { PaymentModal } from './PaymentModal'
import { ManualEntry } from './ManualEntry'
import { useBackLayer } from '../lib/backStack'
import { expectedCashInHand, shiftRevenue } from '../lib/shiftCash'
import type { CatalogProduct, LocalSale, LocalShift, SaleItemDraft, SalePaymentDraft } from '../types/pos'

interface Props {
  shift: LocalShift
  catalog: CatalogProduct[]
  storeName: string
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

export function PosScreen({ shift, catalog, storeName, onCloseShift }: Props) {
  const [items, setItems] = useState<SaleItemDraft[]>([])
  const [showScanner, setShowScanner] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [pendingDup, setPendingDup] = useState<SaleItemDraft | null>(null)
  const [shiftSales, setShiftSales] = useState<LocalSale[]>([])

  const videoRef = useRef<HTMLVideoElement>(null)
  const stopScanRef = useRef<(() => void) | null>(null)
  const processingRef = useRef(false)
  const itemsRef = useRef<SaleItemDraft[]>([])

  const total = items.reduce((s, i) => s + i.subtotal, 0)
  const cashInHand = expectedCashInHand(shift.openingCash, shiftSales)
  const soldTotal = shiftRevenue(shiftSales)

  useBackLayer(showScanner, closeScanner)
  useBackLayer(Boolean(pendingDup), cancelDuplicate)
  useBackLayer(showCloseConfirm, () => setShowCloseConfirm(false))

  async function refreshShiftSales(): Promise<void> {
    const rows = await db.sales.where('shiftId').equals(shift.id).toArray()
    setShiftSales(rows)
  }

  useEffect(() => {
    void refreshShiftSales()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift.id, success])

  // Espejo de items para leer el estado actual dentro de handleBarcode
  // (que se memoiza y de otro modo capturaría un items obsoleto).
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  // Agrega el ítem resuelto al carrito, con feedback y cooldown de re-escaneo.
  const commitItem = useCallback((item: SaleItemDraft) => {
    setItems(prev => [...prev, item])
    setLastScan(item.productName)
    beep(true)
    setTimeout(() => {
      processingRef.current = false
      setLastScan(null)
    }, 1200)
  }, [])

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

    // Detección de duplicado: mismo producto y mismo importe = probablemente
    // un doble escaneo del mismo código. Se pide confirmación antes de agregar.
    const isDuplicate = itemsRef.current.some(
      i => i.productId === item.productId &&
           Math.round(i.subtotal * 100) === Math.round(item.subtotal * 100)
    )
    if (isDuplicate) {
      beep(false)
      setPendingDup(item)  // processingRef sigue true hasta que el usuario decida
      return
    }

    commitItem(item)
  }, [catalog, commitItem])

  function confirmDuplicate() {
    if (pendingDup) commitItem(pendingDup)
    setPendingDup(null)
  }

  function cancelDuplicate() {
    setPendingDup(null)
    processingRef.current = false
  }

  function openScanner() {
    setShowScanner(true)
    setScanError(null)
    // La cámara se inicia en el useEffect de abajo,
    // una vez que el <video> esté montado en el DOM.
  }

  // Inicia la cámara cuando el scanner está visible y el video está en el DOM.
  useEffect(() => {
    if (!showScanner) return
    const video = videoRef.current
    if (!video) return

    let cancelled = false
    void startBarcodeScanning(video, handleBarcode).then(ctrl => {
      if (cancelled) {
        ctrl.stop()
      } else {
        stopScanRef.current = () => ctrl.stop()
      }
    })

    return () => {
      cancelled = true
      stopScanRef.current?.()
      stopScanRef.current = null
    }
  }, [showScanner, handleBarcode])

  function closeScanner() {
    setShowScanner(false)
    setScanError(null)
    // El useEffect limpia stopScanRef al desmontar.
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
    void refreshShiftSales()

    // Disparar sync en background — no bloquea la UI.
    triggerSync().catch(() => { /* silencioso */ })
  }

  async function closeShift() {
    await db.shifts.update(shift.id, {
      closedAt: new Date().toISOString(),
      closingCash: cashInHand,
    })
    onCloseShift()
  }

  return (
    <div className="h-full min-h-0 bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white" title={shift.displayName}>{shift.displayName}</p>
          <p className="truncate text-xs text-gray-400" title={storeName}>{storeName} · POS móvil</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-xs text-emerald-400" title="Efectivo estimado en caja">
            {formatARS(cashInHand)} en caja
          </span>
          <button
            type="button"
            onClick={() => setShowCloseConfirm(true)}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-red-700 hover:text-red-400"
          >
            Cerrar turno
          </button>
        </div>
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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-2">
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
        <div className="relative bg-black overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full"
            style={{ height: '60vh', objectFit: 'cover' }}
          />
          {/* Overlay: la zona clara (recuadro) es la única región que se lee.
              Todo lo de afuera está oscurecido y la app lo ignora. */}
          <div className="absolute inset-0 pointer-events-none">
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-2 border-red-500 rounded-lg"
              style={{
                width: '80%',
                height: '38%',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
              }}
            />
          </div>
          <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white/80 text-xs bg-black/50 px-3 py-1 rounded-full">
            Colocá el código dentro del recuadro
          </p>
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

      {pendingDup && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-gray-900 rounded-2xl p-5 space-y-4">
            <div className="text-center">
              <div className="text-4xl mb-2">⚠️</div>
              <h2 className="text-white font-bold text-lg">¿Producto repetido?</h2>
              <p className="text-gray-400 text-sm mt-2">
                Ya escaneaste <span className="text-white font-semibold">{pendingDup.productName}</span> por{' '}
                <span className="text-white font-semibold">{formatARS(pendingDup.subtotal)}</span> en este pedido.
                ¿Querés agregarlo de nuevo?
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={cancelDuplicate}
                className="bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-xl py-3 transition-colors"
              >
                No, cancelar
              </button>
              <button
                onClick={confirmDuplicate}
                className="bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl py-3 transition-colors"
              >
                Sí, agregar
              </button>
            </div>
          </div>
        </div>
      )}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-gray-900 p-5">
            <h2 className="text-lg font-bold text-white">¿Cerrar el turno ahora?</h2>
            <p className="text-sm text-gray-400">
              Esta acción finaliza el turno y no puede deshacerse. Verificá los datos antes de confirmar.
            </p>
            <div className="space-y-2 rounded-xl bg-gray-800/80 p-4 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-gray-400">Total vendido</span>
                <span className="font-semibold text-white">{formatARS(soldTotal)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-400">Efectivo esperado</span>
                <span className="font-semibold text-emerald-400">{formatARS(cashInHand)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShowCloseConfirm(false)}
                className="rounded-xl bg-gray-800 py-3 font-semibold text-white transition-colors hover:bg-gray-700"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => void closeShift()}
                className="rounded-xl bg-red-600 py-3 font-bold text-white transition-colors hover:bg-red-700"
              >
                Cerrar turno
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
