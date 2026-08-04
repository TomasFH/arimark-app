/**
 * Panel de diagnóstico — visible solo en modo dev, oculto en producción.
 *
 * Tabs:
 *  - "Hardware": estado en tiempo real, configuración KRETZ, log de eventos.
 *  - "PLUs": crear/editar PLUs en la balanza KRETZ (real o mock según KRETZ_PORT).
 */

import { useState, useEffect, useRef } from 'react'
import PluManagerPanel from './PluManagerPanel'
import type { HardwareStatus, HardwareConfig } from '../types/hw-api'

const APP_ENV = import.meta.env['VITE_APP_ENV'] as string

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

type TabId = 'hardware' | 'plus' | 'sales'

interface LogEntry {
  id: number
  time: string
  level: 'info' | 'warn' | 'error'
  message: string
}

function nowTime(): string {
  return new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ---------------------------------------------------------------------------
// Sub-componente: indicador de estado
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: 'connected' | 'disconnected' | 'error' | 'unknown' }) {
  const colors = {
    connected: 'bg-green-400',
    disconnected: 'bg-zinc-500',
    error: 'bg-red-500 animate-pulse',
    unknown: 'bg-zinc-600',
  }
  const labels = {
    connected: 'Conectado',
    disconnected: 'Desconectado',
    error: 'Error',
    unknown: 'Desconocido',
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full ${colors[status]}`} />
      <span className="text-xs text-zinc-400">{labels[status]}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Sub-componente: tab Hardware
// ---------------------------------------------------------------------------

function HardwareTab({ onLog }: { onLog: (entry: Omit<LogEntry, 'id'>) => void }) {
  const [hwStatus, setHwStatus] = useState<HardwareStatus>({ scale: 'disconnected' })
  const [config, setConfig] = useState<HardwareConfig>({})
  const [editPort, setEditPort] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [detectMsg, setDetectMsg] = useState('')

  // Cargar estado y config al montar
  useEffect(() => {
    window.hw.getHardwareStatus().then(r => {
      if (r.ok) setHwStatus(r.data)
    })
    window.hw.getHardwareConfig().then(r => {
      if (r.ok) {
        setConfig(r.data)
        setEditPort(r.data.kretzPort ?? '')
      }
    })
  }, [])

  // Suscribirse a cambios de estado en tiempo real
  useEffect(() => {
    const unsub = window.hw.onHardwareStatusChange(status => {
      setHwStatus(status)
      if (status.scale === 'connected') onLog({ time: nowTime(), level: 'info', message: 'KRETZ conectada' })
      if (status.scale === 'disconnected') onLog({ time: nowTime(), level: 'warn', message: 'KRETZ desconectada' })
      if (status.scale === 'error') onLog({ time: nowTime(), level: 'error', message: 'KRETZ — error de conexión' })
    })
    return unsub
  }, [onLog])

  async function handleDetect() {
    setDetecting(true)
    setDetectMsg('')
    setSaveMsg('')
    onLog({ time: nowTime(), level: 'info', message: 'Detectando balanza en los puertos serie…' })
    try {
      const result = await window.hw.kretzDetectPort()
      if (result.ok) {
        const port = result.data.port
        setConfig(prev => ({ ...prev, kretzPort: port }))
        setEditPort(port)
        setDetectMsg(`Balanza detectada en ${port} y conectada.`)
        onLog({ time: nowTime(), level: 'info', message: `Balanza detectada en ${port}` })
      } else {
        setDetectMsg(result.error)
        onLog({ time: nowTime(), level: 'warn', message: `Detección: ${result.error}` })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setDetectMsg(`Error: ${msg}`)
      onLog({ time: nowTime(), level: 'error', message: `Detección falló: ${msg}` })
    } finally {
      setDetecting(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveMsg('')
    try {
      const payload: Record<string, string> = {}
      if (editPort !== (config.kretzPort ?? '')) payload['kretzPort'] = editPort

      if (Object.keys(payload).length === 0) {
        setSaveMsg('Sin cambios.')
        return
      }

      const result = await window.hw.setHardwareConfig(payload)
      if (result.ok) {
        setSaveMsg('Guardado. Reiniciá la app para aplicar los cambios.')
        setConfig(prev => ({ ...prev, kretzPort: editPort || undefined }))
        onLog({ time: nowTime(), level: 'info', message: 'Configuración de hardware guardada' })
      } else {
        setSaveMsg(`Error: ${result.error}`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Estado en tiempo real */}
      <div className="rounded-lg bg-zinc-800/60 p-3 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Estado en vivo</p>
        <div className="grid gap-2">
          <div className="rounded bg-zinc-900/60 p-2 space-y-1">
            <p className="text-[10px] font-semibold text-zinc-400">Balanza KRETZ</p>
            <StatusDot status={hwStatus.scale} />
            <p className="text-[10px] text-zinc-600">Puerto: {config.kretzPort || 'mock'}</p>
          </div>
        </div>
      </div>

      {/* Detección automática de la balanza */}
      <div className="rounded-lg bg-zinc-800/60 p-3 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Detectar balanza</p>
        <p className="text-[10px] text-zinc-600 leading-relaxed">
          Sondea todos los puertos COM y se conecta al que responda. Cerrá iTegra antes de detectar.
        </p>
        <button
          onClick={handleDetect}
          disabled={detecting}
          className="w-full rounded border border-zinc-700 bg-zinc-800/60 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
        >
          {detecting ? 'Detectando…' : 'Detectar balanza automáticamente'}
        </button>
        {detectMsg && (
          <p className={`text-[10px] ${detectMsg.startsWith('Error') || detectMsg.startsWith('No se detectó') ? 'text-red-400' : 'text-green-400'}`}>
            {detectMsg}
          </p>
        )}
      </div>

      {/* Configuración de hardware */}
      <div className="rounded-lg bg-zinc-800/60 p-3 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Configurar hardware</p>

        <div>
          <label className="text-[10px] text-zinc-500">Puerto KRETZ (ej. COM8; vacío = mock)</label>
          <input
            type="text"
            value={editPort}
            onChange={e => setEditPort(e.target.value)}
            placeholder="COM8"
            className="mt-0.5 w-full rounded bg-zinc-900 px-2 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
        </div>
        {saveMsg && (
          <p className={`text-[10px] ${saveMsg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
            {saveMsg}
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded border border-zinc-700 bg-zinc-800/60 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
        >
          {saving ? 'Guardando…' : 'Guardar y reiniciar para aplicar'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-componente: log de eventos
// ---------------------------------------------------------------------------

function EventLog({ entries }: { entries: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries])

  const levelColors: Record<LogEntry['level'], string> = {
    info: 'text-zinc-400',
    warn: 'text-yellow-400',
    error: 'text-red-400',
  }

  return (
    <div className="rounded-lg bg-zinc-800/60 p-2 space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 mb-1">
        Log de eventos ({entries.length})
      </p>
      <div className="h-28 overflow-y-auto space-y-0.5 font-mono">
        {entries.length === 0 && (
          <p className="text-[10px] text-zinc-600 italic">Sin eventos aún…</p>
        )}
        {entries.map(e => (
          <div key={e.id} className="flex gap-1.5 text-[10px]">
            <span className="shrink-0 text-zinc-600">{e.time}</span>
            <span className={`${levelColors[e.level]}`}>{e.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-componente: tab Ventas de prueba (solo dev)
// ---------------------------------------------------------------------------

function SalesTab({ onLog, onDataChanged }: { onLog: (entry: Omit<LogEntry, 'id'>) => void; onDataChanged?: () => void }) {
  const [count, setCount] = useState('10')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function generate(n: number) {
    setBusy(true)
    setMsg('')
    try {
      const result = await window.hw.devGenerateSales({ count: n })
      if (result.ok) {
        setMsg(`✓ ${result.data.created} venta(s) generada(s)`)
        onLog({ time: nowTime(), level: 'info', message: `${result.data.created} ventas de prueba generadas` })
        onDataChanged?.()
      } else {
        setMsg(`Error: ${result.error}`)
        onLog({ time: nowTime(), level: 'error', message: `Generar ventas: ${result.error}` })
      }
    } finally {
      setBusy(false)
    }
  }

  const parsedCount = Math.max(1, Math.min(200, parseInt(count, 10) || 0))

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-zinc-800/60 p-3 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Ventas ficticias</p>
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          Genera ventas confirmadas en el turno actual usando el catálogo real. Sirve para probar
          la lista de ventas, el balance en efectivo y el cierre de caja. Solo en modo dev.
        </p>

        <button
          onClick={() => void generate(1)}
          disabled={busy}
          className="w-full rounded border border-emerald-700 bg-emerald-900/40 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/60 disabled:opacity-40"
        >
          + 1 venta
        </button>

        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={count}
            onChange={e => setCount(e.target.value.replace(/[^0-9]/g, ''))}
            className="w-16 rounded bg-zinc-900 px-2 py-1.5 text-xs text-white text-center focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
          <button
            onClick={() => void generate(parsedCount)}
            disabled={busy}
            className="flex-1 rounded border border-zinc-700 bg-zinc-800/60 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            {busy ? 'Generando…' : `Generar ${parsedCount} ventas`}
          </button>
        </div>

        {msg && (
          <p className={`text-[10px] ${msg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{msg}</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function DevToolsPanel({ onDataChanged }: { onDataChanged?: () => void } = {}) {
  if (APP_ENV === 'production') return null

  const isSandbox = APP_ENV === 'dev'
  const [tab, setTab] = useState<TabId>('hardware')
  const [open, setOpen] = useState(false)
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const logCounter = useRef(0)

  function addLog(entry: Omit<LogEntry, 'id'>) {
    setLogEntries(prev => {
      const next = [...prev, { ...entry, id: ++logCounter.current }]
      return next.length > 100 ? next.slice(-100) : next
    })
  }

  const envLabel = isSandbox ? 'DEV — SANDBOX' : 'DEV — CAMPO'
  const envColor = isSandbox ? 'text-yellow-500 border-yellow-700/50 bg-yellow-950/20' : 'text-orange-400 border-orange-700/50 bg-orange-950/20'

  return (
    <div className={`border-t ${envColor}`}>
      {/* Header colapsable */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-3 py-2"
      >
        <span className={`text-[10px] font-bold uppercase tracking-wide ${isSandbox ? 'text-yellow-500' : 'text-orange-400'}`}>
          {envLabel}
        </span>
        <span className={`text-[10px] ${isSandbox ? 'text-yellow-600' : 'text-orange-600'}`}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {/* Tabs */}
          <div className="flex gap-1">
            <button
              onClick={() => setTab('hardware')}
              className={`flex-1 rounded py-1 text-[10px] font-semibold transition-colors ${
                tab === 'hardware'
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
              }`}
            >
              Hardware
            </button>
            <button
              onClick={() => setTab('plus')}
              className={`flex-1 rounded py-1 text-[10px] font-semibold transition-colors ${
                tab === 'plus'
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
              }`}
            >
              PLUs
            </button>
            <button
              onClick={() => setTab('sales')}
              className={`flex-1 rounded py-1 text-[10px] font-semibold transition-colors ${
                tab === 'sales'
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
              }`}
            >
              Ventas
            </button>
          </div>

          {tab === 'hardware' && (
            <div className="space-y-2">
              <HardwareTab onLog={addLog} />
              <EventLog entries={logEntries} />
            </div>
          )}

          {tab === 'plus' && (
            <div className="max-h-[70vh] overflow-y-auto pr-1">
              <PluManagerPanel />
            </div>
          )}

          {tab === 'sales' && (
            <div className="space-y-2">
              <SalesTab onLog={addLog} onDataChanged={onDataChanged} />
              <EventLog entries={logEntries} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
