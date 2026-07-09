import { useState, useEffect, useCallback, useRef } from 'react'
import DevToolsPanel from '../components/DevToolsPanel'
import ScanInput from '../components/ScanInput'
import PaymentModal from '../components/PaymentModal'
import ProductsListModal from '../components/ProductsListModal'
import type { SaleItemDraft, SalePaymentPayload, ShiftInfo, SessionInfo, ProductRow } from '../types/hw-api'
import { formatARS, formatKg } from '../lib/datetime'
import { useBarcodeScanner } from '../lib/useBarcodeScanner'
import { parseKretzBarcode, centsToARS } from '@carniceria/shared'
import { buildItemFromBarcode } from '../lib/barcodeItem'

interface Props {
  session: SessionInfo
  shift: ShiftInfo
  onLogout: () => void
  onCloseShift: () => void
  onReturnToHub?: () => void
}

/** Producto genérico usado cuando el PLU no está mapeado a un producto real. */
const FALLBACK_PRODUCT_ID = '00000000-0000-0000-0001-000000000099'

/** Ítem en la venta en curso, con un id local para interacciones de UI. */
interface CartItem extends SaleItemDraft {
  localId: string
}

export default function CashierScreen({ session, shift, onLogout, onCloseShift, onReturnToHub }: Props) {
  const [cart, setCart] = useState<CartItem[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showProductsModal, setShowProductsModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastSaleId, setLastSaleId] = useState<string | null>(null)
  // Feedback visual cuando el lector captura un escaneo global
  const [scanFlash, setScanFlash] = useState<string | null>(null)
  const scanFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cargar catálogo (PLU → producto/precio) para resolver los escaneos.
  useEffect(() => {
    window.hw.getProducts().then(res => {
      if (res.ok) setProducts(res.data)
    })
  }, [])

  const cartTotal = cart.reduce((sum, item) => sum + item.subtotal, 0)
  const hasManualItems = cart.some(item => item.manualEntry)

  const addItem = useCallback((item: SaleItemDraft) => {
    setCart(prev => [...prev, { ...item, localId: `tmp-${crypto.randomUUID()}` }])
    setError('')
    setLastSaleId(null)
  }, [])

  // ── Lector USB: captura global de códigos de barras ────────────────────
  // Se desactiva automáticamente cuando hay un modal abierto (el usuario puede
  // estar escribiendo en campos propios del modal).
  const anyModalOpen = showPaymentModal || showProductsModal

  const handleGlobalScan = useCallback((digits: string) => {
    const parsed = parseKretzBarcode(digits)
    if (!parsed) {
      // Código capturado pero no es formato KRETZ → ignorar silenciosamente
      return
    }
    const plu = parseInt(parsed.pluNumber, 10)
    const product = products.find(p => p.pluNumber === plu)
    const item = buildItemFromBarcode(plu, centsToARS(parsed.totalCents), product)
    addItem(item)

    // Flash visual en la barra de estado
    if (scanFlashTimerRef.current) clearTimeout(scanFlashTimerRef.current)
    setScanFlash(item.productName)
    scanFlashTimerRef.current = setTimeout(() => setScanFlash(null), 2000)
  }, [products, addItem])

  useBarcodeScanner({ onScan: handleGlobalScan, disabled: anyModalOpen })

  function removeItem(localId: string) {
    setCart(prev => prev.filter(i => i.localId !== localId))
  }

  function clearCart() {
    setCart([])
    setError('')
    setLastSaleId(null)
  }

  async function handleConfirmSale(payments: SalePaymentPayload[], notes?: string) {
    if (cart.length === 0) {
      setError('Agregá al menos un producto antes de confirmar.')
      return
    }

    setLoading(true)
    setError('')
    setShowPaymentModal(false)

    try {
      const result = await window.hw.createSale({
        items: cart.map(item => ({
          productId: item.productId ?? FALLBACK_PRODUCT_ID,
          // Para productos por unidad la cantidad es entera; por kg va con decimales.
          quantity: item.unit === 'unit' ? Math.round(item.weightKg) : item.weightKg,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
        })),
        payments,
        manualEntry: hasManualItems,
        notes,
      })

      if (!result.ok) {
        setError(result.error ?? 'Error al procesar la venta.')
        return
      }

      setLastSaleId(result.data.saleId)
      setCart([])
    } catch {
      setError('Error de comunicación. Reintentar.')
    } finally {
      setLoading(false)
    }
  }

  function openPaymentModal() {
    setError('')
    setLastSaleId(null)
    setShowPaymentModal(true)
  }

  const shiftLabel = shift.shiftType === 'morning' ? '🌅 Mañana' : '🌙 Tarde'

  return (
    <div className="flex flex-1 flex-col bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-amber-400">{shiftLabel}</span>
          <span className="text-xs text-gray-500">Turno abierto</span>
          {/* Indicador del lector USB */}
          {scanFlash ? (
            <span className="flex items-center gap-1.5 rounded-md bg-green-900/40 px-2 py-1 text-[11px] text-green-300 animate-pulse">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
              {scanFlash}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-gray-600">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-600" />
              Lector listo
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowProductsModal(true)}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:border-gray-600 hover:text-white transition-colors"
          >
            📋 Productos
          </button>
          <span className="text-sm text-gray-400">
            {session.role === 'cashier' ? 'Cajera' : 'Admin'}
          </span>
          {onReturnToHub && (
            <button
              onClick={onReturnToHub}
              className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:border-gray-600 hover:text-white transition-colors"
            >
              ← Panel admin
            </button>
          )}
          <button
            onClick={onCloseShift}
            className="rounded-md bg-red-700 px-3 py-1.5 text-xs text-white hover:bg-red-600 transition-colors"
          >
            Cerrar caja
          </button>
          <button
            onClick={onLogout}
            className="rounded-md bg-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-600"
          >
            Salir
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Columna izquierda: escaneo de productos + herramientas dev */}
        <div className="flex w-80 flex-col border-r border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-200">Escanear productos</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Apuntá el lector al código del ticket. Si no hay lector, usá el campo de abajo.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            <ScanInput onAddItem={addItem} products={products} />
          </div>

          <DevToolsPanel />
        </div>

        {/* Columna central: venta en curso + acción de cobro */}
        <div className="flex flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-gray-800 px-6 py-3">
            <h2 className="text-sm font-semibold text-gray-200">
              Venta en curso{cart.length > 0 ? ` — ${cart.length} ítem${cart.length !== 1 ? 's' : ''}` : ''}
            </h2>
            {cart.length > 0 && (
              <button onClick={clearCart} className="text-xs text-gray-500 hover:text-red-400">
                Vaciar
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 space-y-2">
                <p className="text-4xl">🛒</p>
                <p className="text-sm">Escaneá un producto para empezar la venta</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-xs text-gray-500">
                    <th className="pb-2 text-left">PLU</th>
                    <th className="pb-2 text-left">Producto</th>
                    <th className="pb-2 text-right">Peso / Cant.</th>
                    <th className="pb-2 text-right">Precio</th>
                    <th className="pb-2 w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map(item => (
                    <tr key={item.localId} className="border-b border-gray-800/50">
                      <td className="py-2 text-gray-400 pr-2">{item.pluNumber}</td>
                      <td className="py-2 text-gray-200">
                        <span className="flex items-center gap-1 flex-wrap">
                          {item.productName}
                          {item.manualEntry && (
                            <span className="rounded bg-orange-900/50 px-1 py-0.5 text-[9px] text-orange-300">
                              manual
                            </span>
                          )}
                          {item.priceDiscrepancy && (
                            <span
                              className="rounded bg-red-900/60 px-1 py-0.5 text-[9px] text-red-300 cursor-help"
                              title="El precio del código de barras no coincide con el precio registrado en el catálogo. Verificar el precio en la balanza."
                            >
                              ⚠ precio
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2 text-right text-gray-400 text-xs">
                        {item.unit === 'unit'
                          ? `${Math.round(item.weightKg)} u.`
                          : formatKg(item.weightKg)}
                      </td>
                      <td className="py-2 text-right font-semibold text-white">{formatARS(item.subtotal)}</td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => removeItem(item.localId)}
                          className="text-[11px] text-gray-600 hover:text-red-400"
                          title="Quitar"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="pt-3 text-right text-sm font-bold text-gray-200">
                      Total
                    </td>
                    <td className="pt-3 text-right text-xl font-bold text-amber-400" colSpan={2}>
                      {formatARS(cartTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* Feedback + botón confirmar */}
          <div className="border-t border-gray-800 px-6 py-4 space-y-3">
            {error && (
              <p className="rounded-lg bg-red-900/40 px-4 py-2.5 text-xs text-red-300">{error}</p>
            )}
            {lastSaleId && (
              <p className="rounded-lg bg-green-900/40 px-4 py-2.5 text-xs text-green-300">
                ✓ Venta confirmada
              </p>
            )}
            <button
              onClick={openPaymentModal}
              disabled={loading || cart.length === 0}
              className="w-full rounded-xl bg-amber-500 py-4 font-bold text-white text-sm transition-colors hover:bg-amber-400 disabled:opacity-40"
            >
              {loading ? 'Procesando…' : `Confirmar venta · ${formatARS(cartTotal)}`}
            </button>
          </div>
        </div>
      </div>

      {/* Modal de cobro */}
      {showPaymentModal && cart.length > 0 && (
        <PaymentModal
          total={cartTotal}
          onConfirm={handleConfirmSale}
          onClose={() => setShowPaymentModal(false)}
        />
      )}

      {/* Modal de lista de productos */}
      {showProductsModal && (
        <ProductsListModal onClose={() => setShowProductsModal(false)} />
      )}
    </div>
  )
}
