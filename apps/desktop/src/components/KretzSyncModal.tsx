/**
 * Modal de carga masiva del catálogo a la balanza KRETZ.
 *
 * Muestra en tiempo real el progreso de la exportación (barra + PLU actual)
 * para que el operador no desenchufe la balanza antes de tiempo. Al finalizar
 * presenta un resumen: enviados, omitidos (sin precio o precio fuera de rango)
 * y fallidos.
 */
import { useEffect, useState, useRef } from 'react'
import type { KretzSyncProgress, KretzSyncResult, StoreRow } from '../types/hw-api'

type Phase = 'confirm' | 'running' | 'done' | 'error'

interface Props {
  storeId: string
  store: StoreRow | undefined
  onClose: () => void
}

export default function KretzSyncModal({ storeId, store, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('confirm')
  const [progress, setProgress] = useState<KretzSyncProgress | null>(null)
  const [result, setResult] = useState<KretzSyncResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => { unsubRef.current?.() }
  }, [])

  async function handleStart() {
    setPhase('running')
    setProgress(null)
    setResult(null)
    setErrorMsg(null)

    unsubRef.current = window.hw.onKretzSyncProgress(p => setProgress(p))

    const r = await window.hw.kretzSyncCatalog(storeId)

    unsubRef.current?.()
    unsubRef.current = null

    if (!r.ok) {
      setErrorMsg(r.error)
      setPhase('error')
      return
    }
    setResult(r.data)
    setPhase('done')
  }

  const pct = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-zinc-800 rounded-xl w-full max-w-md p-6 shadow-xl">

        {/* Confirmación */}
        {phase === 'confirm' && (
          <>
            <h2 className="text-lg font-semibold text-white">Cargar catálogo en la balanza</h2>
            <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
              Se enviarán todos los productos con PLU y precio del local
              {store ? <span className="text-zinc-200"> «{store.name}»</span> : ''} a la balanza
              conectada por USB. Los PLUs existentes se actualizan; no se borra ninguno.
            </p>
            <div className="mt-3 rounded-lg bg-amber-900/30 border border-amber-800/50 px-3 py-2">
              <p className="text-xs text-amber-300">
                No desenchufes la balanza durante la carga.
              </p>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={onClose}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleStart()}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
              >
                Cargar en balanza
              </button>
            </div>
          </>
        )}

        {/* En progreso */}
        {phase === 'running' && (
          <>
            <h2 className="text-lg font-semibold text-white">Cargando en la balanza…</h2>
            <p className="text-sm text-zinc-400 mt-1">
              {progress
                ? `PLU ${progress.pluNumber} — ${progress.name} (${progress.current} de ${progress.total})`
                : 'Verificando conexión con la balanza…'}
            </p>

            <div className="mt-4 h-3 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-red-600 transition-all duration-150"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-right text-xs text-zinc-500 mt-1">{pct}%</p>

            <div className="mt-3 rounded-lg bg-amber-900/30 border border-amber-800/50 px-3 py-2">
              <p className="text-xs text-amber-300">
                No desenchufes la balanza.
              </p>
            </div>
          </>
        )}

        {/* Error (no arrancó — sin balanza, etc.) */}
        {phase === 'error' && (
          <>
            <h2 className="text-lg font-semibold text-white">No se pudo cargar</h2>
            <div className="mt-3 rounded-lg bg-red-900/40 border border-red-700 text-red-300 px-3 py-2 text-sm">
              {errorMsg}
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={onClose}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2 rounded-lg transition-colors"
              >
                Cerrar
              </button>
              <button
                onClick={() => void handleStart()}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
              >
                Reintentar
              </button>
            </div>
          </>
        )}

        {/* Resumen final */}
        {phase === 'done' && result && (
          <>
            <h2 className="text-lg font-semibold text-white">Carga finalizada</h2>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between rounded-lg bg-green-900/30 border border-green-800/50 px-3 py-2">
                <span className="text-green-300">Enviados correctamente</span>
                <span className="text-green-200 font-semibold tabular-nums">{result.succeeded}</span>
              </div>

              {result.failed.length > 0 && (
                <div className="rounded-lg bg-red-900/30 border border-red-800/50 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-red-300">Con error</span>
                    <span className="text-red-200 font-semibold tabular-nums">{result.failed.length}</span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5 max-h-28 overflow-auto">
                    {result.failed.map(f => (
                      <li key={f.pluNumber} className="text-xs text-red-300/80">
                        PLU {f.pluNumber} ({f.name}): {f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.skipped.length > 0 && (
                <div className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">Omitidos</span>
                    <span className="text-zinc-200 font-semibold tabular-nums">{result.skipped.length}</span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5 max-h-28 overflow-auto">
                    {result.skipped.map(s => (
                      <li key={`${s.pluNumber}-${s.reason}`} className="text-xs text-zinc-400">
                        PLU {s.pluNumber ?? '—'} ({s.name}):{' '}
                        {s.reason === 'no_price' ? 'sin precio cargado' : 'precio supera $99.999'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <button
              onClick={onClose}
              className="w-full mt-6 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
            >
              Listo
            </button>
          </>
        )}
      </div>
    </div>
  )
}
