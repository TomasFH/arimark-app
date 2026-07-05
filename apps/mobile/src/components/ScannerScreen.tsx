import { useEffect, useRef, useState, useCallback } from 'react'
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/browser'
import { parseKretzBarcode } from '@carniceria/shared'
import { publishScanEvent, watchScanEvent } from '../lib/relay'
import type { RelayScanStatus } from '@carniceria/shared'

interface Props {
  uid: string
  displayName: string
  storeId: string
  onLogout: () => void
}

type ScanState =
  | { type: 'idle' }
  | { type: 'scanning' }
  | { type: 'pending'; barcode: string; eventId: string }
  | { type: 'accepted'; productName: string; barcode: string }
  | { type: 'rejected'; reason: string; barcode: string }
  | { type: 'error'; message: string }

export function ScannerScreen({ uid, displayName, storeId, onLogout }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const unsubRelayRef = useRef<(() => void) | null>(null)
  const [scanState, setScanState] = useState<ScanState>({ type: 'idle' })
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  const stopRelay = useCallback(() => {
    if (unsubRelayRef.current) {
      unsubRelayRef.current()
      unsubRelayRef.current = null
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (readerRef.current) {
      readerRef.current.reset()
    }
    setCameraActive(false)
    setScanState({ type: 'idle' })
    stopRelay()
  }, [stopRelay])

  const startCamera = useCallback(async () => {
    setCameraError(null)
    try {
      const reader = new BrowserMultiFormatReader()
      readerRef.current = reader

      const devices = await BrowserMultiFormatReader.listVideoInputDevices()
      if (devices.length === 0) {
        setCameraError('No se encontró ninguna cámara.')
        return
      }

      // Preferir cámara trasera
      const backCamera =
        devices.find(d => /back|rear|environment/i.test(d.label)) ?? devices[devices.length - 1]!

      setCameraActive(true)
      setScanState({ type: 'scanning' })

      await reader.decodeFromVideoDevice(backCamera.deviceId, videoRef.current!, async (result, err) => {
        if (err instanceof NotFoundException || !result) return

        const raw = result.getText()
        const parsed = parseKretzBarcode(raw)

        if (!parsed) {
          // Código válido pero no es de la KRETZ — ignorar silenciosamente
          return
        }

        // Ya hay un escaneo en proceso — esperar
        setScanState(current => {
          if (current.type === 'pending') return current
          return current
        })

        // Obtener el estado actual antes de publicar
        const currentState = scanState
        if (currentState.type === 'pending') return

        setScanState({ type: 'pending', barcode: raw, eventId: '' })
        stopRelay()

        try {
          const eventId = await publishScanEvent(storeId, raw, uid)
          setScanState({ type: 'pending', barcode: raw, eventId })

          const unsub = watchScanEvent(storeId, eventId, (status: RelayScanStatus, event) => {
            if (status === 'pending') return

            unsub()
            unsubRelayRef.current = null

            if (status === 'accepted') {
              setScanState({
                type: 'accepted',
                productName: event.productName ?? '(sin nombre)',
                barcode: raw,
              })
            } else {
              setScanState({
                type: 'rejected',
                reason: event.rejectReason ?? 'Código rechazado',
                barcode: raw,
              })
            }

            // Volver a estado scanning después de 2.5s
            setTimeout(() => {
              setScanState({ type: 'scanning' })
            }, 2500)
          })
          unsubRelayRef.current = unsub
        } catch {
          setScanState({ type: 'error', message: 'Error al enviar el código. Verificá tu conexión.' })
          setTimeout(() => setScanState({ type: 'scanning' }), 3000)
        }
      })
    } catch {
      setCameraError('No se pudo acceder a la cámara. Verificá los permisos.')
      setCameraActive(false)
    }
  }, [uid, storeId, stopRelay, scanState])

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
        <div>
          <p className="text-white font-semibold text-sm">{displayName}</p>
          <p className="text-gray-400 text-xs">Local: {storeId}</p>
        </div>
        <button
          onClick={onLogout}
          className="text-gray-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
        >
          Salir
        </button>
      </div>

      {/* Área de cámara */}
      <div className="flex-1 flex flex-col items-center justify-start gap-4 p-4">
        <div className="w-full relative rounded-2xl overflow-hidden bg-black aspect-video">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            autoPlay
            playsInline
            muted
          />

          {/* Overlay de estado */}
          {cameraActive && scanState.type === 'scanning' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="border-2 border-red-500 rounded-xl w-64 h-32 opacity-70" />
            </div>
          )}

          {!cameraActive && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
              <span className="text-gray-500 text-4xl">📷</span>
            </div>
          )}
        </div>

        {/* Feedback de estado */}
        <ScanFeedback state={scanState} />

        {/* Error de cámara */}
        {cameraError && (
          <div className="w-full bg-red-900/50 border border-red-700 text-red-300 rounded-xl px-4 py-3 text-sm text-center">
            {cameraError}
          </div>
        )}

        {/* Botones */}
        <div className="w-full space-y-3">
          {!cameraActive ? (
            <button
              onClick={startCamera}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl px-4 py-4 text-lg transition-colors"
            >
              Iniciar escáner
            </button>
          ) : (
            <button
              onClick={stopCamera}
              className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-xl px-4 py-3 text-base transition-colors"
            >
              Detener escáner
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ScanFeedback({ state }: { state: ScanState }) {
  if (state.type === 'idle') {
    return (
      <div className="w-full text-center text-gray-500 text-sm py-2">
        Presioná "Iniciar escáner" para comenzar
      </div>
    )
  }

  if (state.type === 'scanning') {
    return (
      <div className="w-full text-center text-gray-300 text-sm py-2">
        Apuntá la cámara al código de barras del ticket
      </div>
    )
  }

  if (state.type === 'pending') {
    return (
      <div className="w-full bg-yellow-900/40 border border-yellow-700 rounded-xl px-4 py-3 text-center">
        <div className="flex items-center justify-center gap-2 text-yellow-300">
          <span className="animate-spin text-xl">⏳</span>
          <span className="text-sm font-medium">Enviando a la PC...</span>
        </div>
        <p className="text-yellow-500 text-xs mt-1 font-mono">{state.barcode}</p>
      </div>
    )
  }

  if (state.type === 'accepted') {
    return (
      <div className="w-full bg-green-900/40 border border-green-600 rounded-xl px-4 py-4 text-center">
        <div className="text-green-400 text-2xl mb-1">✓</div>
        <p className="text-green-300 font-semibold text-base">{state.productName}</p>
        <p className="text-green-600 text-xs mt-1">Agregado al pedido</p>
      </div>
    )
  }

  if (state.type === 'rejected') {
    return (
      <div className="w-full bg-red-900/40 border border-red-700 rounded-xl px-4 py-4 text-center">
        <div className="text-red-400 text-2xl mb-1">✗</div>
        <p className="text-red-300 font-semibold text-sm">{state.reason}</p>
        <p className="text-red-600 text-xs mt-1 font-mono">{state.barcode}</p>
      </div>
    )
  }

  if (state.type === 'error') {
    return (
      <div className="w-full bg-orange-900/40 border border-orange-700 rounded-xl px-4 py-3 text-center">
        <p className="text-orange-300 text-sm">{state.message}</p>
      </div>
    )
  }

  return null
}
