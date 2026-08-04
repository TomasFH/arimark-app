/**
 * Formulario de conteo de stock (dominical / periódico).
 * kg → se persisten en gramos; unidades enteras con NumericInput.
 */
import { useEffect, useState } from 'react'
import DecimalInput from '../components/DecimalInput'
import NumericInput from '../components/NumericInput'
import { todayLocalYmd, toLocalDate } from '../lib/datetime'
import { parseDecimalInput, parseNumericInput } from '../lib/numericInput'
import type { CreateStockCountItemPayload, ProductRow } from '../types/hw-api'

interface Props {
  onClose: () => void
  /** Local a asociar (admin); si se omite usa el de la sesión en el main. */
  storeId?: string
  /** Fecha del conteo YYYY-MM-DD; default hoy local. */
  countDate?: string
  onSaved?: (countId: string) => void
}

interface DraftRow {
  product: ProductRow
  kgText: string
  unitsText: string
  notes: string
}

function kgToGrams(kg: number): number {
  return Math.round(kg * 1000)
}

export default function StockCountModal({ onClose, storeId, countDate, onSaved }: Props) {
  const date = countDate ?? todayLocalYmd()
  const dateLabel = toLocalDate(`${date}T12:00:00.000Z`)

  const [rows, setRows] = useState<DraftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successId, setSuccessId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      const res = await window.hw.getProducts()
      if (cancelled) return
      setLoading(false)
      if (!res.ok) {
        setError(res.error ?? 'Error al cargar productos.')
        return
      }
      const sorted = [...res.data].sort((a, b) => a.pluNumber - b.pluNumber || a.name.localeCompare(b.name, 'es-AR'))
      setRows(
        sorted.map(product => ({
          product,
          kgText: '',
          unitsText: '',
          notes: '',
        })),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function updateRow(productId: string, patch: Partial<Pick<DraftRow, 'kgText' | 'unitsText' | 'notes'>>) {
    setRows(prev =>
      prev.map(r => (r.product.id === productId ? { ...r, ...patch } : r)),
    )
    setError(null)
  }

  const searchNorm = search.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const filteredRows = searchNorm
    ? rows.filter(r => {
        const name = r.product.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const plu = String(r.product.pluNumber)
        return name.includes(searchNorm) || plu.includes(searchNorm)
      })
    : rows

  async function handleSave() {
    setError(null)
    const items: CreateStockCountItemPayload[] = []

    for (const row of rows) {
      const kg = row.kgText.trim() ? parseDecimalInput(row.kgText) : null
      const units = row.unitsText.trim() ? parseNumericInput(row.unitsText) : null

      if (row.kgText.trim() && (kg === null || kg < 0)) {
        setError(`Cantidad en kg inválida para ${row.product.name}.`)
        return
      }
      if (row.unitsText.trim() && (units === null || units < 0)) {
        setError(`Unidades inválidas para ${row.product.name}.`)
        return
      }

      const grams = kg != null && kg > 0 ? kgToGrams(kg) : null
      const unitsVal = units != null && units > 0 ? units : null
      if (grams == null && unitsVal == null) continue

      items.push({
        productId: row.product.pluNumber,
        productName: row.product.name,
        quantityKg: grams,
        quantityUnits: unitsVal,
        notes: row.notes.trim() || null,
      })
    }

    if (items.length === 0) {
      setError('Completá al menos un producto con cantidad.')
      return
    }

    setSaving(true)
    const res = await window.hw.createStockCount({
      countDate: date,
      storeId,
      items,
    })
    setSaving(false)

    if (!res.ok) {
      if (res.code === 'NO_SHIFT') {
        setError('Se necesita un turno abierto para registrar el conteo (cajera).')
      } else {
        setError(res.error ?? 'No se pudo guardar el conteo.')
      }
      return
    }

    setSuccessId(res.data.id)
    onSaved?.(res.data.id)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div className="flex flex-col bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh]">
        <div className="flex items-center justify-between gap-2 min-w-0 border-b border-zinc-700 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-white truncate">Conteo de stock</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate" title={dateLabel}>
              {dateLabel} · catálogo del local
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors disabled:opacity-50"
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

        {successId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <p className="text-emerald-300 font-medium">Conteo guardado</p>
            <p className="text-xs text-zinc-500">Quedó registrado para {dateLabel}.</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-lg px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {!loading && rows.length > 0 && (
                <div className="sticky top-0 z-10 pb-2 bg-zinc-900/95 backdrop-blur-sm">
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    maxLength={100}
                    placeholder="Buscar producto o PLU…"
                    disabled={saving}
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                  {searchNorm && (
                    <p className="text-[10px] text-zinc-500 mt-1">
                      {filteredRows.length} de {rows.length} productos
                    </p>
                  )}
                </div>
              )}

              {loading && (
                <p className="text-sm text-zinc-500 text-center py-8">Cargando productos…</p>
              )}

              {!loading && rows.length === 0 && !error && (
                <p className="text-sm text-zinc-500 text-center py-8">No hay productos en el catálogo.</p>
              )}

              {!loading && filteredRows.length === 0 && rows.length > 0 && (
                <p className="text-sm text-zinc-500 text-center py-6">Ningún producto coincide con la búsqueda.</p>
              )}

              {!loading &&
                filteredRows.map(row => (
                  <div
                    key={row.product.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2.5 space-y-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 text-[10px] text-zinc-500 tabular-nums w-8">
                        {row.product.pluNumber}
                      </span>
                      <p className="min-w-0 flex-1 text-sm text-white truncate" title={row.product.name}>
                        {row.product.name}
                      </p>
                      <span className="shrink-0 text-[10px] text-zinc-600 uppercase">
                        {row.product.unit === 'kg' ? 'kg' : 'unid.'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {(row.product.unit === 'kg' || row.product.unit === 'unit') && (
                        <>
                          {row.product.unit === 'kg' ? (
                            <div className="col-span-1">
                              <label className="block text-[10px] text-zinc-500 mb-0.5">Kg</label>
                              <DecimalInput
                                value={row.kgText}
                                onChange={v => updateRow(row.product.id, { kgText: v })}
                                maxDecimals={3}
                                weightMode
                                disabled={saving}
                                placeholder="0,000"
                                className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-2.5 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                              />
                            </div>
                          ) : (
                            <div className="col-span-1">
                              <label className="block text-[10px] text-zinc-500 mb-0.5">Unidades</label>
                              <NumericInput
                                value={row.unitsText}
                                onChange={v => updateRow(row.product.id, { unitsText: v })}
                                disabled={saving}
                                placeholder="0"
                                className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-2.5 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                              />
                            </div>
                          )}
                          <div className="col-span-1 sm:col-span-2">
                            <label className="block text-[10px] text-zinc-500 mb-0.5">Nota (opcional)</label>
                            <input
                              type="text"
                              value={row.notes}
                              maxLength={500}
                              disabled={saving}
                              onChange={e => updateRow(row.product.id, { notes: e.target.value })}
                              className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-2.5 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                              placeholder="—"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}

              {error && (
                <div className="rounded-lg bg-red-950/40 border border-red-800/60 px-3 py-2">
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-700 px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="shrink-0 rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || loading || rows.length === 0}
                className="shrink-0 rounded-lg px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Guardar conteo'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
