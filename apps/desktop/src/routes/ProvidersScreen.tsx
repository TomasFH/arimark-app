/**
 * ProvidersScreen — gestión de proveedores (solo admin).
 *
 * Muestra lista de proveedores con deuda combinada cross-local leída desde Firestore.
 * Permite crear, editar, archivar proveedores y ver el historial de eventos de deuda.
 * Fallback a datos locales cuando Firebase no está disponible (dev / sin conexión).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatARS, toLocalDateTime } from '../lib/datetime'
import type { ProviderWithDebtRow, ProviderRow, ProviderDebtEventRow } from '../types/hw-api'

interface Props {
  onBack: () => void
}

type ModalMode =
  | { type: 'none' }
  | { type: 'create' }
  | { type: 'edit'; provider: ProviderRow }
  | { type: 'archive'; provider: ProviderWithDebtRow }
  | { type: 'history'; provider: ProviderWithDebtRow }

export default function ProvidersScreen({ onBack }: Props) {
  const [loading, setLoading] = useState(true)
  const [list, setList] = useState<ProviderWithDebtRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalMode>({ type: 'none' })

  async function load() {
    setLoading(true)
    setError(null)
    const r = await window.hw.getProvidersWithDebt()
    setLoading(false)
    if (r.ok) {
      setList(r.data)
    } else {
      setError(r.error ?? 'Error al cargar proveedores.')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function toggleExpand(id: string) {
    setExpandedId(prev => prev === id ? null : id)
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-4 border-b border-gray-800">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800 text-lg"
          title="Volver"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">Proveedores</h1>
          <p className="text-xs text-gray-500">Deuda combinada entre todos los locales</p>
        </div>
        <button
          onClick={() => setModal({ type: 'create' })}
          className="shrink-0 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium transition-colors"
        >
          + Nuevo
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center items-center py-16">
            <p className="text-gray-500 text-sm">Cargando proveedores…</p>
          </div>
        )}

        {error && !loading && (
          <div className="mx-4 mt-4 p-4 rounded-xl bg-red-950/40 border border-red-800/60">
            <p className="text-red-300 text-sm">{error}</p>
            <button onClick={() => void load()} className="mt-2 text-xs text-blue-400 hover:underline">
              Reintentar
            </button>
          </div>
        )}

        {!loading && !error && (
          <div className="p-4 space-y-3">
            {list.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500 text-sm">No hay proveedores registrados.</p>
                <p className="text-gray-600 text-xs mt-1">Los proveedores se crean al registrar gastos o desde el botón "+ Nuevo".</p>
              </div>
            )}

            {list.map(p => {
              const isExpanded = expandedId === p.id
              // "Sin deuda" solo cuando ningún local tiene balance positivo.
              // Si algún local tiene deuda pero otro tiene saldo a favor que lo compensa,
              // el total puede ser 0 o negativo aunque exista deuda real en algún local.
              const anyStoreHasDebt = p.perStore.some(s => s.balance > 0)
              const hasDebt = p.total > 0 || anyStoreHasDebt
              const isCompensated = !hasDebt && anyStoreHasDebt

              return (
                <div
                  key={p.id}
                  className={`rounded-xl border transition-colors ${
                    hasDebt
                      ? 'border-orange-800/50 bg-orange-950/20'
                      : 'border-gray-800 bg-gray-900'
                  }`}
                >
                  {/* Fila principal */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      className="flex-1 min-w-0 flex items-center gap-3 text-left"
                      onClick={() => toggleExpand(p.id)}
                    >
                      <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 shrink-0">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate" title={p.name}>{p.name}</p>
                        {p.total > 0 && (
                          <p className="text-xs text-orange-400">
                            Deuda total: {formatARS(p.total)}
                          </p>
                        )}
                        {!p.total && anyStoreHasDebt && (
                          <p className="text-xs text-amber-400">Saldo compensado entre locales</p>
                        )}
                        {!hasDebt && !isCompensated && (
                          <p className="text-xs text-green-500">Sin deuda pendiente</p>
                        )}
                      </div>
                      <span className="text-gray-600 text-sm shrink-0">
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </button>

                    {/* Acciones */}
                    <button
                      onClick={() => setModal({ type: 'history', provider: p })}
                      className="shrink-0 text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded-lg hover:bg-gray-800 transition-colors"
                      title="Ver historial de movimientos"
                    >
                      Historial
                    </button>
                    <button
                      onClick={() => setModal({ type: 'edit', provider: { id: p.id, name: p.name } })}
                      className="shrink-0 text-xs text-gray-400 hover:text-white px-2 py-1 rounded-lg hover:bg-gray-800 transition-colors"
                      title="Editar proveedor"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => setModal({ type: 'archive', provider: p })}
                      className="shrink-0 text-xs text-gray-500 hover:text-red-400 px-2 py-1 rounded-lg hover:bg-gray-800 transition-colors"
                      title="Archivar proveedor"
                    >
                      Archivar
                    </button>
                  </div>

                  {/* Desglose por local */}
                  {isExpanded && (
                    <div className="border-t border-gray-800/60 px-4 py-3 space-y-2">
                      {p.perStore.length === 0 && (
                        <p className="text-xs text-gray-500">Sin eventos de deuda registrados.</p>
                      )}
                      {p.perStore.map(s => (
                        <div key={s.storeId} className="flex items-center justify-between gap-2">
                          <p className="text-sm text-gray-300 min-w-0 truncate" title={s.storeName}>{s.storeName}</p>
                          <p className={`text-sm font-semibold shrink-0 ${s.balance > 0 ? 'text-orange-400' : 'text-green-400'}`}>
                            {s.balance > 0 ? formatARS(s.balance) : 'Sin deuda'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modales */}
      {modal.type === 'create' && (
        <ProviderFormModal
          title="Nuevo proveedor"
          onSave={async (name, phone, notes) => {
            const r = await window.hw.createProvider({ name, phone: phone || undefined, notes: notes || undefined })
            if (!r.ok) return r.error ?? 'Error al crear proveedor.'
            setModal({ type: 'none' })
            void load()
            return null
          }}
          onCancel={() => setModal({ type: 'none' })}
        />
      )}

      {modal.type === 'edit' && (
        <ProviderFormModal
          title="Editar proveedor"
          initialName={modal.provider.name}
          onSave={async (name, phone, notes) => {
            const r = await window.hw.updateProvider({ id: modal.provider.id, name, phone: phone || null, notes: notes || null })
            if (!r.ok) return r.error ?? 'Error al actualizar proveedor.'
            setModal({ type: 'none' })
            void load()
            return null
          }}
          onCancel={() => setModal({ type: 'none' })}
        />
      )}

      {modal.type === 'archive' && (
        <ConfirmArchiveModal
          providerName={modal.provider.name}
          hasDebt={modal.provider.total > 0}
          debtAmount={modal.provider.total}
          onConfirm={async () => {
            const r = await window.hw.archiveProvider({ id: modal.provider.id })
            if (!r.ok) return r.error ?? 'Error al archivar proveedor.'
            setModal({ type: 'none' })
            void load()
            return null
          }}
          onCancel={() => setModal({ type: 'none' })}
        />
      )}

      {modal.type === 'history' && (
        <ProviderDebtHistoryModal
          provider={modal.provider}
          onClose={() => setModal({ type: 'none' })}
          onSettled={() => void load()}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

interface ProviderFormModalProps {
  title: string
  initialName?: string
  onSave: (name: string, phone: string, notes: string) => Promise<string | null>
  onCancel: () => void
}

function ProviderFormModal({ title, initialName = '', onSave, onCancel }: ProviderFormModalProps) {
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!name.trim()) { setError('El nombre es obligatorio.'); return }
    setSaving(true)
    setError(null)
    const err = await onSave(name.trim(), phone.trim(), notes.trim())
    setSaving(false)
    if (err) setError(err)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">{title}</h2>

        <div className="space-y-1">
          <label className="text-sm text-gray-400">Nombre *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nombre del proveedor"
            maxLength={100}
            autoFocus
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-400">Teléfono (opcional)</label>
          <input
            type="text"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="11-1234-5678"
            maxLength={50}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-400">Notas (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Días de visita, productos…"
            maxLength={300}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40 text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold transition-colors disabled:opacity-40 text-sm"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

interface ProviderDebtHistoryModalProps {
  provider: ProviderWithDebtRow
  onClose: () => void
  onSettled?: () => void
}

function ProviderDebtHistoryModal({ provider, onClose, onSettled }: ProviderDebtHistoryModalProps) {
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<ProviderDebtEventRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [settleConfirm, setSettleConfirm] = useState(false)
  const [settling, setSettling] = useState(false)
  const settlingRef = useRef(false)
  const [settleError, setSettleError] = useState<string | null>(null)
  // Filtro por local: null = todos los locales, string = storeId específico
  const [storeFilter, setStoreFilter] = useState<string | null>(null)

  async function fetchHistory() {
    setLoading(true)
    setError(null)
    const r = await window.hw.getProviderDebtHistory({ providerId: provider.id })
    setLoading(false)
    if (r.ok) {
      setEvents(r.data)
    } else {
      setError(r.error ?? 'Error al cargar historial.')
    }
  }

  useEffect(() => {
    void fetchHistory()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id])

  // Locales distintos que aparecen en los eventos (para las pestañas de filtro).
  const storeList = useMemo(() => {
    const seen = new Set<string>()
    const result: Array<{ storeId: string; storeName: string }> = []
    for (const evt of events) {
      if (!seen.has(evt.storeId)) {
        seen.add(evt.storeId)
        result.push({ storeId: evt.storeId, storeName: evt.storeName })
      }
    }
    return result
  }, [events])

  // Eventos filtrados por local y balance progresivo recalculado solo para los filtrados.
  // Los eventos llegan newest-first; se invierte para calcular, se re-invierte para mostrar.
  const displayEvents = useMemo(() => {
    const filtered = storeFilter
      ? events.filter(e => e.storeId === storeFilter)
      : events
    const reversed = [...filtered].reverse()
    let balance = 0
    const result = reversed.map(evt => {
      balance += evt.type === 'debt' ? evt.amount : -evt.amount
      return { ...evt, runningBalance: balance }
    })
    return result.reverse()
  }, [events, storeFilter])

  // Saldo actual: el running balance del evento más reciente en la vista activa.
  const currentBalance = displayEvents[0]?.runningBalance ?? (storeFilter ? 0 : provider.total)

  // Balance desglosado por local (para saldar desde la vista "Todos" correctamente).
  // Solo incluye locales con deuda positiva.
  const perStoreBalances = useMemo(() => {
    const map: Record<string, { storeName: string; balance: number }> = {}
    for (const evt of events) {
      if (!map[evt.storeId]) map[evt.storeId] = { storeName: evt.storeName, balance: 0 }
      map[evt.storeId].balance += evt.type === 'debt' ? evt.amount : -evt.amount
    }
    return Object.entries(map)
      .filter(([, v]) => v.balance > 0)
      .map(([storeId, v]) => ({ storeId, ...v }))
  }, [events])

  async function handleSettle() {
    if (settlingRef.current) return
    settlingRef.current = true
    setSettling(true)
    setSettleError(null)
    try {
      if (storeFilter) {
        // Modo local específico: pagar solo la deuda de ese local.
        const r = await window.hw.settleProviderDebt({
          providerId: provider.id,
          amount: currentBalance,
          storeId: storeFilter,
        })
        if (!r.ok) { setSettleError(r.error ?? 'Error al registrar el pago.'); return }
      } else {
        // Modo "Todos": pagar la deuda de cada local por separado.
        // Un pago por local → no mezcla ni compensa entre locales.
        for (const store of perStoreBalances) {
          const r = await window.hw.settleProviderDebt({
            providerId: provider.id,
            amount: store.balance,
            storeId: store.storeId,
          })
          if (!r.ok) { setSettleError(r.error ?? `Error al registrar pago para ${store.storeName}.`); return }
        }
      }
      setSettleConfirm(false)
      await fetchHistory()
      onSettled?.()
    } catch {
      setSettleError('Error inesperado al registrar el pago.')
    } finally {
      settlingRef.current = false
      setSettling(false)
    }
  }

  const showTabs = storeList.length > 1

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-xl flex flex-col max-h-[85vh]">
        {/* Header del modal */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-800 shrink-0">
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 shrink-0">
            {provider.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold truncate" title={provider.name}>
              {provider.name}
            </h2>
            <p className="text-xs text-gray-500">Historial de movimientos</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800 text-lg"
            title="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* Pestañas de filtro por local (solo si hay más de 1 local en el historial) */}
        {!loading && !error && showTabs && (
          <div className="shrink-0 flex gap-1 px-4 pt-3 pb-0 overflow-x-auto">
            <button
              onClick={() => setStoreFilter(null)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                storeFilter === null
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              Todos
            </button>
            {storeList.map(s => (
              <button
                key={s.storeId}
                onClick={() => setStoreFilter(s.storeId)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors truncate max-w-[140px] ${
                  storeFilter === s.storeId
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
                title={s.storeName}
              >
                {s.storeName}
              </button>
            ))}
          </div>
        )}

        {/* Cuerpo scrollable */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex justify-center items-center py-12">
              <p className="text-gray-500 text-sm">Cargando historial…</p>
            </div>
          )}

          {error && !loading && (
            <div className="mx-4 mt-4 p-4 rounded-xl bg-red-950/40 border border-red-800/60">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          {!loading && !error && events.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <p className="text-gray-400 text-sm">Sin movimientos registrados</p>
              <p className="text-gray-600 text-xs mt-1">
                Los movimientos aparecen cuando se registran gastos con deuda o pagos.
              </p>
            </div>
          )}

          {!loading && !error && events.length > 0 && displayEvents.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <p className="text-gray-400 text-sm">Sin movimientos para este local</p>
            </div>
          )}

          {!loading && !error && displayEvents.length > 0 && (
            <div className="divide-y divide-gray-800/60">
              {displayEvents.map(evt => {
                const isDebt = evt.type === 'debt'
                const balanceColor =
                  evt.runningBalance > 0
                    ? 'text-orange-400'
                    : 'text-green-400'
                const balanceLabel =
                  evt.runningBalance > 0
                    ? formatARS(evt.runningBalance)
                    : evt.runningBalance < 0
                      ? `Saldo a favor ${formatARS(Math.abs(evt.runningBalance))}`
                      : 'Saldado'
                return (
                  <div key={evt.id} className="px-4 py-3 flex items-start gap-3">
                    {/* Indicador de tipo */}
                    <div className={`shrink-0 mt-1 w-2 h-2 rounded-full ${isDebt ? 'bg-orange-400' : 'bg-green-400'}`} />

                    {/* Info del evento */}
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-xs font-semibold shrink-0 ${isDebt ? 'text-orange-400' : 'text-green-400'}`}>
                          {isDebt ? 'Deuda' : 'Pago'}
                        </span>
                        <span className="text-sm font-semibold text-white shrink-0">
                          {formatARS(evt.amount)}
                        </span>
                        {/* Mostrar local solo en la vista "Todos" */}
                        {!storeFilter && (
                          <span
                            className="text-xs text-gray-500 min-w-0 truncate"
                            title={evt.storeName}
                          >
                            · {evt.storeName}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-xs text-gray-500 shrink-0">
                          {toLocalDateTime(evt.createdAt)}
                        </span>
                        <span className="text-xs text-gray-600 shrink-0">·</span>
                        <span
                          className="text-xs text-gray-500 min-w-0 truncate"
                          title={evt.createdByName}
                        >
                          {evt.createdByName}
                        </span>
                      </div>
                    </div>

                    {/* Balance acumulado después de este evento */}
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-gray-600">Saldo</p>
                      <p className={`text-sm font-semibold ${balanceColor}`}>
                        {balanceLabel}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer con saldo actual y acción de saldar */}
        {!loading && !error && displayEvents.length > 0 && (
          <div className="shrink-0 border-t border-gray-800 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-gray-400">
                {storeFilter
                  ? `Saldo — ${storeList.find(s => s.storeId === storeFilter)?.storeName ?? storeFilter}`
                  : 'Saldo actual (total)'}
              </span>
              <span className={`text-sm font-bold ${currentBalance > 0 ? 'text-orange-400' : 'text-green-400'}`}>
                {currentBalance > 0
                  ? formatARS(currentBalance)
                  : currentBalance < 0
                    ? `Saldo a favor ${formatARS(Math.abs(currentBalance))}`
                    : 'Sin deuda'}
              </span>
            </div>
            {currentBalance > 0 && (
              <button
                onClick={() => { setSettleConfirm(true); setSettleError(null) }}
                className="w-full py-2 rounded-xl bg-green-800 hover:bg-green-700 text-green-100 text-sm font-medium transition-colors"
              >
                Saldar deuda ({formatARS(currentBalance)})
              </button>
            )}
          </div>
        )}
      </div>

      {/* Modal de confirmación — doble confirmación para saldar */}
      {settleConfirm && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Confirmar pago</h2>
            {storeFilter ? (
              <p className="text-sm text-gray-300">
                ¿Confirmar pago de{' '}
                <strong className="text-white">{formatARS(currentBalance)}</strong>{' '}
                a <strong className="break-words text-white">{provider.name}</strong>?
                <span className="block mt-1 text-xs text-gray-500">
                  Se registrará como pago del local:{' '}
                  {storeList.find(s => s.storeId === storeFilter)?.storeName ?? storeFilter}
                </span>
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-300">
                  Se registrará un pago separado por cada local con deuda pendiente:
                </p>
                <div className="rounded-xl overflow-hidden border border-gray-700/50 divide-y divide-gray-700/40">
                  {perStoreBalances.map(s => (
                    <div key={s.storeId} className="flex justify-between px-3 py-2 text-sm">
                      <span className="text-gray-400">{s.storeName}</span>
                      <span className="font-semibold text-white">{formatARS(s.balance)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between px-3 py-2 bg-gray-800/40">
                    <span className="text-xs text-gray-500">Total</span>
                    <span className="text-sm font-bold text-white">
                      {formatARS(perStoreBalances.reduce((a, s) => a + s.balance, 0))}
                    </span>
                  </div>
                </div>
              </div>
            )}
            <p className="text-xs text-gray-500">
              Esta acción registrará un pago completo de la deuda{storeFilter ? ' de este local' : ' de cada local'}.
            </p>
            {settleError && <p className="text-red-400 text-sm">{settleError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setSettleConfirm(false)}
                disabled={settling}
                className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40 text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleSettle()}
                disabled={settling}
                className="flex-1 py-2.5 rounded-xl bg-green-700 hover:bg-green-600 font-semibold transition-colors disabled:opacity-40 text-sm"
              >
                {settling ? 'Registrando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

interface ConfirmArchiveModalProps {
  providerName: string
  hasDebt: boolean
  debtAmount: number
  onConfirm: () => Promise<string | null>
  onCancel: () => void
}

function ConfirmArchiveModal({ providerName, hasDebt, debtAmount, onConfirm, onCancel }: ConfirmArchiveModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setSaving(true)
    setError(null)
    const err = await onConfirm()
    setSaving(false)
    if (err) setError(err)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-red-400">Archivar proveedor</h2>

        <p className="text-sm text-gray-300 break-words">
          ¿Archivar a <strong className="break-all">{providerName}</strong>?
          Este proveedor dejará de aparecer en el autocomplete del registro de gastos.
        </p>

        {hasDebt && (
          <div className="rounded-xl bg-red-950/40 border border-red-800/60 px-4 py-3">
            <p className="text-sm text-red-300 font-medium">
              Atención: este proveedor tiene deuda pendiente de {formatARS(debtAmount)}.
            </p>
            <p className="text-xs text-red-400 mt-1">
              El registro de deuda no se borra. Solo se archiva el proveedor.
            </p>
          </div>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40 text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-red-700 hover:bg-red-600 font-semibold transition-colors disabled:opacity-40 text-sm"
          >
            {saving ? 'Archivando…' : 'Archivar'}
          </button>
        </div>
      </div>
    </div>
  )
}
