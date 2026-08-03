/**
 * Historial de conteos de stock (solo admin).
 * Lista filtrable + detalle de ítems.
 */
import { useEffect, useState } from 'react'
import { formatKg, toLocalDate, toLocalDateTime } from '../lib/datetime'
import type { StockCountDetail, StockCountRow, StoreRow } from '../types/hw-api'
import StockCountModal from './StockCountModal'

interface Props {
  onBack: () => void
}

function gramsToKgLabel(grams: number | null): string {
  if (grams == null) return '—'
  return formatKg(grams / 1000)
}

export default function StockCountHistoryScreen({ onBack }: Props) {
  const [stores, setStores] = useState<StoreRow[]>([])
  const [storeFilter, setStoreFilter] = useState<string>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [list, setList] = useState<StockCountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<StockCountDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showNew, setShowNew] = useState(false)

  async function loadList() {
    setLoading(true)
    setError(null)
    const res = await window.hw.listStockCounts({
      storeId: storeFilter || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    })
    setLoading(false)
    if (!res.ok) {
      setError(res.error ?? 'Error al listar conteos.')
      setList([])
      return
    }
    setList(res.data)
  }

  useEffect(() => {
    void (async () => {
      const storesRes = await window.hw.getStores()
      if (storesRes.ok) setStores(storesRes.data.filter(s => !s.archivedAt))
      await loadList()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function openDetail(id: string) {
    setDetailLoading(true)
    setDetail(null)
    const res = await window.hw.getStockCountDetail({ stockCountId: id })
    setDetailLoading(false)
    if (!res.ok) {
      setError(res.error ?? 'Error al cargar detalle.')
      return
    }
    setDetail(res.data)
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      <header className="flex items-center gap-3 px-4 py-4 border-b border-gray-800">
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800 text-lg"
          title="Volver"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">Conteos de stock</h1>
          <p className="text-xs text-gray-500 truncate">Historial por local y fecha</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="shrink-0 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium transition-colors"
        >
          + Nuevo conteo
        </button>
      </header>

      <div className="px-4 py-3 border-b border-gray-800 flex flex-wrap gap-2 items-end">
        <div className="min-w-0">
          <label className="block text-[10px] text-gray-500 mb-0.5">Local</label>
          <select
            value={storeFilter}
            onChange={e => setStoreFilter(e.target.value)}
            className="rounded-lg bg-gray-900 border border-gray-700 px-2.5 py-1.5 text-sm text-white"
          >
            <option value="">Todos</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Desde</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="rounded-lg bg-gray-900 border border-gray-700 px-2.5 py-1.5 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Hasta</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="rounded-lg bg-gray-900 border border-gray-700 px-2.5 py-1.5 text-sm text-white"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadList()}
          className="shrink-0 rounded-lg px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-gray-200"
        >
          Filtrar
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && <p className="text-sm text-gray-500 text-center py-10">Cargando…</p>}

        {error && (
          <div className="rounded-xl bg-red-950/40 border border-red-800/60 p-3">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {!loading && list.length === 0 && !error && (
          <p className="text-sm text-gray-500 text-center py-10">No hay conteos con esos filtros.</p>
        )}

        {list.map(row => (
          <button
            key={row.id}
            type="button"
            onClick={() => void openDetail(row.id)}
            className="w-full text-left flex items-center gap-2 min-w-0 rounded-xl border border-gray-800 bg-gray-900 hover:border-gray-600 px-4 py-3 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate" title={row.storeName}>
                {toLocalDate(`${row.countDate}T12:00:00.000Z`)} · {row.storeName}
              </p>
              <p className="text-xs text-gray-500 truncate" title={row.recordedByName}>
                {row.itemCount} ítem{row.itemCount !== 1 ? 's' : ''} · {row.recordedByName} ·{' '}
                {toLocalDateTime(row.createdAt)}
              </p>
            </div>
            <span className="shrink-0 text-gray-600">›</span>
          </button>
        ))}
      </div>

      {(detail || detailLoading) && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
          onClick={e => {
            if (e.target === e.currentTarget) setDetail(null)
          }}
        >
          <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-700">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold truncate">Detalle del conteo</h2>
                {detail && (
                  <p className="text-[10px] text-gray-500 truncate" title={detail.storeName}>
                    {toLocalDate(`${detail.countDate}T12:00:00.000Z`)} · {detail.storeName}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="shrink-0 text-gray-400 hover:text-white px-2"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
              {detailLoading && <p className="text-sm text-gray-500 py-6 text-center">Cargando…</p>}
              {detail?.items.map(item => (
                <div
                  key={item.id}
                  className="flex items-start gap-2 min-w-0 rounded-lg border border-gray-800 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate" title={item.productName}>
                      <span className="text-gray-500 tabular-nums mr-1.5">{item.productId}</span>
                      {item.productName}
                    </p>
                    {item.notes && (
                      <p className="text-[11px] text-gray-500 truncate" title={item.notes}>
                        {item.notes}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs tabular-nums text-gray-300">
                    {item.quantityKg != null && <p>{gramsToKgLabel(item.quantityKg)}</p>}
                    {item.quantityUnits != null && <p>{item.quantityUnits} u.</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <StockCountModal
          storeId={storeFilter || undefined}
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false)
            void loadList()
          }}
        />
      )}
    </div>
  )
}
