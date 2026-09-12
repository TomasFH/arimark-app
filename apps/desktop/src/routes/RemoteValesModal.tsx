/**
 * Lista remota de vales (Firestore) — útil en admin desde otra PC o sin SQLite del local.
 */
import { useCallback, useEffect, useState } from 'react'
import { formatARS, toLocalDateTime } from '../lib/datetime'
import type { RemoteEmployeeValeRow, StoreRow } from '../types/hw-api'

interface Props {
  onClose: () => void
}

export default function RemoteValesModal({ onClose }: Props) {
  const [stores, setStores] = useState<StoreRow[]>([])
  const [storeIdFilter, setStoreIdFilter] = useState('all')
  const [vales, setVales] = useState<RemoteEmployeeValeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.hw.getStores().then(r => {
      if (r.ok) setStores(r.data.filter(s => !s.archivedAt))
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const r = await window.hw.getRemoteEmployeeVales({ storeIdFilter })
    setLoading(false)
    if (!r.ok) {
      setError(r.error ?? 'Error al cargar vales.')
      setVales([])
      return
    }
    setVales(r.data)
  }, [storeIdFilter])

  useEffect(() => {
    void load()
  }, [load])

  const total = vales.reduce((s, v) => s + v.amount, 0)
  const byEmployee = new Map<string, { name: string; total: number; count: number }>()
  for (const v of vales) {
    const prev = byEmployee.get(v.employeeId)
    if (prev) {
      prev.total += v.amount
      prev.count += 1
    } else {
      byEmployee.set(v.employeeId, { name: v.employeeName, total: v.amount, count: 1 })
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex flex-col bg-input border border-line rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh]">
        <div className="flex items-center justify-between gap-2 min-w-0 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-ink truncate">Vales (remoto)</h2>
            <p className="text-[10px] text-muted mt-0.5">Desde Firestore · solo lectura</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-muted hover:bg-hover hover:text-ink transition-colors"
            aria-label="Cerrar"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <div className="px-5 py-3 border-b border-line flex items-end gap-2">
          <label className="min-w-0 flex-1 text-xs text-muted">
            Local
            <select
              value={storeIdFilter}
              onChange={e => setStoreIdFilter(e.target.value)}
              className="mt-1 w-full rounded-lg bg-input border border-line px-3 py-2 text-sm text-ink"
            >
              <option value="all">Todos</option>
              {stores.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="shrink-0 rounded-lg px-3 py-2 text-sm text-danger hover:text-danger disabled:opacity-50"
          >
            Actualizar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {loading && <p className="text-sm text-muted text-center py-8">Cargando…</p>}

          {error && (
            <div className="rounded-lg bg-danger/10 border border-danger/30 px-3 py-2">
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {!loading && !error && vales.length === 0 && (
            <p className="text-sm text-muted text-center py-8">
              No hay vales sincronizados{storeIdFilter !== 'all' ? ' para este local' : ''}.
            </p>
          )}

          {!loading && vales.length > 0 && (
            <div className="rounded-xl border border-line bg-raised px-3 py-3 space-y-2 mb-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">Total</span>
                <span className="text-sm font-medium text-amber-300 tabular-nums">{formatARS(total)}</span>
              </div>
              {Array.from(byEmployee.entries()).map(([employeeId, t]) => (
                <div key={employeeId} className="flex items-center gap-2 min-w-0 text-xs">
                  <span className="min-w-0 flex-1 truncate text-ink" title={t.name}>
                    {t.name}
                    <span className="text-subtle"> · {t.count}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-amber-300/90">{formatARS(t.total)}</span>
                </div>
              ))}
            </div>
          )}

          {!loading &&
            vales.map(v => {
              const itemNames = v.items.map(i => i.productName).join(', ')
              const subtitle = itemNames || v.description || 'Adelanto en efectivo'
              return (
                <div
                  key={v.id}
                  className="rounded-xl border border-line bg-raised px-3 py-2.5 space-y-1"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="min-w-0 flex-1 text-sm text-ink truncate" title={v.employeeName}>
                      {v.employeeName}
                    </p>
                    <span className="shrink-0 text-sm font-medium text-amber-300 tabular-nums">
                      {formatARS(v.amount)}
                    </span>
                  </div>
                  <p className="text-xs text-muted truncate" title={subtitle}>{subtitle}</p>
                  <p className="text-[10px] text-subtle">{toLocalDateTime(v.paidAt)}</p>
                </div>
              )
            })}
        </div>

        <div className="flex justify-end border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-4 py-2 text-sm text-muted hover:text-ink hover:bg-hover transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
