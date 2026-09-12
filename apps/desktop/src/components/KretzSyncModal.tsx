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
import { Button, Modal } from './ui'

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

  const titles: Record<Phase, string> = {
    confirm: 'Cargar catálogo en la balanza',
    running: 'Cargando en la balanza…',
    error: 'No se pudo cargar',
    done: 'Carga finalizada',
  }

  const canDismiss = phase !== 'running'

  const footer = (() => {
    if (phase === 'confirm') {
      return (
        <>
          <Button variant="secondary" className="mr-auto" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => void handleStart()}>Cargar en balanza</Button>
        </>
      )
    }
    if (phase === 'error') {
      return (
        <>
          <Button variant="secondary" className="mr-auto" onClick={onClose}>Cerrar</Button>
          <Button variant="primary" onClick={() => void handleStart()}>Reintentar</Button>
        </>
      )
    }
    if (phase === 'done') {
      return <Button variant="primary" onClick={onClose}>Listo</Button>
    }
    return undefined
  })()

  return (
    <Modal
      open
      onClose={onClose}
      closeOnOverlay={canDismiss}
      closeOnEscape={canDismiss}
      title={titles[phase]}
      size="md"
      footer={footer}
    >
      {phase === 'confirm' && (
        <>
          <p className="text-sm leading-relaxed text-muted">
            Se enviarán todos los productos con PLU y precio del local
            {store ? <span className="text-ink"> «{store.name}»</span> : ''} a la balanza
            conectada por USB. Los PLUs existentes se actualizan; no se borra ninguno.
          </p>
          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <p className="text-xs text-ink">
              No desenchufes la balanza durante la carga.
            </p>
          </div>
        </>
      )}

      {phase === 'running' && (
        <>
          <p className="text-sm text-muted">
            {progress
              ? `PLU ${progress.pluNumber} — ${progress.name} (${progress.current} de ${progress.total})`
              : 'Verificando conexión con la balanza…'}
          </p>
          <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-raised">
            <div
              className="h-full bg-accent transition-all duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1 text-right text-xs text-muted">{pct}%</p>
          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <p className="text-xs text-ink">No desenchufes la balanza.</p>
          </div>
        </>
      )}

      {phase === 'error' && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMsg}
        </div>
      )}

      {phase === 'done' && result && (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between rounded-xl border border-success/30 bg-success/10 px-3 py-2">
            <span className="text-success">Enviados correctamente</span>
            <span className="font-semibold tabular-nums text-success">{result.succeeded}</span>
          </div>

          {result.failed.length > 0 && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-danger">Con error</span>
                <span className="font-semibold tabular-nums text-danger">{result.failed.length}</span>
              </div>
              <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-auto">
                {result.failed.map(f => (
                  <li key={f.pluNumber} className="text-xs text-danger/80">
                    PLU {f.pluNumber} ({f.name}): {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.skipped.length > 0 && (
            <div className="rounded-xl border border-line bg-raised px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-ink">Omitidos</span>
                <span className="font-semibold tabular-nums text-ink">{result.skipped.length}</span>
              </div>
              <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-auto">
                {result.skipped.map(s => (
                  <li key={`${s.pluNumber}-${s.reason}`} className="text-xs text-muted">
                    PLU {s.pluNumber ?? '—'} ({s.name}):{' '}
                    {s.reason === 'no_price' ? 'sin precio cargado' : 'precio supera $99.999'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
