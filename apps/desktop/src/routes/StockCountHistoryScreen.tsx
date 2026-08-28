/**
 * Historial de conteos de stock (solo admin).
 * Lista filtrable + detalle de ítems.
 */
import { useEffect, useState } from 'react'
import BackButton from '../components/BackButton'
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

function originalChangedLabel(
  item: { productId: number; quantityKg: number | null; quantityUnits: number | null },
  originalItems: StockCountDetail['originalItems'],
): string | null {
  if (!originalItems) return null
  const orig = originalItems.find(o => o.productId === item.productId)
  if (!orig) return null
  const kgChanged = (orig.quantityKg ?? null) !== (item.quantityKg ?? null)
  const unitsChanged = (orig.quantityUnits ?? null) !== (item.quantityUnits ?? null)
  if (!kgChanged && !unitsChanged) return null
  const parts: string[] = []
  if (kgChanged && orig.quantityKg != null) parts.push(gramsToKgLabel(orig.quantityKg))
  if (unitsChanged && orig.quantityUnits != null) parts.push(`${orig.quantityUnits} u.`)
  return parts.length > 0 ? parts.join(' ') : null
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
  const [detailSearch, setDetailSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [resumeStoreId, setResumeStoreId] = useState<string | undefined>()
  const [resumeCountDate, setResumeCountDate] = useState<string | undefined>()
  const [discardId, setDiscardId] = useState<string | null>(null)

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

  const detailSearchNorm = detailSearch.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const filteredDetailItems = !detail
    ? []
    : detailSearchNorm
      ? detail.items.filter(item => {
          const name = item.productName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          const plu = String(item.productId)
          return name.includes(detailSearchNorm) || plu.includes(detailSearchNorm)
        })
      : detail.items

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
    setDetailSearch('')
    const res = await window.hw.getStockCountDetail({ stockCountId: id })
    setDetailLoading(false)
    if (!res.ok) {
      setError(res.error ?? 'Error al cargar detalle.')
      return
    }
    setDetail(res.data)
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-6 py-3 shrink-0">
        <BackButton onClick={onBack} />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-zinc-100 truncate">Conteos de stock</h1>
          <p className="text-[10px] text-zinc-500 truncate">Historial por local y fecha</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setResumeStoreId(undefined)
            setResumeCountDate(undefined)
            setShowNew(true)
          }}
          className="shrink-0 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium transition-colors"
        >
          + Nuevo conteo
        </button>
      </header>

      <div className="px-4 py-3 border-b border-zinc-700 bg-zinc-800 flex flex-wrap gap-2 items-end">
        <div className="min-w-0">
          <label className="block text-[10px] text-zinc-500 mb-0.5">Local</label>
          <select
            value={storeFilter}
            onChange={e => setStoreFilter(e.target.value)}
            className="rounded-lg bg-zinc-800 border border-zinc-600 px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500"
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
          <label className="block text-[10px] text-zinc-500 mb-0.5">Desde</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="rounded-lg bg-zinc-800 border border-zinc-600 px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="block text-[10px] text-zinc-500 mb-0.5">Hasta</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="rounded-lg bg-zinc-800 border border-zinc-600 px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadList()}
          className="shrink-0 rounded-lg px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
        >
          Filtrar
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && <p className="text-sm text-zinc-500 text-center py-10">Cargando…</p>}

        {error && (
          <div className="rounded-xl bg-red-950/30 border border-red-900/50 p-3">
            <p className="text-sm text-red-400/80">{error}</p>
          </div>
        )}

        {!loading && list.length === 0 && !error && (
          <p className="text-sm text-zinc-500 text-center py-10">No hay conteos con esos filtros.</p>
        )}

        {list.map(row => (
          <div
            key={row.id}
            className="flex items-center gap-2 min-w-0 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3"
          >
            <button
              type="button"
              onClick={() => {
                if (row.status === 'draft') {
                  setResumeStoreId(row.storeId)
                  setResumeCountDate(row.countDate)
                  setShowNew(true)
                  return
                }
                void openDetail(row.id)
              }}
              className="min-w-0 flex-1 text-left flex items-center gap-2 hover:text-white"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="min-w-0 flex-1 text-sm font-medium truncate" title={row.storeName}>
                    {toLocalDate(`${row.countDate}T12:00:00.000Z`)} · {row.storeName}
                  </p>
                  {row.status === 'draft' && (
                    <span className="shrink-0 rounded-md bg-amber-950/60 border border-amber-800/50 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                      Borrador
                    </span>
                  )}
                  {row.lastEditedBy && row.lastEditedBy !== row.recordedBy && (
                    <span
                      className="shrink-0 rounded-md bg-zinc-700 border border-zinc-600 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 truncate max-w-[10rem]"
                      title={row.lastEditedByName ?? undefined}
                    >
                      Editado por {row.lastEditedByName ?? 'admin'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 truncate" title={row.recordedByName}>
                  {row.itemCount} ítem{row.itemCount !== 1 ? 's' : ''} · {row.recordedByName} ·{' '}
                  {toLocalDateTime(row.updatedAt ?? row.createdAt)}
                </p>
              </div>
              <span className="shrink-0 text-zinc-500 text-xs">
                {row.status === 'draft' ? 'Continuar' : '›'}
              </span>
            </button>
            {row.status === 'draft' && (
              discardId === row.id ? (
                <div className="shrink-0 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await window.hw.discardStockCountDraft({ stockCountId: row.id })
                      setDiscardId(null)
                      if (!res.ok) {
                        setError(res.error ?? 'No se pudo descartar el borrador.')
                        return
                      }
                      void loadList()
                    }}
                    className="rounded-md px-2 py-1 text-[10px] font-medium bg-red-800 hover:bg-red-700 text-white"
                  >
                    Sí, descartar
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscardId(null)}
                    className="rounded-md px-2 py-1 text-[10px] text-zinc-400 hover:text-white"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setDiscardId(row.id)}
                  className="shrink-0 rounded-md px-2 py-1 text-[10px] text-zinc-500 hover:text-red-300"
                >
                  Descartar
                </button>
              )
            )}
          </div>
        ))}
      </div>

      {(detail || detailLoading) && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
          onClick={e => {
            if (e.target === e.currentTarget) setDetail(null)
          }}
        >
          <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border border-zinc-700 bg-zinc-800 shadow-2xl">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-700">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold truncate">Detalle del conteo</h2>
                {detail && (
                  <p className="text-[10px] text-zinc-500 truncate" title={detail.storeName}>
                    {toLocalDate(`${detail.countDate}T12:00:00.000Z`)} · {detail.storeName}
                    {detail.lastEditedBy && detail.lastEditedBy !== detail.recordedBy
                      ? ` · Anotó ${detail.recordedByName} · Editó ${detail.lastEditedByName ?? 'admin'}`
                      : ` · ${detail.recordedByName}`}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="shrink-0 text-zinc-400 hover:text-white px-2"
              >
                ✕
              </button>
            </div>
            <div className="shrink-0 px-4 pt-3 pb-2 bg-zinc-800 border-b border-zinc-700">
              {!detailLoading && detail && (
                <input
                  type="text"
                  value={detailSearch}
                  onChange={e => setDetailSearch(e.target.value)}
                  maxLength={100}
                  placeholder="Buscar producto o PLU…"
                  className="w-full rounded-lg bg-zinc-700 border border-zinc-600 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                />
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
              {detailLoading && <p className="text-sm text-zinc-500 py-6 text-center">Cargando…</p>}
              {!detailLoading && detail && filteredDetailItems.length === 0 && (
                <p className="text-sm text-zinc-500 py-6 text-center">Ningún producto coincide.</p>
              )}
              {detail?.items && filteredDetailItems.map(item => {
                const origLabel = detail.lastEditedBy && detail.lastEditedBy !== detail.recordedBy
                  ? originalChangedLabel(item, detail.originalItems)
                  : null
                return (
                <div
                  key={item.id}
                  className="flex items-start gap-2 min-w-0 rounded-lg border border-zinc-600 bg-zinc-700 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate" title={item.productName}>
                      <span className="text-zinc-500 tabular-nums mr-1.5">{item.productId}</span>
                      {item.productName}
                    </p>
                    {item.notes && (
                      <p className="text-[11px] text-zinc-500 truncate" title={item.notes}>
                        {item.notes}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs tabular-nums text-zinc-300">
                    {item.quantityKg != null && <p>{gramsToKgLabel(item.quantityKg)}</p>}
                    {item.quantityUnits != null && <p>{item.quantityUnits} u.</p>}
                    {origLabel && (
                      <p className="text-[10px] text-zinc-500" title={`Original: ${origLabel}`}>
                        <span className="line-through">{origLabel}</span> original
                      </p>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
            {detail && (
              <div className="shrink-0 flex justify-end gap-2 border-t border-zinc-700 px-4 py-3">
                <button
                  type="button"
                  onClick={() => {
                    setResumeStoreId(detail.storeId)
                    setResumeCountDate(detail.countDate)
                    setDetail(null)
                    setShowNew(true)
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  Editar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showNew && (
        <StockCountModal
          storeId={resumeStoreId || storeFilter || undefined}
          countDate={resumeCountDate}
          onClose={() => {
            setShowNew(false)
            setResumeStoreId(undefined)
            setResumeCountDate(undefined)
          }}
          onSaved={() => {
            setShowNew(false)
            setResumeStoreId(undefined)
            setResumeCountDate(undefined)
            void loadList()
          }}
        />
      )}
    </div>
  )
}
