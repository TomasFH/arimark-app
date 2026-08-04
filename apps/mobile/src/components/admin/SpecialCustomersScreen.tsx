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
  fetchSpecialCustomers,
  fetchSpecialCustomerPrices,
  createSpecialCustomer,
  updateSpecialCustomer,
  createSpecialCustomerPrice,
  softDeleteSpecialCustomerPrice,
  formatMoney,
  type SpecialCustomer,
  type SpecialCustomerPrice,
} from '../../lib/adminFirestore'

interface Props {
  onBack: () => void
}

export function SpecialCustomersScreen({ onBack }: Props) {
  const online = useOnlineStatus()

  const [customers, setCustomers] = useState<SpecialCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<SpecialCustomer | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchSpecialCustomers()
      setCustomers(list)
    } catch {
      setError('No se pudieron cargar los clientes especiales.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const displayed = customers.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <ScreenHeader
        title="Clientes especiales"
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
            aria-label="Nuevo cliente especial"
          >
            +
          </button>
        }
      />

      {!online && <OfflineBanner />}

      <div className="border-b border-zinc-800 px-4 py-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar cliente..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
        />
      </div>

      <main className="flex-1 px-4 py-4">
        {error && <ErrorBanner message={error} onRetry={load} />}
        {loading && <Spinner />}
        {!loading && !error && displayed.length === 0 && (
          <EmptyState message="No hay clientes especiales." />
        )}
        {!loading && !error && displayed.length > 0 && (
          <ul className="space-y-2">
            {displayed.map(c => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelected(c)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-left hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="min-w-0 flex-1 truncate font-medium text-zinc-100"
                      title={c.name}
                    >
                      {c.name}
                    </span>
                    {!c.active && (
                      <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
                        Inactivo
                      </span>
                    )}
                  </div>
                  {c.notes && (
                    <p
                      className="mt-0.5 truncate text-xs text-zinc-500"
                      title={c.notes}
                    >
                      {c.notes}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {selected && (
        <SpecialCustomerDetailModal
          customer={selected}
          onClose={() => setSelected(null)}
          onUpdated={updated => {
            setCustomers(prev => prev.map(c => c.id === updated.id ? updated : c))
            setSelected(updated)
          }}
        />
      )}

      {showCreate && (
        <CreateSpecialCustomerModal
          onClose={() => setShowCreate(false)}
          onCreate={async () => {
            setShowCreate(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Special customer detail + prices
// ---------------------------------------------------------------------------

interface SpecialCustomerDetailModalProps {
  customer: SpecialCustomer
  onClose: () => void
  onUpdated: (c: SpecialCustomer) => void
}

function SpecialCustomerDetailModal({
  customer,
  onClose,
  onUpdated,
}: SpecialCustomerDetailModalProps) {
  const [prices, setPrices] = useState<SpecialCustomerPrice[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddPrice, setShowAddPrice] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editName, setEditName] = useState(customer.name)
  const [savingEdit, setSavingEdit] = useState(false)

  const loadPrices = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchSpecialCustomerPrices(customer.id)
      setPrices(list)
    } finally {
      setLoading(false)
    }
  }, [customer.id])

  useEffect(() => {
    void loadPrices()
  }, [loadPrices])

  const handleToggleActive = async () => {
    await updateSpecialCustomer(customer.id, { active: !customer.active })
    onUpdated({ ...customer, active: !customer.active })
  }

  const handleSaveEdit = async () => {
    if (!editName.trim()) return
    setSavingEdit(true)
    await updateSpecialCustomer(customer.id, { name: editName.trim() })
    onUpdated({ ...customer, name: editName.trim() })
    setEditingName(false)
    setSavingEdit(false)
  }

  const handleDeletePrice = async (priceId: string) => {
    if (!confirm('¿Eliminar este precio especial?')) return
    await softDeleteSpecialCustomerPrice(priceId)
    setPrices(prev => prev.filter(p => p.id !== priceId))
  }

  return (
    <Modal title={customer.name} onClose={onClose}>
      <div className="space-y-4 max-h-[80vh] overflow-y-auto">
        {editingName ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              maxLength={100}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none"
            />
            <Btn onClick={handleSaveEdit} loading={savingEdit}>OK</Btn>
            <Btn variant="ghost" onClick={() => { setEditingName(false); setEditName(customer.name) }}>✕</Btn>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="text-sm text-zinc-500 underline"
            >
              Editar nombre
            </button>
            <button
              type="button"
              onClick={handleToggleActive}
              className={`text-sm ${customer.active ? 'text-zinc-500' : 'text-emerald-500'} underline`}
            >
              {customer.active ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        )}

        {/* Prices list */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">Precios especiales</p>
            <button
              type="button"
              onClick={() => setShowAddPrice(true)}
              className="text-xs text-emerald-500 underline"
            >
              + Agregar
            </button>
          </div>
          {loading ? (
            <Spinner />
          ) : prices.length === 0 ? (
            <EmptyState message="Sin precios especiales configurados." />
          ) : (
            <ul className="space-y-1.5">
              {prices.map(p => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 min-w-0 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                >
                  <span
                    className="min-w-0 flex-1 truncate text-sm text-zinc-300"
                    title={p.productName}
                  >
                    {p.productName}
                  </span>
                  <span className="shrink-0 font-mono text-sm text-emerald-400">
                    {formatMoney(p.specialPrice)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDeletePrice(p.id)}
                    className="shrink-0 text-zinc-600 hover:text-red-400 transition-colors"
                    aria-label="Eliminar precio"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showAddPrice && (
        <AddPriceModal
          customerId={customer.id}
          onClose={() => setShowAddPrice(false)}
          onAdded={() => {
            setShowAddPrice(false)
            void loadPrices()
          }}
        />
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Add price modal
// ---------------------------------------------------------------------------

interface AddPriceModalProps {
  customerId: string
  onClose: () => void
  onAdded: () => void
}

function AddPriceModal({ customerId, onClose, onAdded }: AddPriceModalProps) {
  const [productName, setProductName] = useState('')
  const [priceInput, setPriceInput] = useState('')
  const [storeId, setStoreId] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!productName.trim()) {
      setErr('Ingresá el nombre del producto.')
      return
    }
    const price = parseDigits(priceInput)
    if (price <= 0) {
      setErr('Ingresá un precio válido.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await createSpecialCustomerPrice({
        specialCustomerId: customerId,
        productId: crypto.randomUUID(),
        productName: productName.trim(),
        specialPrice: price,
        storeId: storeId.trim() || 'global',
      })
      onAdded()
    } catch {
      setErr('No se pudo guardar el precio.')
      setSaving(false)
    }
  }

  return (
    <Modal title="Agregar precio especial" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <LabeledInput
          label="Producto *"
          value={productName}
          onChange={setProductName}
          placeholder="Ej: Vacío por kg"
          maxLength={100}
          required
        />
        <LabeledInput
          label="Precio especial ($)"
          value={priceInput}
          onChange={v => setPriceInput(filterDigits(v))}
          placeholder="0"
          inputMode="numeric"
        />
        <LabeledInput
          label="Local (opcional, dejar vacío = todos)"
          value={storeId}
          onChange={setStoreId}
          placeholder="ID del local"
          maxLength={60}
        />
        {err && <p className="text-sm text-red-400/80">{err}</p>}
        <div className="flex gap-2">
          <Btn variant="ghost" className="flex-1" onClick={onClose}>Cancelar</Btn>
          <Btn type="submit" className="flex-1" loading={saving}>Guardar</Btn>
        </div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Create special customer
// ---------------------------------------------------------------------------

interface CreateSpecialCustomerModalProps {
  onClose: () => void
  onCreate: () => Promise<void>
}

function CreateSpecialCustomerModal({ onClose, onCreate }: CreateSpecialCustomerModalProps) {
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
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
      await createSpecialCustomer({
        name: name.trim(),
        notes: notes.trim() || null,
        storeId: null,
        active: true,
      })
      await onCreate()
    } catch {
      setErr('No se pudo crear el cliente.')
      setSaving(false)
    }
  }

  return (
    <Modal title="Nuevo cliente especial" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <LabeledInput
          label="Nombre *"
          value={name}
          onChange={setName}
          placeholder="Nombre del cliente"
          maxLength={100}
          required
        />
        <LabeledTextarea
          label="Notas"
          value={notes}
          onChange={setNotes}
          placeholder="Observaciones..."
          rows={2}
          maxLength={300}
        />
        {err && <p className="text-sm text-red-400/80">{err}</p>}
        <div className="flex gap-2">
          <Btn variant="ghost" className="flex-1" onClick={onClose}>Cancelar</Btn>
          <Btn type="submit" className="flex-1" loading={saving}>Crear</Btn>
        </div>
      </form>
    </Modal>
  )
}
