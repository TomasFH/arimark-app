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
  StoreSelector,
  filterDigits,
  parseDigits,
} from './shared'
import {
  fetchCustomers,
  fetchAllCustomerDebtEvents,
  fetchCustomerDebtEvents,
  createCustomer,
  createCustomerDebtEvent,
  calcCustomerBalance,
  formatMoney,
  formatDate,
  type Customer,
  type CustomerDebtEvent,
  type DebtEventType,
  type StoreDoc,
} from '../../lib/adminFirestore'
import type { LocalProfile } from '../../types/pos'

interface Props {
  onBack: () => void
  stores: StoreDoc[]
  profile: LocalProfile
}

const EVENT_LABEL: Record<DebtEventType, string> = {
  debt: 'Deuda',
  partial_payment: 'Pago parcial',
  paid: 'Pago total',
  cancelled: 'Cancelada',
}

export function DebtsScreen({ onBack, stores, profile }: Props) {
  const online = useOnlineStatus()
  const activeStores = stores.filter(s => !s.archivedAt)
  const [storeId, setStoreId] = useState<string>(() => activeStores[0]?.id ?? '')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [allEvents, setAllEvents] = useState<CustomerDebtEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Customer | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async (sid: string) => {
    setLoading(true)
    setError(null)
    try {
      const [cList, eList] = await Promise.all([
        fetchCustomers(sid || undefined),
        fetchAllCustomerDebtEvents(sid || undefined),
      ])
      setCustomers(cList)
      setAllEvents(eList)
    } catch {
      setError('No se pudieron cargar los fiados.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(storeId)
  }, [storeId, load])

  const balanceFor = (customerId: string) =>
    calcCustomerBalance(allEvents.filter(e => e.customerId === customerId))

  const displayed = customers.filter(c => {
    const bal = balanceFor(c.id)
    if (!showAll && bal <= 0) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <ScreenHeader
        title="Fiados"
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
            aria-label="Nuevo cliente"
          >
            +
          </button>
        }
      />

      {!online && <OfflineBanner />}

      <StoreSelector
        stores={activeStores}
        value={storeId}
        onChange={id => { setStoreId(id); setSelected(null) }}
        allowAll
      />

      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
        <button
          type="button"
          onClick={() => setShowAll(p => !p)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            showAll ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {showAll ? 'Todos' : 'Con deuda'}
        </button>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar cliente..."
          className="ml-auto min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
        />
      </div>

      <main className="flex-1 px-4 py-4">
        {error && <ErrorBanner message={error} onRetry={() => void load(storeId)} />}
        {loading && <Spinner />}
        {!loading && !error && displayed.length === 0 && (
          <EmptyState message={showAll ? 'No hay clientes.' : 'Sin clientes con deuda.'} />
        )}
        {!loading && !error && displayed.length > 0 && (
          <ul className="space-y-2">
            {displayed.map(c => {
              const bal = balanceFor(c.id)
              return (
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
                      <span
                        className={`shrink-0 font-mono text-sm font-semibold ${
                          bal > 0 ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        {formatMoney(bal)}
                      </span>
                    </div>
                    {(c.phone ?? c.dni) && (
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {[c.phone, c.dni ? `DNI ${c.dni}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {selected && (
        <CustomerDetailModal
          customer={selected}
          storeId={storeId || selected.storeId}
          profile={profile}
          onClose={() => setSelected(null)}
          onEventCreated={() => void load(storeId)}
        />
      )}

      {showCreate && (
        <CreateCustomerModal
          stores={activeStores}
          defaultStoreId={storeId}
          profile={profile}
          onClose={() => setShowCreate(false)}
          onCreate={() => {
            setShowCreate(false)
            void load(storeId)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Customer detail / ledger
// ---------------------------------------------------------------------------

interface CustomerDetailModalProps {
  customer: Customer
  storeId: string
  profile: LocalProfile
  onClose: () => void
  onEventCreated: () => void
}

function CustomerDetailModal({
  customer,
  storeId,
  profile,
  onClose,
  onEventCreated,
}: CustomerDetailModalProps) {
  const [events, setEvents] = useState<CustomerDebtEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [showPayment, setShowPayment] = useState(false)
  const [showCancel, setShowCancel] = useState(false)

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchCustomerDebtEvents(customer.id)
      setEvents(list)
    } finally {
      setLoading(false)
    }
  }, [customer.id])

  useEffect(() => {
    void loadEvents()
  }, [loadEvents])

  const balance = calcCustomerBalance(events)

  const handlePayment = async (amount: number, type: 'partial_payment' | 'paid') => {
    await createCustomerDebtEvent({
      customerId: customer.id,
      storeId: storeId || customer.storeId,
      eventType: type,
      amount,
      notes: null,
      dueDate: null,
      createdAt: new Date().toISOString(),
      createdBy: profile.uid,
    })
    await loadEvents()
    onEventCreated()
  }

  const handleCancel = async () => {
    if (balance <= 0) return
    await createCustomerDebtEvent({
      customerId: customer.id,
      storeId: storeId || customer.storeId,
      eventType: 'cancelled',
      amount: balance,
      notes: 'Deuda cancelada por admin',
      dueDate: null,
      createdAt: new Date().toISOString(),
      createdBy: profile.uid,
    })
    await loadEvents()
    onEventCreated()
    setShowCancel(false)
  }

  return (
    <Modal title={customer.name} onClose={onClose}>
      <div className="space-y-4">
        {(customer.phone ?? customer.dni) && (
          <p className="text-sm text-zinc-400">
            {[customer.phone, customer.dni ? `DNI ${customer.dni}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}

        {/* Balance */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-center">
          <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Saldo</p>
          <p
            className={`text-2xl font-mono font-bold ${
              balance > 0 ? 'text-amber-400' : 'text-emerald-400'
            }`}
          >
            {formatMoney(balance)}
          </p>
        </div>

        {/* Actions */}
        {balance > 0 && (
          <div className="flex gap-2">
            <Btn
              className="flex-1"
              onClick={() => setShowPayment(true)}
            >
              Registrar pago
            </Btn>
            <Btn
              variant="danger"
              className="flex-1"
              onClick={() => setShowCancel(true)}
            >
              Cancelar deuda
            </Btn>
          </div>
        )}

        {/* Ledger */}
        <div>
          <p className="mb-2 text-xs text-zinc-500 uppercase tracking-wide">
            Movimientos
          </p>
          {loading ? (
            <Spinner />
          ) : events.length === 0 ? (
            <EmptyState message="Sin movimientos." />
          ) : (
            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
              {events.map(e => (
                <li
                  key={e.id}
                  className="flex items-center gap-2 min-w-0 text-sm"
                >
                  <span className="shrink-0 text-zinc-500 text-xs">
                    {formatDate(e.createdAt)}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-zinc-400"
                    title={EVENT_LABEL[e.eventType]}
                  >
                    {EVENT_LABEL[e.eventType]}
                    {e.notes ? ` — ${e.notes}` : ''}
                  </span>
                  <span
                    className={`shrink-0 font-mono text-xs ${
                      e.eventType === 'debt' ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {e.eventType === 'debt' ? '+' : '-'}
                    {formatMoney(e.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {showPayment && (
          <PaymentModal
            balance={balance}
            onClose={() => setShowPayment(false)}
            onPay={handlePayment}
          />
        )}

        {showCancel && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-400/80">
            <p>¿Cancelar la deuda de {formatMoney(balance)}?</p>
            <div className="mt-2 flex gap-2">
              <Btn
                variant="ghost"
                className="flex-1"
                onClick={() => setShowCancel(false)}
              >
                No
              </Btn>
              <Btn variant="danger" className="flex-1" onClick={handleCancel}>
                Sí, cancelar
              </Btn>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Payment modal
// ---------------------------------------------------------------------------

interface PaymentModalProps {
  balance: number
  onClose: () => void
  onPay: (amount: number, type: 'partial_payment' | 'paid') => Promise<void>
}

function PaymentModal({ balance, onClose, onPay }: PaymentModalProps) {
  const [amountInput, setAmountInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handlePay = async () => {
    const amount = parseDigits(amountInput)
    if (amount <= 0) {
      setErr('Ingresá un monto válido.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const type = amount >= balance ? 'paid' : 'partial_payment'
      await onPay(amount, type)
      onClose()
    } catch {
      setErr('No se pudo registrar el pago.')
      setSaving(false)
    }
  }

  return (
    <Modal title="Registrar pago" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">
          Deuda actual: <span className="font-mono font-semibold text-amber-400">{formatMoney(balance)}</span>
        </p>
        <LabeledInput
          label="Monto pagado ($)"
          value={amountInput}
          onChange={v => setAmountInput(filterDigits(v))}
          placeholder="0"
          inputMode="numeric"
        />
        {err && (
          <p className="text-sm text-red-400/80">{err}</p>
        )}
        <div className="flex gap-2">
          <Btn variant="ghost" className="flex-1" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn className="flex-1" loading={saving} onClick={handlePay}>
            Confirmar
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Create customer + first debt
// ---------------------------------------------------------------------------

interface CreateCustomerModalProps {
  stores: StoreDoc[]
  defaultStoreId: string
  profile: LocalProfile
  onClose: () => void
  onCreate: () => void
}

function CreateCustomerModal({
  stores,
  defaultStoreId,
  profile,
  onClose,
  onCreate,
}: CreateCustomerModalProps) {
  const [storeId, setStoreId] = useState(defaultStoreId || (stores[0]?.id ?? ''))
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [dni, setDni] = useState('')
  const [debtInput, setDebtInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setErr('El nombre es obligatorio.')
      return
    }
    if (!storeId) {
      setErr('Seleccioná un local.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const customerId = await createCustomer({
        name: name.trim(),
        phone: phone.trim() || null,
        dni: dni.trim() || null,
        storeId,
        active: true,
      })
      const debt = parseDigits(debtInput)
      if (debt > 0) {
        await createCustomerDebtEvent({
          customerId,
          storeId,
          eventType: 'debt',
          amount: debt,
          notes: null,
          dueDate: null,
          createdAt: new Date().toISOString(),
          createdBy: profile.uid,
        })
      }
      onCreate()
    } catch {
      setErr('No se pudo crear el cliente.')
      setSaving(false)
    }
  }

  return (
    <Modal title="Nuevo cliente" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {stores.length > 1 && (
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-400">Local</span>
            <select
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none"
            >
              {stores.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <LabeledInput
          label="Nombre *"
          value={name}
          onChange={setName}
          placeholder="Juan García"
          maxLength={100}
          required
        />
        <LabeledInput
          label="Teléfono"
          value={phone}
          onChange={setPhone}
          placeholder="11-1234-5678"
          inputMode="tel"
          maxLength={30}
        />
        <LabeledInput
          label="DNI"
          value={dni}
          onChange={setDni}
          placeholder="12345678"
          inputMode="numeric"
          maxLength={15}
        />
        <LabeledInput
          label="Deuda inicial ($)"
          value={debtInput}
          onChange={v => setDebtInput(filterDigits(v))}
          placeholder="0"
          inputMode="numeric"
        />
        {err && (
          <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400/80">
            {err}
          </p>
        )}
        <div className="flex gap-2 pt-1">
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
