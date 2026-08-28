/**
 * ProvidersScreen — gestión de proveedores (solo admin).
 *
 * Muestra lista de proveedores con deuda combinada cross-local leída desde Firestore.
 * Permite crear, editar, eliminar (oculta; conserva deuda e historial) y ver el historial.
 * Fallback a datos locales cuando Firebase no está disponible (dev / sin conexión).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatARS, toLocalDateTime } from '../lib/datetime'
import { formatIntegerWithDots, parseNumericInput } from '../lib/numericInput'
import NumericInput from '../components/NumericInput'
import { isAdminAdjustNote, formatAdminAdjustNote } from '../lib/providerLedgerNotes'
import type { ProviderWithDebtRow, ProviderRow, ProviderDebtEventRow, StoreRow } from '../types/hw-api'
import { formatPhoneInput, parsePhoneNumber, digitsOnly } from '../lib/phoneInput'
import BackButton from '../components/BackButton'

interface Props {
  onBack: () => void
}

type ModalMode =
  | { type: 'none' }
  | { type: 'create' }
  | { type: 'edit'; provider: ProviderRow }
  | { type: 'remove'; provider: ProviderWithDebtRow }
  | { type: 'compensate'; provider: ProviderWithDebtRow }

function storeBalanceDisplay(balance: number): { label: string; className: string } {
  if (balance > 0) return { label: formatARS(balance), className: 'text-orange-400' }
  if (balance < 0) return { label: `A favor ${formatARS(-balance)}`, className: 'text-emerald-400' }
  return { label: 'Sin deuda', className: 'text-green-400' }
}

const HISTORY_PAGE = 20

/** Campo sobre panel 800 / chip 700: pozo 950 para no fundirse con el gris claro. */
const FIELD =
  'w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-600'

function initialLedgerStoreId(stores: Array<{ storeId: string }>): string {
  if (stores.length === 1) return stores[0].storeId
  return ''
}

function LedgerStoreSelect({
  stores,
  value,
  onChange,
}: {
  stores: Array<{ storeId: string; storeName: string }>
  value: string
  onChange: (id: string) => void
}) {
  if (stores.length <= 1) return null
  return (
    <div className="space-y-1">
      <label className="text-sm text-zinc-400">Local</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={FIELD}
      >
        <option value="">Seleccioná un local</option>
        {stores.map(s => (
          <option key={s.storeId} value={s.storeId}>{s.storeName}</option>
        ))}
      </select>
    </div>
  )
}

export default function ProvidersScreen({ onBack }: Props) {
  const [loading, setLoading] = useState(true)
  const [list, setList] = useState<ProviderWithDebtRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalMode>({ type: 'none' })
  const [showArchived, setShowArchived] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [compensatingId, setCompensatingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const r = await window.hw.getProvidersWithDebt(
      showArchived ? { includeArchived: true } : undefined,
    )
    setLoading(false)
    if (r.ok) {
      setList(showArchived ? r.data.filter(p => p.archivedAt) : r.data)
    } else {
      setError(r.error ?? 'Error al cargar proveedores.')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived])

  function toggleExpand(id: string) {
    setExpandedId(prev => prev === id ? null : id)
  }

  async function handleRestore(provider: ProviderWithDebtRow) {
    setRestoringId(provider.id)
    setError(null)
    const r = await window.hw.unarchiveProvider({ id: provider.id })
    setRestoringId(null)
    if (!r.ok) {
      setError(r.error ?? 'No se pudo restaurar.')
      return
    }
    await load()
  }

  async function handleCompensate(provider: ProviderWithDebtRow) {
    setCompensatingId(provider.id)
    setError(null)
    const r = await window.hw.compensateProviderStores({ providerId: provider.id })
    setCompensatingId(null)
    if (!r.ok) {
      setModal({ type: 'none' })
      setError(r.error ?? 'No se pudo compensar entre locales.')
      return
    }
    setModal({ type: 'none' })
    await load()
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-zinc-800 px-6 py-3 shrink-0">
        <BackButton onClick={onBack} />
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">Proveedores</h1>
          <p className="text-xs text-zinc-500">
            {showArchived ? 'Eliminados — restaurar para volver a usarlos' : 'Deuda combinada entre todos los locales'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowArchived(v => !v)}
          className="shrink-0 px-3 py-2 rounded-lg border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
        >
          {showArchived ? 'Ver activos' : 'Ver eliminados'}
        </button>
        {!showArchived && (
          <button
            onClick={() => setModal({ type: 'create' })}
            className="shrink-0 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium transition-colors"
          >
            + Nuevo
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center items-center py-16">
            <p className="text-zinc-500 text-sm">Cargando proveedores…</p>
          </div>
        )}

        {error && !loading && (
          <div className="mx-4 mt-4 p-4 rounded-xl bg-red-950/40 border border-red-800/60">
            <p className="text-red-300 text-sm">{error}</p>
            <button onClick={() => void load()} className="mt-2 text-xs text-zinc-300 hover:underline">
              Reintentar
            </button>
          </div>
        )}

        {!loading && !error && (
          <div className="p-4 space-y-3">
            {list.length === 0 && (
              <div className="text-center py-12">
                <p className="text-zinc-500 text-sm">
                  {showArchived ? 'No hay proveedores eliminados.' : 'No hay proveedores registrados.'}
                </p>
                {!showArchived && (
                  <p className="text-zinc-600 text-xs mt-1">Los proveedores se crean al registrar gastos o desde el botón "+ Nuevo".</p>
                )}
              </div>
            )}

            {list.map(p => {
              const isExpanded = expandedId === p.id
              const anyStoreHasDebt = p.perStore.some(s => s.balance > 0)
              const anyStoreHasCredit = p.perStore.some(s => s.balance < 0)

              return (
                <div
                  key={p.id}
                  className={`rounded-xl border transition-colors ${
                    p.total > 0 || anyStoreHasDebt
                      ? 'border-orange-800/50 bg-orange-950/20'
                      : 'border-zinc-700 bg-zinc-800'
                  }`}
                >
                  {/* Fila principal */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      className="flex-1 min-w-0 flex items-center gap-3 text-left"
                      onClick={() => toggleExpand(p.id)}
                    >
                      <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300 shrink-0">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate" title={p.name}>{p.name}</p>
                        {p.phone && (
                          <p className="text-xs text-zinc-400 truncate" title={formatPhoneInput(p.phone)}>
                            {formatPhoneInput(p.phone)}
                          </p>
                        )}
                        {p.total > 0 && (
                          <p className="text-xs text-orange-400">
                            Deuda total: {formatARS(p.total)}
                          </p>
                        )}
                        {p.total < 0 && (
                          <p className="text-xs text-emerald-400">
                            Saldo a favor: {formatARS(-p.total)}
                          </p>
                        )}
                        {p.total === 0 && anyStoreHasDebt && (
                          <p className="text-xs text-amber-400">Saldo compensado entre locales</p>
                        )}
                        {p.total === 0 && !anyStoreHasDebt && !anyStoreHasCredit && (
                          <p className="text-xs text-green-500">Sin deuda pendiente</p>
                        )}
                      </div>
                      <span className="text-zinc-600 text-sm shrink-0">
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </button>

                    {/* Acciones */}
                    <button
                      onClick={() => setModal({ type: 'history', provider: p })}
                      className="shrink-0 text-xs text-zinc-300 hover:text-zinc-100 px-2 py-1 rounded-lg hover:bg-zinc-800 transition-colors"
                      title="Ver historial de movimientos"
                    >
                      Historial
                    </button>
                    {showArchived ? (
                      <button
                        onClick={() => void handleRestore(p)}
                        disabled={restoringId === p.id}
                        className="shrink-0 text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-40"
                        title="Restaurar proveedor"
                      >
                        {restoringId === p.id ? 'Restaurando…' : 'Restaurar'}
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => setModal({ type: 'edit', provider: { id: p.id, name: p.name, phone: p.phone, notes: p.notes } })}
                          className="shrink-0 text-xs text-zinc-400 hover:text-white px-2 py-1 rounded-lg hover:bg-zinc-800 transition-colors"
                          title="Editar proveedor"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => setModal({ type: 'remove', provider: p })}
                          className="shrink-0 text-xs text-zinc-500 hover:text-red-400 px-2 py-1 rounded-lg hover:bg-zinc-800 transition-colors"
                          title="Eliminar proveedor"
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </div>

                  {/* Desglose por local */}
                  {isExpanded && (
                    <div className="border-t border-zinc-800/60 px-4 py-3 space-y-2">
                      {p.perStore.length === 0 && (
                        <p className="text-xs text-zinc-500">Sin eventos de deuda registrados.</p>
                      )}
                      {p.perStore.map(s => {
                        const display = storeBalanceDisplay(s.balance)
                        return (
                          <div key={s.storeId} className="flex items-center justify-between gap-2">
                            <p className="text-sm text-zinc-300 min-w-0 truncate" title={s.storeName}>{s.storeName}</p>
                            <p className={`text-sm font-semibold shrink-0 ${display.className}`}>
                              {display.label}
                            </p>
                          </div>
                        )
                      })}
                      {anyStoreHasDebt && anyStoreHasCredit && !showArchived && (
                        <button
                          type="button"
                          onClick={() => setModal({ type: 'compensate', provider: p })}
                          disabled={compensatingId === p.id}
                          className="w-full mt-1 py-2 rounded-lg border border-amber-800/60 text-amber-300 text-xs font-medium hover:bg-amber-950/40 disabled:opacity-40"
                        >
                          {compensatingId === p.id ? 'Compensando…' : 'Compensar entre locales'}
                        </button>
                      )}
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
          onRestored={() => {
            setModal({ type: 'none' })
            void load()
          }}
          onCancel={() => setModal({ type: 'none' })}
        />
      )}

      {modal.type === 'edit' && (
        <ProviderFormModal
          title="Editar proveedor"
          initialName={modal.provider.name}
          initialPhone={modal.provider.phone ?? ''}
          initialNotes={modal.provider.notes ?? ''}
          excludeId={modal.provider.id}
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

      {modal.type === 'remove' && (
        <RemoveProviderModal
          providerName={modal.provider.name}
          onDelete={async () => {
            const r = await window.hw.deleteProvider({ id: modal.provider.id })
            if (!r.ok) return r.error ?? 'Error al eliminar proveedor.'
            setModal({ type: 'none' })
            void load()
            return null
          }}
          onCancel={() => setModal({ type: 'none' })}
        />
      )}

      {modal.type === 'compensate' && (
        <CompensateConfirmModal
          providerName={modal.provider.name}
          saving={compensatingId === modal.provider.id}
          onConfirm={() => void handleCompensate(modal.provider)}
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
  initialPhone?: string
  initialNotes?: string
  excludeId?: string
  onSave: (name: string, phone: string, notes: string) => Promise<string | null>
  onRestored?: () => void
  onCancel: () => void
}

function ProviderFormModal({
  title,
  initialName = '',
  initialPhone = '',
  initialNotes = '',
  excludeId,
  onSave,
  onRestored,
  onCancel,
}: ProviderFormModalProps) {
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(() => formatPhoneInput(initialPhone))
  const [notes, setNotes] = useState(initialNotes)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [known, setKnown] = useState<ProviderRow[]>([])

  useEffect(() => {
    void window.hw.listProviders({ includeArchived: true }).then(r => {
      if (r.ok) setKnown(r.data)
    })
  }, [])

  const clash = known.find(p =>
    p.name.toLowerCase().trim() === name.trim().toLowerCase() && p.id !== excludeId,
  )

  async function handleSave() {
    if (!name.trim()) { setError('El nombre es obligatorio.'); return }
    if (clash && !clash.archivedAt) {
      setError('Ya existe un proveedor con ese nombre. Abrilo de la lista o usá otro nombre.')
      return
    }
    if (clash?.archivedAt) {
      setError('Ese nombre está en Eliminados. Restauralo o usá otro nombre.')
      return
    }
    setSaving(true)
    setError(null)
    const phoneToSave = parsePhoneNumber(phone) ?? digitsOnly(phone)
    const err = await onSave(name.trim(), phoneToSave, notes.trim())
    setSaving(false)
    if (err) setError(err)
  }

  async function handleRestore() {
    if (!clash?.id) return
    setSaving(true)
    setError(null)
    const r = await window.hw.unarchiveProvider({ id: clash.id })
    setSaving(false)
    if (!r.ok) { setError(r.error ?? 'No se pudo restaurar.'); return }
    onRestored?.()
    if (!onRestored) onCancel()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-zinc-800 rounded-2xl border border-zinc-700 w-full max-w-sm shadow-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">{title}</h2>

        <div className="space-y-1">
          <label className="text-sm text-zinc-400">Nombre *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nombre del proveedor"
            maxLength={100}
            autoFocus
            className={FIELD}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-zinc-400">Teléfono (opcional)</label>
          <input
            type="text"
            value={phone}
            onChange={e => setPhone(formatPhoneInput(e.target.value))}
            placeholder="11-1234-5678"
            inputMode="tel"
            maxLength={50}
            className={FIELD}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-zinc-400">Notas (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Días de visita, productos…"
            maxLength={300}
            className={FIELD}
          />
        </div>

        {clash && !clash.archivedAt && (
          <p className="text-sm text-amber-300">
            Ya existe un proveedor con ese nombre. No se puede duplicar: abrilo de la lista o usá otro nombre.
          </p>
        )}
        {clash?.archivedAt && (
          <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 px-3 py-2 space-y-2">
            <p className="text-sm text-amber-200">
              Ese nombre está en Eliminados. Restauralo para recuperar el historial, o usá otro nombre.
            </p>
            <button
              type="button"
              onClick={() => void handleRestore()}
              disabled={saving}
              className="w-full py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-sm font-medium disabled:opacity-40"
            >
              {saving ? 'Restaurando…' : `Restaurar ${clash.name}`}
            </button>
          </div>
        )}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !!clash}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold transition-colors disabled:opacity-40 text-sm"
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
  const [storeFilter, setStoreFilter] = useState<string | null>(null)
  const [stores, setStores] = useState<StoreRow[]>([])
  const [overlay, setOverlay] = useState<'none' | 'settle' | 'debt' | 'adjust'>('none')
  const [page, setPage] = useState(0)
  const historyListRef = useRef<HTMLDivElement>(null)

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
    void window.hw.getStores().then(r => {
      if (r.ok) setStores(r.data.filter(s => !s.archivedAt))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id])

  const storeList = useMemo(() => {
    const seen = new Set<string>()
    const result: Array<{ storeId: string; storeName: string }> = []
    for (const evt of events) {
      if (!seen.has(evt.storeId)) {
        seen.add(evt.storeId)
        result.push({ storeId: evt.storeId, storeName: evt.storeName })
      }
    }
    for (const s of stores) {
      if (!seen.has(s.id)) {
        seen.add(s.id)
        result.push({ storeId: s.id, storeName: s.name })
      }
    }
    return result
  }, [events, stores])

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

  const currentBalance = displayEvents[0]?.runningBalance ?? (
    storeFilter
      ? events.filter(e => e.storeId === storeFilter).reduce(
          (b, e) => b + (e.type === 'debt' ? e.amount : -e.amount),
          0,
        )
      : provider.total
  )

  const allStoreBalances = useMemo(() => {
    const map: Record<string, { storeName: string; balance: number }> = {}
    for (const evt of events) {
      if (!map[evt.storeId]) map[evt.storeId] = { storeName: evt.storeName, balance: 0 }
      map[evt.storeId].balance += evt.type === 'debt' ? evt.amount : -evt.amount
    }
    for (const s of storeList) {
      if (!map[s.storeId]) map[s.storeId] = { storeName: s.storeName, balance: 0 }
    }
    return Object.entries(map).map(([storeId, v]) => ({ storeId, ...v }))
  }, [events, storeList])

  const anyDebt = allStoreBalances.some(s => s.balance > 0)
  const canSettle = storeFilter
    ? (allStoreBalances.find(s => s.storeId === storeFilter)?.balance ?? 0) > 0
    : anyDebt

  const historyPages = Math.max(1, Math.ceil(displayEvents.length / HISTORY_PAGE))
  const historyPage = Math.min(page, historyPages - 1)
  const pagedEvents = displayEvents.slice(historyPage * HISTORY_PAGE, (historyPage + 1) * HISTORY_PAGE)

  useEffect(() => {
    historyListRef.current?.scrollTo({ top: 0 })
  }, [historyPage, storeFilter])

  async function refreshAfterChange() {
    setOverlay('none')
    await fetchHistory()
    onSettled?.()
  }

  const showTabs = storeList.length > 1

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-xl flex flex-col max-h-[85vh] border border-zinc-700">
        {/* Header del modal */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-zinc-800 shrink-0">
          <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300 shrink-0">
            {provider.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold truncate" title={provider.name}>
              {provider.name}
            </h2>
            <p className="text-xs text-zinc-500">Historial de movimientos</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-zinc-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-zinc-800 text-lg"
            title="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* Pestañas de filtro por local (solo si hay más de 1 local en el historial) */}
        {!loading && !error && showTabs && (
          <div className="shrink-0 flex gap-1 px-4 pt-3 pb-0 overflow-x-auto">
            <button
              onClick={() => { setStoreFilter(null); setPage(0) }}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                storeFilter === null
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
              }`}
            >
              Todos
            </button>
            {storeList.map(s => (
              <button
                key={s.storeId}
                onClick={() => { setStoreFilter(s.storeId); setPage(0) }}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors truncate max-w-[140px] ${
                  storeFilter === s.storeId
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                }`}
                title={s.storeName}
              >
                {s.storeName}
              </button>
            ))}
          </div>
        )}

        {/* Cuerpo scrollable */}
        <div ref={historyListRef} className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex justify-center items-center py-12">
              <p className="text-zinc-500 text-sm">Cargando historial…</p>
            </div>
          )}

          {error && !loading && (
            <div className="mx-4 mt-4 p-4 rounded-xl bg-red-950/40 border border-red-800/60">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          {!loading && !error && events.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <p className="text-zinc-400 text-sm">Sin movimientos registrados</p>
              <p className="text-zinc-600 text-xs mt-1">
                Usá Saldar deuda o Ajustar deuda para registrar un movimiento.
              </p>
            </div>
          )}

          {!loading && !error && events.length > 0 && displayEvents.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <p className="text-zinc-400 text-sm">Sin movimientos para este local</p>
            </div>
          )}

          {!loading && !error && displayEvents.length > 0 && (
            <div className="divide-y divide-zinc-800/60">
              {pagedEvents.map(evt => {
                const isAdjust = isAdminAdjustNote(evt.notes)
                const isDebt = evt.type === 'debt'
                const balanceColor =
                  evt.runningBalance > 0
                    ? 'text-orange-400'
                    : evt.runningBalance < 0
                      ? 'text-emerald-400'
                      : 'text-green-400'
                const balanceLabel =
                  evt.runningBalance > 0
                    ? formatARS(evt.runningBalance)
                    : evt.runningBalance < 0
                      ? `Saldo a favor ${formatARS(Math.abs(evt.runningBalance))}`
                      : 'Saldado'
                const typeLabel = isAdjust ? 'Ajuste' : isDebt ? 'Deuda' : 'Pago'
                const typeColor = isAdjust
                  ? 'text-violet-300'
                  : isDebt ? 'text-orange-400' : 'text-green-400'
                const dotColor = isAdjust
                  ? 'bg-violet-400'
                  : isDebt ? 'bg-orange-400' : 'bg-green-400'
                return (
                  <div key={evt.id} className="px-4 py-3 flex items-start gap-3">
                    <div className={`shrink-0 mt-1 w-2 h-2 rounded-full ${dotColor}`} />

                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-xs font-semibold shrink-0 ${typeColor}`}>
                          {typeLabel}
                        </span>
                        {!isAdjust && (
                          <span className="text-sm font-semibold text-white shrink-0">
                            {formatARS(evt.amount)}
                          </span>
                        )}
                        {!storeFilter && (
                          <span
                            className="text-xs text-zinc-500 min-w-0 truncate"
                            title={evt.storeName}
                          >
                            · {evt.storeName}
                          </span>
                        )}
                      </div>
                      {isAdjust && evt.notes && (
                        <p className="text-xs text-violet-200/90 min-w-0" title={evt.notes}>
                          {evt.notes}
                        </p>
                      )}
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-xs text-zinc-500 shrink-0">
                          {toLocalDateTime(evt.createdAt)}
                        </span>
                        <span className="text-xs text-zinc-600 shrink-0">·</span>
                        <span
                          className="text-xs text-zinc-500 min-w-0 truncate"
                          title={evt.createdByName}
                        >
                          {isAdjust ? `Determinado por ${evt.createdByName}` : evt.createdByName}
                        </span>
                      </div>
                    </div>

                    {/* Balance acumulado después de este evento */}
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-zinc-600">Saldo</p>
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
        {displayEvents.length > HISTORY_PAGE && (
          <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-t border-zinc-800/60">
            <button
              type="button"
              disabled={historyPage === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-xs text-zinc-500">
              {historyPage + 1} / {historyPages}
            </span>
            <button
              type="button"
              disabled={historyPage >= historyPages - 1}
              onClick={() => setPage(p => Math.min(historyPages - 1, p + 1))}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        )}

        {/* Footer: saldo + acciones */}
        {!loading && !error && (
          <div className="shrink-0 border-t border-zinc-800 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-zinc-400">
                {storeFilter
                  ? `Saldo — ${storeList.find(s => s.storeId === storeFilter)?.storeName ?? storeFilter}`
                  : 'Saldo actual (total)'}
              </span>
              <span className={`text-sm font-bold ${currentBalance > 0 ? 'text-orange-400' : currentBalance < 0 ? 'text-emerald-400' : 'text-green-400'}`}>
                {currentBalance > 0
                  ? formatARS(currentBalance)
                  : currentBalance < 0
                    ? `Saldo a favor ${formatARS(Math.abs(currentBalance))}`
                    : 'Sin deuda'}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!canSettle}
                onClick={() => setOverlay('settle')}
                className="flex-1 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-sm font-medium disabled:opacity-40 disabled:hover:bg-emerald-700"
              >
                Saldar deuda
              </button>
              <button
                type="button"
                onClick={() => setOverlay('debt')}
                className="shrink-0 px-3 py-2 rounded-xl border border-orange-600 text-orange-400 text-sm hover:bg-orange-950/40"
              >
                Registrar deuda
              </button>
            </div>
            <button
              type="button"
              onClick={() => setOverlay('adjust')}
              className="w-full py-2 rounded-xl border border-zinc-700 text-zinc-300 text-sm hover:bg-zinc-800"
            >
              Ajustar deuda
            </button>
          </div>
        )}
      </div>

      {overlay === 'settle' && (
        <AdminSettleDebtOverlay
          providerId={provider.id}
          providerName={provider.name}
          storeFilter={storeFilter}
          stores={allStoreBalances}
          onClose={() => setOverlay('none')}
          onSaved={() => void refreshAfterChange()}
        />
      )}
      {overlay === 'debt' && (
        <AdminRecordDebtOverlay
          providerId={provider.id}
          storeFilter={storeFilter}
          stores={allStoreBalances}
          onClose={() => setOverlay('none')}
          onSaved={() => void refreshAfterChange()}
        />
      )}
      {overlay === 'adjust' && (
        <AdminAdjustDebtOverlay
          providerId={provider.id}
          storeFilter={storeFilter}
          stores={allStoreBalances}
          onClose={() => setOverlay('none')}
          onSaved={() => void refreshAfterChange()}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

interface StoreBalanceRow {
  storeId: string
  storeName: string
  balance: number
}

function AdminSettleDebtOverlay({
  providerId,
  providerName,
  storeFilter,
  stores,
  onClose,
  onSaved,
}: {
  providerId: string
  providerName: string
  storeFilter: string | null
  stores: StoreBalanceRow[]
  onClose: () => void
  onSaved: () => void
}) {
  const debtStores = stores.filter(s => s.balance > 0)
  const visible = storeFilter
    ? debtStores.filter(s => s.storeId === storeFilter)
    : debtStores
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const s of visible) {
      init[s.storeId] = formatIntegerWithDots(String(Math.round(s.balance)))
    }
    return init
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function fillAll() {
    const next: Record<string, string> = {}
    for (const s of visible) next[s.storeId] = formatIntegerWithDots(String(Math.round(s.balance)))
    setAmounts(next)
  }

  async function handleSubmit() {
    const entries = visible
      .map(s => ({ storeId: s.storeId, storeName: s.storeName, amount: parseNumericInput(amounts[s.storeId] ?? '') ?? 0 }))
      .filter(e => e.amount > 0)
    if (entries.length === 0) {
      setError('Ingresá un monto en al menos un local.')
      return
    }
    setSaving(true)
    setError(null)
    for (const e of entries) {
      const r = await window.hw.settleProviderDebt({
        providerId,
        amount: e.amount,
        storeId: e.storeId,
      })
      if (!r.ok) {
        setSaving(false)
        setError(r.error ?? `Error al registrar el pago de ${e.storeName}.`)
        return
      }
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-zinc-800 rounded-2xl w-full max-w-lg shadow-xl border border-zinc-700 p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold">Saldar deuda</h2>
            <p className="text-xs text-zinc-500 truncate" title={providerName}>{providerName}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-zinc-400 hover:text-white p-1" title="Cerrar">✕</button>
        </div>
        {visible.length === 0 ? (
          <p className="text-sm text-zinc-500">No hay deuda pendiente en {storeFilter ? 'este local' : 'ningún local'}.</p>
        ) : (
          <>
            {visible.length > 1 && (
              <button
                type="button"
                onClick={fillAll}
                className="w-full py-2 rounded-lg border border-emerald-800/60 text-emerald-300 text-xs"
              >
                Pagar todo
              </button>
            )}
            {visible.map(s => (
              <div key={s.storeId} className="rounded-xl border border-zinc-600 bg-zinc-700 px-3 py-2 space-y-2">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="min-w-0 flex-1 truncate text-sm" title={s.storeName}>{s.storeName}</p>
                  <p className="shrink-0 text-xs text-orange-400">{formatARS(s.balance)}</p>
                </div>
                <div className="flex gap-2">
                  <NumericInput
                    value={amounts[s.storeId] ?? ''}
                    onChange={v => { setAmounts(prev => ({ ...prev, [s.storeId]: v })); setError(null) }}
                    placeholder="0"
                    className={`min-w-0 flex-1 ${FIELD}`}
                  />
                  <button
                    type="button"
                    onClick={() => setAmounts(prev => ({ ...prev, [s.storeId]: formatIntegerWithDots(String(Math.round(s.balance))) }))}
                    className="shrink-0 px-2 py-2 rounded-lg border border-zinc-700 text-xs text-zinc-300"
                  >
                    Todo
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-sm disabled:opacity-40">Cancelar</button>
          <button type="button" onClick={() => void handleSubmit()} disabled={saving || visible.length === 0} className="flex-1 py-2.5 rounded-xl bg-emerald-600 font-semibold text-sm disabled:opacity-40">
            {saving ? 'Registrando…' : 'Registrar pago'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AdminRecordDebtOverlay({
  providerId,
  stores,
  onClose,
  onSaved,
}: {
  providerId: string
  storeFilter: string | null
  stores: StoreBalanceRow[]
  onClose: () => void
  onSaved: () => void
}) {
  const [storeId, setStoreId] = useState(() => initialLedgerStoreId(stores))
  const [amountRaw, setAmountRaw] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    const amount = parseNumericInput(amountRaw) ?? 0
    if (amount <= 0) { setError('Ingresá el monto de la deuda.'); return }
    if (!storeId) { setError('Elegí un local.'); return }
    setSaving(true)
    setError(null)
    const r = await window.hw.recordProviderLedger({
      providerId,
      storeId,
      type: 'debt',
      amount,
    })
    setSaving(false)
    if (!r.ok) { setError(r.error ?? 'Error al registrar la deuda.'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-zinc-800 rounded-2xl w-full max-w-lg shadow-xl border border-zinc-700 p-5 space-y-4">
        <div className="flex items-start gap-2">
          <h2 className="flex-1 text-base font-semibold">Registrar deuda</h2>
          <button type="button" onClick={onClose} className="shrink-0 text-zinc-400 hover:text-white p-1" title="Cerrar">✕</button>
        </div>
        <p className="text-xs text-zinc-500">Sin movimiento de caja. Solo suma deuda en el local elegido.</p>
        <LedgerStoreSelect stores={stores} value={storeId} onChange={id => { setStoreId(id); setError(null) }} />
        <NumericInput
          value={amountRaw}
          onChange={v => { setAmountRaw(v); setError(null) }}
          placeholder="0"
          className={FIELD}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-sm disabled:opacity-40">Cancelar</button>
          <button type="button" onClick={() => void handleSubmit()} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 font-semibold text-sm disabled:opacity-40">
            {saving ? 'Registrando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AdminAdjustDebtOverlay({
  providerId,
  stores,
  onClose,
  onSaved,
}: {
  providerId: string
  storeFilter: string | null
  stores: StoreBalanceRow[]
  onClose: () => void
  onSaved: () => void
}) {
  const [storeId, setStoreId] = useState(() => initialLedgerStoreId(stores))
  const [kind, setKind] = useState<'debt' | 'zero' | 'credit'>('debt')
  const [amountRaw, setAmountRaw] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = stores.find(s => s.storeId === storeId)?.balance ?? 0
  const amount = parseNumericInput(amountRaw) ?? 0
  const target = kind === 'zero' ? 0 : kind === 'debt' ? amount : -amount

  async function handleSubmit() {
    if (!storeId) { setError('Elegí un local.'); return }
    if (kind !== 'zero' && amount <= 0) { setError('Ingresá el monto.'); return }
    const delta = Math.round(target) - Math.round(current)
    if (delta === 0) { setError('El saldo ya es ese valor.'); return }
    setSaving(true)
    setError(null)
    const r = await window.hw.recordProviderLedger({
      providerId,
      storeId,
      type: delta > 0 ? 'debt' : 'payment',
      amount: Math.abs(delta),
      notes: formatAdminAdjustNote(target),
    })
    setSaving(false)
    if (!r.ok) { setError(r.error ?? 'Error al ajustar la deuda.'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-zinc-800 rounded-2xl w-full max-w-lg shadow-xl border border-zinc-700 p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-start gap-2">
          <h2 className="flex-1 text-base font-semibold">Ajustar deuda</h2>
          <button type="button" onClick={onClose} className="shrink-0 text-zinc-400 hover:text-white p-1" title="Cerrar">✕</button>
        </div>
        <p className="text-xs text-zinc-500">
          Salida de emergencia: fijá el saldo que corresponde hoy, sin justificar los movimientos anteriores.
          Queda en el historial que un admin lo determinó, con su nombre.
        </p>
        <LedgerStoreSelect stores={stores} value={storeId} onChange={id => { setStoreId(id); setError(null) }} />
        {storeId ? (
          <p className="text-xs text-zinc-400">
            Hoy la app muestra:{' '}
            <span className={current > 0 ? 'text-orange-400' : current < 0 ? 'text-emerald-400' : 'text-zinc-300'}>
              {current > 0 ? formatARS(current) : current < 0 ? `A favor ${formatARS(-current)}` : 'Sin deuda'}
            </span>
          </p>
        ) : (
          <p className="text-xs text-amber-300">Elegí el local antes de fijar el saldo.</p>
        )}
        <div className="flex gap-1">
          {([
            { id: 'debt' as const, label: 'Deuda' },
            { id: 'zero' as const, label: 'Cero' },
            { id: 'credit' as const, label: 'A favor' },
          ]).map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => { setKind(opt.id); setError(null) }}
              className={`flex-1 py-2 rounded-lg text-xs font-medium border ${
                kind === opt.id
                  ? 'border-emerald-600 bg-emerald-950/40 text-white'
                  : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {kind !== 'zero' && (
          <NumericInput
            value={amountRaw}
            onChange={v => { setAmountRaw(v); setError(null) }}
            placeholder="0"
            className={FIELD}
          />
        )}
        <p className="text-xs text-violet-200/90">
          {formatAdminAdjustNote(target)}
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-sm disabled:opacity-40">Cancelar</button>
          <button type="button" onClick={() => void handleSubmit()} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-sm disabled:opacity-40">
            {saving ? 'Guardando…' : 'Confirmar ajuste'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

interface CompensateConfirmModalProps {
  providerName: string
  saving: boolean
  onConfirm: () => void
  onCancel: () => void
}

function CompensateConfirmModal({
  providerName,
  saving,
  onConfirm,
  onCancel,
}: CompensateConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-zinc-800 rounded-2xl border border-zinc-700 w-full max-w-sm shadow-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-white">
          ¿Compensar entre locales?
        </h2>
        <p className="text-sm text-zinc-400">
          El saldo a favor de un local se usa contra la deuda del otro en{' '}
          <span className="text-zinc-200" title={providerName}>{providerName}</span>.
          No se puede deshacer. Si te equivocás, hay que ajustar la deuda a mano.
        </p>
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-sm transition-colors disabled:opacity-40"
          >
            {saving ? 'Compensando…' : 'Compensar'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface RemoveProviderModalProps {
  providerName: string
  onDelete: () => Promise<string | null>
  onCancel: () => void
}

function RemoveProviderModal({
  providerName,
  onDelete,
  onCancel,
}: RemoveProviderModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handle() {
    setSaving(true)
    setError(null)
    const err = await onDelete()
    setSaving(false)
    if (err) setError(err)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-zinc-800 rounded-2xl border border-zinc-700 w-full max-w-sm shadow-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-white min-w-0">
          ¿Estás seguro que querés eliminar{' '}
          <span className="truncate inline-block max-w-full align-bottom" title={providerName}>
            {providerName}
          </span>
          ?
        </h2>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handle()}
            disabled={saving}
            className="flex-1 py-2 rounded-xl bg-red-900/60 hover:bg-red-900/80 border border-red-900/50 text-red-400/90 font-semibold transition-colors disabled:opacity-40"
          >
            {saving ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}
