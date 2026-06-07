/**
 * Panel de diagnóstico — visible en sandbox y fieldtest, oculto en producción.
 *
 * Tabs:
 *  - "Hardware": estado en tiempo real, configuración de periféricos, log de eventos.
 *  - "Simulador": inyección de pedidos mock (solo sandbox).
 */

import { useState, useEffect, useRef } from 'react'
import DevScaleTicketPanel from './DevScaleTicketPanel'
import type { HardwareStatus, HardwareConfig } from '../types/hw-api'

const APP_ENV = import.meta.env['VITE_APP_ENV'] as string

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

type TabId = 'hardware' | 'simulator'

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
    disconnected: 'bg-gray-500',
    error: 'bg-red-500 animate-pulse',
    unknown: 'bg-gray-600',
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
      <span className="text-xs text-gray-400">{labels[status]}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Sub-componente: tab Hardware
// ---------------------------------------------------------------------------

function HardwareTab({ onLog }: { onLog: (entry: Omit<LogEntry, 'id'>) => void }) {
  const [hwStatus, setHwStatus] = useState<HardwareStatus>({ scale: 'disconnected', fiscal: 'disconnected' })
  const [config, setConfig] = useState<HardwareConfig>({})
  const [editPort, setEditPort] = useState('')
  const [editIp, setEditIp] = useState('')
  const [editUser, setEditUser] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Cargar estado y config al montar
  useEffect(() => {
    window.hw.getHardwareStatus().then(r => {
      if (r.ok) setHwStatus(r.data)
    })
    window.hw.getHardwareConfig().then(r => {
      if (r.ok) {
        setConfig(r.data)
        setEditPort(r.data.kretzPort ?? '')
        setEditIp(r.data.sam4sIp ?? '')
        setEditUser(r.data.sam4sUser ?? '')
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
      if (status.fiscal === 'connected') onLog({ time: nowTime(), level: 'info', message: 'SAM4S conectada' })
      if (status.fiscal === 'disconnected') onLog({ time: nowTime(), level: 'warn', message: 'SAM4S desconectada' })
      if (status.fiscal === 'error') onLog({ time: nowTime(), level: 'error', message: 'SAM4S — error de conexión' })
    })
    return unsub
  }, [onLog])

  async function handleSave() {
    setSaving(true)
    setSaveMsg('')
    try {
      const payload: Record<string, string> = {}
      if (editPort !== (config.kretzPort ?? '')) payload['kretzPort'] = editPort
      if (editIp !== (config.sam4sIp ?? '')) payload['sam4sIp'] = editIp
      if (editUser !== (config.sam4sUser ?? '')) payload['sam4sUser'] = editUser
      if (editPassword) payload['sam4sPassword'] = editPassword

      if (Object.keys(payload).length === 0) {
        setSaveMsg('Sin cambios.')
        return
      }

      const result = await window.hw.setHardwareConfig(payload)
      if (result.ok) {
        setSaveMsg('Guardado. Reiniciá la app para aplicar los cambios.')
        setConfig(prev => ({ ...prev, kretzPort: editPort || undefined, sam4sIp: editIp || undefined, sam4sUser: editUser || undefined }))
        setEditPassword('')
        onLog({ time: nowTime(), level: 'info', message: 'Configuración de hardware guardada' })
      } else {
        setSaveMsg(`Error: ${result.error}`)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleTestFiscal() {
    onLog({ time: nowTime(), level: 'info', message: 'Probando conexión SAM4S…' })
    const r = await window.hw.getHardwareStatus()
    if (r.ok) {
      const msg = r.data.fiscal === 'connected' ? 'SAM4S responde OK' : `SAM4S — estado: ${r.data.fiscal}`
      const level = r.data.fiscal === 'connected' ? 'info' : 'warn'
      onLog({ time: nowTime(), level, message: msg })
    }
  }

  return (
    <div className="space-y-3">
      {/* Estado en tiempo real */}
      <div className="rounded-lg bg-gray-800/60 p-3 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Estado en vivo</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded bg-gray-900/60 p-2 space-y-1">
            <p className="text-[10px] font-semibold text-gray-400">Balanza KRETZ</p>
            <StatusDot status={hwStatus.scale} />
            {APP_ENV === 'fieldtest' && (
              <p className="text-[10px] text-gray-600">Puerto: {config.kretzPort || '—'}</p>
            )}
          </div>
          <div className="rounded bg-gray-900/60 p-2 space-y-1">
            <p className="text-[10px] font-semibold text-gray-400">Caja SAM4S</p>
            <StatusDot status={hwStatus.fiscal} />
            {APP_ENV === 'fieldtest' && (
              <p className="text-[10px] text-gray-600">IP: {config.sam4sIp || '—'}</p>
            )}
          </div>
        </div>
        {APP_ENV === 'fieldtest' && (
          <button
            onClick={handleTestFiscal}
            className="w-full rounded border border-gray-700 bg-gray-800 py-1 text-[10px] text-gray-400 hover:bg-gray-700 hover:text-white"
          >
            Verificar estado SAM4S
          </button>
        )}
      </div>

      {/* Configuración de hardware (solo fieldtest) */}
      {APP_ENV === 'fieldtest' && (
        <div className="rounded-lg bg-gray-800/60 p-3 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Configurar hardware</p>

          <div>
            <label className="text-[10px] text-gray-500">Puerto KRETZ (ej. COM3)</label>
            <input
              type="text"
              value={editPort}
              onChange={e => setEditPort(e.target.value)}
              placeholder="COM3"
              className="mt-0.5 w-full rounded bg-gray-900 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">IP SAM4S (ej. 192.168.1.x)</label>
            <input
              type="text"
              value={editIp}
              onChange={e => setEditIp(e.target.value)}
              placeholder="192.168.1.100"
              className="mt-0.5 w-full rounded bg-gray-900 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">Usuario SAM4S</label>
            <input
              type="text"
              value={editUser}
              onChange={e => setEditUser(e.target.value)}
              placeholder="USER"
              className="mt-0.5 w-full rounded bg-gray-900 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">Contraseña SAM4S</label>
            <input
              type="password"
              value={editPassword}
              onChange={e => setEditPassword(e.target.value)}
              placeholder="(dejar vacío para no cambiar)"
              className="mt-0.5 w-full rounded bg-gray-900 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-orange-500"
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
            className="w-full rounded border border-orange-700 bg-orange-900/40 py-1.5 text-xs font-semibold text-orange-300 hover:bg-orange-900/60 disabled:opacity-40"
          >
            {saving ? 'Guardando…' : 'Guardar y reiniciar para aplicar'}
          </button>
        </div>
      )}
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
    info: 'text-gray-400',
    warn: 'text-yellow-400',
    error: 'text-red-400',
  }

  return (
    <div className="rounded-lg bg-gray-800/60 p-2 space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">
        Log de eventos ({entries.length})
      </p>
      <div className="h-28 overflow-y-auto space-y-0.5 font-mono">
        {entries.length === 0 && (
          <p className="text-[10px] text-gray-600 italic">Sin eventos aún…</p>
        )}
        {entries.map(e => (
          <div key={e.id} className="flex gap-1.5 text-[10px]">
            <span className="shrink-0 text-gray-600">{e.time}</span>
            <span className={`${levelColors[e.level]}`}>{e.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function DevToolsPanel() {
  if (APP_ENV === 'production') return null

  const isSandbox = APP_ENV === 'sandbox'
  const [tab, setTab] = useState<TabId>(APP_ENV === 'fieldtest' ? 'hardware' : 'hardware')
  const [open, setOpen] = useState(true)
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const logCounter = useRef(0)

  function addLog(entry: Omit<LogEntry, 'id'>) {
    setLogEntries(prev => {
      const next = [...prev, { ...entry, id: ++logCounter.current }]
      return next.length > 100 ? next.slice(-100) : next
    })
  }

  // Escuchar pedidos de balanza y loguearlos
  useEffect(() => {
    const unsub = window.hw.onScaleOrder(order => {
      addLog({
        time: nowTime(),
        level: 'info',
        message: `Pedido recibido — canal ${order.channel}, ${order.items.length} ítem(s), total: $${order.total.toFixed(2)}`,
      })
    })
    return unsub
  }, [])

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
                  ? isSandbox ? 'bg-yellow-700 text-white' : 'bg-orange-700 text-white'
                  : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
              }`}
            >
              Hardware
            </button>
            {isSandbox && (
              <button
                onClick={() => setTab('simulator')}
                className={`flex-1 rounded py-1 text-[10px] font-semibold transition-colors ${
                  tab === 'simulator'
                    ? 'bg-yellow-700 text-white'
                    : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
                }`}
              >
                Simulador
              </button>
            )}
          </div>

          {tab === 'hardware' && (
            <div className="space-y-2">
              <HardwareTab onLog={addLog} />
              <EventLog entries={logEntries} />
            </div>
          )}

          {tab === 'simulator' && isSandbox && (
            // Reutilizamos DevScaleTicketPanel pero sin su propio guard de isSandbox
            // DevScaleTicketPanel ya retorna null si no es sandbox, así que acá
            // el tab solo aparece en sandbox — funciona correctamente.
            <DevScaleTicketPanel />
          )}
        </div>
      )}
    </div>
  )
}
