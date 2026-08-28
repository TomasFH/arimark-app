import { useState, useEffect, useCallback } from 'react'
import { useOnlineStatus } from '../../lib/connectivity'
import { useBackLayer } from '../../lib/backStack'
import {
  ScreenHeader,
  OfflineBanner,
  ErrorBanner,
  Spinner,
  EmptyState,
  Modal,
  ConfirmModal,
  Btn,
  LabeledInput,
  LabeledTextarea,
  LabeledNumericInput,
} from './shared'
import {
  fetchProviders,
  fetchProviderDebtEvents,
  createProvider,
  updateProviderName,
  restoreProvider,
  createProviderDebtEvent,
  archiveProvider,
  calcProviderBalance,
  formatMoney,
  formatDate,
  type Provider,
  type ProviderDebtEvent,
  type StoreDoc,
} from '../../lib/adminFirestore'
import { parseNumericInput, formatIntegerWithDots } from '../../lib/numericInput'
import { planProviderStoreCompensation, ledgerDeltaToTarget, formatAdminAdjustNote, isAdminAdjustNote } from '../../lib/adminLedger'
import type { LocalProfile } from '../../types/pos'

interface Props {
  onBack: () => void
  stores: StoreDoc[]
  profile: LocalProfile
}

export function ProvidersScreen({ onBack, stores, profile }: Props) {
  const online = useOnlineStatus()
  const activeStores = stores.filter(s => !s.archivedAt)
  useBackLayer(true, onBack)

  const [providers, setProviders] = useState<Provider[]>([])
  const [allEvents, setAllEvents] = useState<ProviderDebtEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [listMode, setListMode] = useState<'active' | 'archived'>('active')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Provider | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pList, eList] = await Promise.all([
        fetchProviders(),
        fetchProviderDebtEvents(),
      ])
      setProviders(pList)
      setAllEvents(eList)
    } catch {
      setError('No se pudieron cargar los proveedores.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const balanceFor = (providerId: string) =>
    calcProviderBalance(allEvents.filter(e => e.providerId === providerId))

  const eventsFor = (providerId: string) =>
    allEvents.filter(e => e.providerId === providerId)

  const displayed = providers.filter(p => {
    if (listMode === 'active' ? p.archivedAt : !p.archivedAt) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <ScreenHeader
        title="Proveedores"
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
            aria-label="Nuevo proveedor"
          >
            +
          </button>
        }
      />

      {!online && <OfflineBanner />}

      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
        {(['active', 'archived'] as const).map(mode => (
          <button
            key={mode}
            type="button"
            onClick={() => setListMode(mode)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              listMode === mode ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {mode === 'active' ? 'Activos' : 'Eliminados'}
          </button>
        ))}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar..."
          className="ml-auto min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
        />
      </div>

      <main className="flex-1 px-4 py-4">
        {error && <ErrorBanner message={error} onRetry={load} />}
        {loading && <Spinner />}
        {!loading && !error && displayed.length === 0 && (
          <EmptyState message={listMode === 'archived' ? 'No hay proveedores eliminados.' : 'No hay proveedores.'} />
        )}
        {!loading && !error && displayed.length > 0 && (
          <ul className="space-y-2">
            {displayed.map(p => {
              const bal = balanceFor(p.id)
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(p)}
                    className={`w-full rounded-xl border px-4 py-3 text-left hover:border-zinc-700 transition-colors ${
                      p.archivedAt
                        ? 'border-zinc-600 bg-zinc-800/60 opacity-70'
                        : 'border-zinc-700 bg-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="min-w-0 flex-1 truncate font-medium text-zinc-100"
                        title={p.name}
                      >
                        {p.name}
                      </span>
                      <span
                        className={`shrink-0 font-mono text-sm font-semibold ${
                          bal > 0 ? 'text-amber-400' : bal < 0 ? 'text-emerald-400' : 'text-zinc-400'
                        }`}
                      >
                        {bal < 0 ? `A favor ${formatMoney(-bal)}` : formatMoney(bal)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {eventsFor(p.id).length} movimiento{eventsFor(p.id).length !== 1 ? 's' : ''}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {selected && (
        <ProviderDetailModal
          provider={selected}
          events={eventsFor(selected.id)}
          balance={balanceFor(selected.id)}
          stores={activeStores}
          createdBy={profile.uid}
          createdByName={profile.displayName}
          onClose={() => setSelected(null)}
          onRefresh={load}
          onUpdated={(p) => {
            setProviders(prev => prev.map(x => x.id === p.id ? p : x))
            setSelected(p)
          }}
        />
      )}

      {showCreate && (
        <CreateProviderModal
          existing={providers}
          onClose={() => setShowCreate(false)}
          onCreate={async name => {
            await createProvider(name, profile.uid)
            setShowCreate(false)
            void load()
          }}
          onRestore={async id => {
            await restoreProvider(id)
            setShowCreate(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

interface ProviderDetailModalProps {
  provider: Provider
  events: ProviderDebtEvent[]
  balance: number
  stores: StoreDoc[]
  createdBy: string
  createdByName: string
  onClose: () => void
  onRefresh: () => void
  onUpdated: (p: Provider) => void
}

function ProviderDetailModal({
  provider,
  events,
  balance,
  stores,
  createdBy,
  createdByName,
  onClose,
  onRefresh,
  onUpdated,
}: ProviderDetailModalProps) {
  const [showEvent, setShowEvent] = useState(false)
  const [eventType, setEventType] = useState<'debt' | 'payment'>('payment')
  const [showMovements, setShowMovements] = useState(false)
  const [showAdjust, setShowAdjust] = useState(false)
  const [compensating, setCompensating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(provider.name)
  const [savingEdit, setSavingEdit] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmCompensate, setConfirmCompensate] = useState(false)
  const [removing, setRemoving] = useState(false)

  const handleRestore = async () => {
    await restoreProvider(provider.id)
    onUpdated({ ...provider, archivedAt: null })
    onRefresh()
  }

  const handleDelete = async () => {
    setRemoving(true)
    try {
      await archiveProvider(provider.id)
      onUpdated({ ...provider, archivedAt: new Date().toISOString() })
      onRefresh()
    } finally {
      setRemoving(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!editName.trim()) return
    setSavingEdit(true)
    await updateProviderName(provider.id, editName.trim())
    onUpdated({ ...provider, name: editName.trim() })
    onRefresh()
    setEditing(false)
    setSavingEdit(false)
  }

  const storeMap = new Map(stores.map(s => [s.id, s.name]))
  const byStore = events.reduce<Record<string, number>>((acc, e) => {
    const bal = acc[e.storeId] ?? 0
    acc[e.storeId] = e.type === 'debt' ? bal + Math.abs(e.amount) : bal - Math.abs(e.amount)
    return acc
  }, {})
  const storeBals = Object.values(byStore)
  const hasMixed = storeBals.some(b => b > 0) && storeBals.some(b => b < 0)

  async function handleCompensate() {
    const plan = planProviderStoreCompensation(byStore)
    if (plan.length === 0) return
    setCompensating(true)
    try {
      for (const row of plan) {
        await createProviderDebtEvent({
          providerId: provider.id,
          storeId: row.storeId,
          type: row.type,
          amount: row.amount,
          description: 'Compensación entre locales',
          date: new Date().toISOString(),
          deleted: false,
          providerName: provider.name,
          createdBy,
          createdByName,
        })
      }
      onRefresh()
    } finally {
      setCompensating(false)
    }
  }

  return (
    <Modal title={provider.name} onClose={onClose}>
      <div className="space-y-4 max-h-[80vh] overflow-y-auto">
        {editing ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              maxLength={100}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none"
            />
            <Btn onClick={handleSaveEdit} loading={savingEdit}>OK</Btn>
            <Btn variant="ghost" onClick={() => { setEditing(false); setEditName(provider.name) }}>✕</Btn>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm text-zinc-500 underline"
          >
            Editar nombre
          </button>
        )}

        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-center">
          <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">
            {balance < 0 ? 'Saldo a favor' : 'Deuda total'}
          </p>
          <p
            className={`text-2xl font-mono font-bold ${
              balance > 0 ? 'text-amber-400' : balance < 0 ? 'text-emerald-400' : 'text-zinc-400'
            }`}
          >
            {balance < 0 ? formatMoney(-balance) : formatMoney(balance)}
          </p>
        </div>

        {Object.keys(byStore).length > 0 && (
          <div className="rounded-lg border border-zinc-600 bg-zinc-700 px-3 py-2">
            <p className="mb-2 text-xs text-zinc-500 uppercase tracking-wide">
              Por local
            </p>
            {Object.entries(byStore).map(([sid, bal]) => (
              <div key={sid} className="flex items-center gap-2 min-w-0 text-sm py-0.5">
                <span
                  className="min-w-0 flex-1 truncate text-zinc-400"
                  title={storeMap.get(sid) ?? sid}
                >
                  {storeMap.get(sid) ?? sid}
                </span>
                <span
                  className={`shrink-0 font-mono ${bal > 0 ? 'text-amber-400' : bal < 0 ? 'text-emerald-400' : 'text-zinc-400'}`}
                >
                  {bal > 0 ? formatMoney(bal) : bal < 0 ? `A favor ${formatMoney(-bal)}` : 'Sin deuda'}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Btn
            className="flex-1"
            onClick={() => { setEventType('payment'); setShowEvent(true) }}
          >
            Registrar pago
          </Btn>
          <Btn
            variant="ghost"
            className="flex-1"
            onClick={() => { setEventType('debt'); setShowEvent(true) }}
          >
            Registrar deuda
          </Btn>
        </div>

        <div className="flex gap-2">
          <Btn variant="ghost" className="flex-1" onClick={() => setShowMovements(true)}>
            Ver movimientos
          </Btn>
          <Btn variant="ghost" className="flex-1" onClick={() => setShowAdjust(true)}>
            Ajustar deuda
          </Btn>
        </div>

        {hasMixed && (
          <Btn
            variant="ghost"
            className="w-full"
            loading={compensating}
            onClick={() => setConfirmCompensate(true)}
          >
            Compensar entre locales
          </Btn>
        )}

        <Btn
          variant={provider.archivedAt ? 'ghost' : 'danger'}
          className="w-full"
          onClick={() => setConfirmRemove(true)}
        >
          {provider.archivedAt ? 'Restaurar proveedor' : 'Eliminar proveedor'}
        </Btn>
      </div>

      {showEvent && (
        <RegisterEventModal
          provider={provider}
          stores={stores}
          eventType={eventType}
          byStore={byStore}
          createdBy={createdBy}
          createdByName={createdByName}
          onClose={() => setShowEvent(false)}
          onSaved={onRefresh}
        />
      )}

      {showMovements && (
        <MovementsModal
          events={events}
          storeMap={storeMap}
          onClose={() => setShowMovements(false)}
        />
      )}

      {showAdjust && (
        <AdjustBalanceModal
          provider={provider}
          stores={stores}
          byStore={byStore}
          createdBy={createdBy}
          createdByName={createdByName}
          onClose={() => setShowAdjust(false)}
          onSaved={onRefresh}
        />
      )}

      {confirmCompensate && (
        <ConfirmModal
          title="¿Compensar entre locales?"
          message={`El saldo a favor de un local se usa contra la deuda del otro en ${provider.name}. No se puede deshacer. Si te equivocás, hay que ajustar la deuda a mano.`}
          confirmLabel={compensating ? 'Compensando…' : 'Compensar'}
          onClose={() => setConfirmCompensate(false)}
          onConfirm={handleCompensate}
        />
      )}

      {confirmRemove && (
        <ConfirmModal
          title={provider.archivedAt ? 'Restaurar proveedor' : 'Eliminar proveedor'}
          message={
            provider.archivedAt
              ? `¿Estás seguro que querés restaurar ${provider.name}?`
              : `¿Estás seguro que querés eliminar ${provider.name}?`
          }
          confirmLabel={
            provider.archivedAt
              ? 'Restaurar'
              : removing
                ? 'Eliminando…'
                : 'Eliminar'
          }
          danger={!provider.archivedAt}
          onClose={() => setConfirmRemove(false)}
          onConfirm={provider.archivedAt ? handleRestore : handleDelete}
        />
      )}
    </Modal>
  )
}

interface RegisterEventModalProps {
  provider: Provider
  stores: StoreDoc[]
  eventType: 'debt' | 'payment'
  byStore: Record<string, number>
  createdBy: string
  createdByName: string
  onClose: () => void
  onSaved: () => void
}

function RegisterEventModal({
  provider,
  stores,
  eventType,
  byStore,
  createdBy,
  createdByName,
  onClose,
  onSaved,
}: RegisterEventModalProps) {
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const entries = stores
      .map(s => ({ storeId: s.id, amount: parseNumericInput(amounts[s.id] ?? '') ?? 0 }))
      .filter(x => x.amount > 0)
    if (entries.length === 0) {
      setErr('Ingresá un monto en al menos un local.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      for (const entry of entries) {
        await createProviderDebtEvent({
          providerId: provider.id,
          storeId: entry.storeId,
          type: eventType,
          amount: entry.amount,
          description: description.trim() || null,
          date: new Date().toISOString(),
          deleted: false,
          providerName: provider.name,
          createdBy,
          createdByName,
        })
      }
      onSaved()
      onClose()
    } catch {
      setErr('No se pudo registrar el movimiento.')
      setSaving(false)
    }
  }

  function fillStore(storeId: string, amount: number) {
    setAmounts(prev => ({ ...prev, [storeId]: formatIntegerWithDots(String(Math.round(amount))) }))
    setErr(null)
  }

  function fillAllDebts() {
    const next: Record<string, string> = { ...amounts }
    for (const s of stores) {
      const current = byStore[s.id] ?? 0
      if (current > 0) next[s.id] = formatIntegerWithDots(String(Math.round(current)))
    }
    setAmounts(next)
    setErr(null)
  }

  const anyDebt = stores.some(s => (byStore[s.id] ?? 0) > 0)

  return (
    <Modal
      title={eventType === 'payment' ? 'Registrar pago' : 'Registrar deuda'}
      onClose={onClose}
    >
      <form onSubmit={handleSave} className="space-y-3">
        <p className="text-xs text-zinc-500">
          {eventType === 'payment'
            ? 'Indicá cuánto se paga en cada local. Podés cubrir uno, varios o ambos.'
            : 'Indicá la deuda nueva de cada local.'}
        </p>
        {eventType === 'payment' && anyDebt && (
          <button
            type="button"
            onClick={fillAllDebts}
            className="w-full rounded-lg border border-emerald-800/60 py-2 text-xs font-medium text-emerald-300"
          >
            Pagar todo (todos los locales)
          </button>
        )}
        {stores.map(s => {
          const current = byStore[s.id] ?? 0
          return (
            <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
              <div className="mb-1.5 flex items-center gap-2 min-w-0">
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-200" title={s.name}>
                  {s.name}
                </span>
                <span className={`shrink-0 text-xs font-mono ${
                  current > 0 ? 'text-amber-400' : current < 0 ? 'text-emerald-400' : 'text-zinc-500'
                }`}>
                  {current > 0
                    ? `Debe ${formatMoney(current)}`
                    : current < 0
                      ? `A favor ${formatMoney(-current)}`
                      : 'Sin deuda'}
                </span>
              </div>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <LabeledNumericInput
                    label="Monto ($)"
                    value={amounts[s.id] ?? ''}
                    onChange={v => setAmounts(prev => ({ ...prev, [s.id]: v }))}
                    placeholder="0"
                  />
                </div>
                {eventType === 'payment' && current > 0 && (
                  <button
                    type="button"
                    onClick={() => fillStore(s.id, current)}
                    className="mt-6 shrink-0 rounded-lg border border-zinc-700 px-2 py-2 text-xs text-zinc-300"
                  >
                    Todo
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {stores.length === 0 && (
          <p className="text-sm text-zinc-500">No hay locales activos.</p>
        )}
        <LabeledTextarea
          label="Descripción"
          value={description}
          onChange={setDescription}
          placeholder="Ej: Mercadería semana 32..."
          rows={2}
          maxLength={300}
        />
        {err && (
          <p className="text-sm text-red-400/80">{err}</p>
        )}
        <div className="flex gap-2">
          <Btn variant="ghost" className="flex-1" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn type="submit" className="flex-1" loading={saving}>
            Guardar
          </Btn>
        </div>
      </form>
    </Modal>
  )
}

const MOVEMENTS_PAGE = 20

interface MovementsModalProps {
  events: ProviderDebtEvent[]
  storeMap: Map<string, string>
  onClose: () => void
}

function MovementsModal({ events, storeMap, onClose }: MovementsModalProps) {
  const [page, setPage] = useState(0)
  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date))
  const totalPages = Math.max(1, Math.ceil(sorted.length / MOVEMENTS_PAGE))
  const pageIndex = Math.min(page, totalPages - 1)
  const slice = sorted.slice(pageIndex * MOVEMENTS_PAGE, (pageIndex + 1) * MOVEMENTS_PAGE)

  return (
    <Modal title="Movimientos" onClose={onClose}>
      <div className="flex max-h-[60vh] flex-col">
        {sorted.length === 0 ? (
          <EmptyState message="Sin movimientos." />
        ) : (
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {slice.map(e => {
              const isAdjust = isAdminAdjustNote(e.description)
              return (
              <li key={e.id} className="min-w-0 space-y-0.5 text-sm">
                <div className="flex items-start gap-2 min-w-0">
                <span className="shrink-0 text-zinc-500 text-xs">
                  {formatDate(e.date)}
                </span>
                <span
                  className={`min-w-0 flex-1 ${isAdjust ? 'text-violet-300' : 'truncate text-zinc-400'}`}
                  title={e.description ?? (e.type === 'debt' ? 'Deuda' : 'Pago')}
                >
                  {isAdjust
                    ? e.description
                    : `${e.description || (e.type === 'debt' ? 'Deuda' : 'Pago')} · ${storeMap.get(e.storeId) ?? e.storeId}`}
                </span>
                {!isAdjust && (
                  <span
                    className={`shrink-0 font-mono text-xs ${
                      e.type === 'debt' ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {e.type === 'debt' ? '+' : '-'}{formatMoney(Math.abs(e.amount))}
                  </span>
                )}
                </div>
                {e.createdByName && (
                  <p className="pl-[4.5rem] text-[11px] text-zinc-600 truncate" title={e.createdByName}>
                    {isAdjust ? `Determinado por ${e.createdByName}` : e.createdByName}
                  </p>
                )}
              </li>
              )
            })}
          </ul>
        )}
        {sorted.length > MOVEMENTS_PAGE && (
          <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-zinc-800 pt-3">
            <button
              type="button"
              disabled={pageIndex === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-xs text-zinc-500">
              {pageIndex + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={pageIndex >= totalPages - 1}
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

interface AdjustBalanceModalProps {
  provider: Provider
  stores: StoreDoc[]
  byStore: Record<string, number>
  createdBy: string
  createdByName: string
  onClose: () => void
  onSaved: () => void
}

function AdjustBalanceModal({
  provider,
  stores,
  byStore,
  createdBy,
  createdByName,
  onClose,
  onSaved,
}: AdjustBalanceModalProps) {
  const [storeId, setStoreId] = useState(() => stores.length === 1 ? stores[0]?.id ?? '' : '')
  const [kind, setKind] = useState<'debt' | 'zero' | 'credit'>('debt')
  const [amountRaw, setAmountRaw] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const current = byStore[storeId] ?? 0
  const amount = parseNumericInput(amountRaw) ?? 0
  const target = kind === 'zero' ? 0 : kind === 'debt' ? amount : -amount

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!storeId) { setErr('Elegí un local.'); return }
    if (kind !== 'zero' && amount <= 0) { setErr('Ingresá el monto.'); return }
    const delta = ledgerDeltaToTarget(current, target)
    if (!delta) { setErr('El saldo ya es ese valor.'); return }
    setSaving(true)
    setErr(null)
    try {
      await createProviderDebtEvent({
        providerId: provider.id,
        storeId,
        type: delta.type,
        amount: delta.amount,
        description: formatAdminAdjustNote(target, createdByName),
        date: new Date().toISOString(),
        deleted: false,
        providerName: provider.name,
        createdBy,
        createdByName,
      })
      onSaved()
      onClose()
    } catch {
      setErr('No se pudo ajustar la deuda.')
      setSaving(false)
    }
  }

  return (
    <Modal title="Ajustar deuda" onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-3">
        <p className="text-xs text-zinc-500">
          Salida de emergencia: fijá el saldo que corresponde hoy. Queda en el historial que un admin lo determinó, con su nombre.
        </p>
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-400">Local</span>
          <select
            value={storeId}
            onChange={e => setStoreId(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none"
          >
            {stores.length > 1 && <option value="">Seleccioná un local</option>}
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        {storeId ? (
          <p className="text-xs text-zinc-400">
            Hoy:{' '}
            {current > 0 ? formatMoney(current) : current < 0 ? `A favor ${formatMoney(-current)}` : 'Sin deuda'}
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
              onClick={() => { setKind(opt.id); setErr(null) }}
              className={`flex-1 rounded-lg border py-2 text-xs font-medium ${
                kind === opt.id
                  ? 'border-emerald-600 bg-emerald-950/40 text-zinc-100'
                  : 'border-zinc-700 text-zinc-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {kind !== 'zero' && (
          <LabeledNumericInput
            label="Monto ($)"
            value={amountRaw}
            onChange={setAmountRaw}
            placeholder="0"
          />
        )}
        <p className="text-xs text-violet-300">{formatAdminAdjustNote(target, createdByName)}</p>
        {err && <p className="text-sm text-red-400/80">{err}</p>}
        <div className="flex gap-2">
          <Btn variant="ghost" className="flex-1" onClick={onClose}>Cancelar</Btn>
          <Btn type="submit" className="flex-1" loading={saving}>Confirmar ajuste</Btn>
        </div>
      </form>
    </Modal>
  )
}

interface CreateProviderModalProps {
  existing: Provider[]
  onClose: () => void
  onCreate: (name: string) => Promise<void>
  onRestore: (id: string) => Promise<void>
}

function CreateProviderModal({ existing, onClose, onCreate, onRestore }: CreateProviderModalProps) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const clash = existing.find(p => p.name.toLowerCase().trim() === name.trim().toLowerCase())

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setErr('El nombre es obligatorio.')
      return
    }
    if (clash && !clash.archivedAt) {
      setErr('Ya existe un proveedor con ese nombre. Abrilo de la lista o usá otro nombre.')
      return
    }
    if (clash?.archivedAt) {
      setErr('Ese nombre está en Eliminados. Restauralo o usá otro nombre.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await onCreate(name.trim())
    } catch {
      setErr('No se pudo crear el proveedor.')
      setSaving(false)
    }
  }

  return (
    <Modal title="Nuevo proveedor" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <LabeledInput
          label="Nombre *"
          value={name}
          onChange={setName}
          placeholder="Nombre del proveedor"
          maxLength={100}
          required
        />
        {clash && !clash.archivedAt && (
          <p className="text-sm text-amber-300">
            Ya existe un proveedor con ese nombre. No se puede duplicar: abrilo de la lista o usá otro nombre.
          </p>
        )}
        {clash?.archivedAt && (
          <div className="space-y-2 rounded-xl border border-amber-800/60 bg-amber-950/30 px-3 py-2">
            <p className="text-sm text-amber-200">
              Ese nombre está en Eliminados. Restauralo para recuperar el historial, o usá otro nombre.
            </p>
            <Btn
              type="button"
              className="w-full"
              loading={saving}
              onClick={() => void onRestore(clash.id)}
            >
              Restaurar {clash.name}
            </Btn>
          </div>
        )}
        {err && <p className="text-sm text-red-400/80">{err}</p>}
        <div className="flex gap-2">
          <Btn variant="ghost" className="flex-1" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn type="submit" className="flex-1" loading={saving} disabled={!!clash}>
            Crear
          </Btn>
        </div>
      </form>
    </Modal>
  )
}
