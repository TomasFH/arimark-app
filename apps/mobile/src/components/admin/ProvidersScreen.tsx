import { useState, useEffect, useCallback } from 'react'
import { useOnlineStatus } from '../../lib/connectivity'
import {
  ScreenHeader,
  OfflineBanner,
  ErrorBanner,
  Spinner,
  EmptyState,
  Modal,
  Btn,
  LabeledInput,
  LabeledTextarea,
  filterDigits,
  parseDigits,
} from './shared'
import {
  fetchProviders,
  fetchProviderDebtEvents,
  createProvider,
  updateProviderName,
  archiveProvider,
  restoreProvider,
  createProviderDebtEvent,
  calcProviderBalance,
  formatMoney,
  formatDate,
  type Provider,
  type ProviderDebtEvent,
  type StoreDoc,
} from '../../lib/adminFirestore'

interface Props {
  onBack: () => void
  stores: StoreDoc[]
}

export function ProvidersScreen({ onBack, stores }: Props) {
  const online = useOnlineStatus()
  const activeStores = stores.filter(s => !s.archivedAt)

  const [providers, setProviders] = useState<Provider[]>([])
  const [allEvents, setAllEvents] = useState<ProviderDebtEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
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
    if (!showArchived && p.archivedAt) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
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
        <button
          type="button"
          onClick={() => setShowArchived(p => !p)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            showArchived ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {showArchived ? 'Con archivados' : 'Activos'}
        </button>
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
          <EmptyState message="No hay proveedores." />
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
                        ? 'border-zinc-800/50 bg-zinc-900/50 opacity-60'
                        : 'border-zinc-800 bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="min-w-0 flex-1 truncate font-medium text-zinc-100"
                        title={p.name}
                      >
                        {p.name}
                      </span>
                      {p.archivedAt && (
                        <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
                          Archivado
                        </span>
                      )}
                      <span
                        className={`shrink-0 font-mono text-sm font-semibold ${
                          bal > 0 ? 'text-amber-400' : 'text-zinc-400'
                        }`}
                      >
                        {formatMoney(bal)}
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
          onClose={() => setShowCreate(false)}
          onCreate={async name => {
            await createProvider(name)
            setShowCreate(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Provider detail modal
// ---------------------------------------------------------------------------

interface ProviderDetailModalProps {
  provider: Provider
  events: ProviderDebtEvent[]
  balance: number
  stores: StoreDoc[]
  onClose: () => void
  onRefresh: () => void
  onUpdated: (p: Provider) => void
}

function ProviderDetailModal({
  provider,
  events,
  balance,
  stores,
  onClose,
  onRefresh,
  onUpdated,
}: ProviderDetailModalProps) {
  const [showEvent, setShowEvent] = useState(false)
  const [eventType, setEventType] = useState<'debt' | 'payment'>('payment')
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(provider.name)
  const [savingEdit, setSavingEdit] = useState(false)

  const handleArchive = async () => {
    if (!confirm(`¿${provider.archivedAt ? 'Restaurar' : 'Archivar'} ${provider.name}?`)) return
    if (provider.archivedAt) {
      await restoreProvider(provider.id)
      onUpdated({ ...provider, archivedAt: null })
    } else {
      await archiveProvider(provider.id)
      onUpdated({ ...provider, archivedAt: new Date().toISOString() })
    }
    onRefresh()
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

  // Per-store balance breakdown
  const storeMap = new Map(stores.map(s => [s.id, s.name]))
  const byStore = events.reduce<Record<string, number>>((acc, e) => {
    const bal = acc[e.storeId] ?? 0
    acc[e.storeId] = e.type === 'debt' ? bal + e.amount : bal - e.amount
    return acc
  }, {})

  return (
    <Modal title={provider.name} onClose={onClose}>
      <div className="space-y-4 max-h-[80vh] overflow-y-auto">
        {/* Edit name */}
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

        {/* Balance total */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-center">
          <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">
            Deuda total
          </p>
          <p
            className={`text-2xl font-mono font-bold ${
              balance > 0 ? 'text-amber-400' : 'text-zinc-400'
            }`}
          >
            {formatMoney(balance)}
          </p>
        </div>

        {/* Per-store breakdown */}
        {Object.keys(byStore).length > 1 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
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
                  className={`shrink-0 font-mono ${bal > 0 ? 'text-amber-400' : 'text-zinc-400'}`}
                >
                  {formatMoney(bal)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
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

        {/* Recent events */}
        <div>
          <p className="mb-2 text-xs text-zinc-500 uppercase tracking-wide">
            Movimientos
          </p>
          {events.length === 0 ? (
            <EmptyState message="Sin movimientos." />
          ) : (
            <ul className="space-y-1.5">
              {[...events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20).map(e => (
                <li key={e.id} className="flex items-center gap-2 min-w-0 text-sm">
                  <span className="shrink-0 text-zinc-500 text-xs">
                    {formatDate(e.date)}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-zinc-400"
                    title={e.description ?? (e.type === 'debt' ? 'Deuda' : 'Pago')}
                  >
                    {e.description || (e.type === 'debt' ? 'Deuda' : 'Pago')}
                    {' · '}{storeMap.get(e.storeId) ?? e.storeId}
                  </span>
                  <span
                    className={`shrink-0 font-mono text-xs ${
                      e.type === 'debt' ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {e.type === 'debt' ? '+' : '-'}{formatMoney(e.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Btn
          variant={provider.archivedAt ? 'ghost' : 'danger'}
          className="w-full"
          onClick={handleArchive}
        >
          {provider.archivedAt ? 'Restaurar proveedor' : 'Archivar proveedor'}
        </Btn>
      </div>

      {showEvent && (
        <RegisterEventModal
          provider={provider}
          stores={stores}
          eventType={eventType}
          onClose={() => setShowEvent(false)}
          onSaved={onRefresh}
        />
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Register debt/payment event modal
// ---------------------------------------------------------------------------

interface RegisterEventModalProps {
  provider: Provider
  stores: StoreDoc[]
  eventType: 'debt' | 'payment'
  onClose: () => void
  onSaved: () => void
}

function RegisterEventModal({
  provider,
  stores,
  eventType,
  onClose,
  onSaved,
}: RegisterEventModalProps) {
  const activeStores = stores.filter(s => !s.archivedAt)
  const [storeId, setStoreId] = useState(activeStores[0]?.id ?? '')
  const [amountInput, setAmountInput] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseDigits(amountInput)
    if (amount <= 0) {
      setErr('Ingresá un monto válido.')
      return
    }
    if (!storeId) {
      setErr('Seleccioná un local.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await createProviderDebtEvent({
        providerId: provider.id,
        storeId,
        type: eventType,
        amount,
        description: description.trim() || null,
        date: new Date().toISOString(),
        deleted: false,
      })
      onSaved()
      onClose()
    } catch {
      setErr('No se pudo registrar el movimiento.')
      setSaving(false)
    }
  }

  return (
    <Modal
      title={eventType === 'payment' ? 'Registrar pago' : 'Registrar deuda'}
      onClose={onClose}
    >
      <form onSubmit={handleSave} className="space-y-3">
        {activeStores.length > 1 && (
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-400">Local</span>
            <select
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none"
            >
              {activeStores.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <LabeledInput
          label="Monto ($)"
          value={amountInput}
          onChange={v => setAmountInput(filterDigits(v))}
          placeholder="0"
          inputMode="numeric"
        />
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

// ---------------------------------------------------------------------------
// Create provider
// ---------------------------------------------------------------------------

interface CreateProviderModalProps {
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}

function CreateProviderModal({ onClose, onCreate }: CreateProviderModalProps) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setErr('El nombre es obligatorio.')
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
        {err && <p className="text-sm text-red-400/80">{err}</p>}
        <div className="flex gap-2">
          <Btn variant="ghost" className="flex-1" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn type="submit" className="flex-1" loading={saving}>
            Crear
          </Btn>
        </div>
      </form>
    </Modal>
  )
}
