/**
 * Panel admin móvil: consulta turnos y ventas desde Firestore.
 * Solo lectura — no opera el POS.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  fetchAdminStores,
  fetchAdminShifts,
  fetchAdminSalesForShift,
  sumPaymentTotals,
  type AdminStore,
  type AdminShift,
  type AdminSale,
  type PaymentTotals,
} from '../lib/adminHistory'
import type { LocalProfile, PaymentMethod } from '../types/pos'
import { useOnlineStatus } from '../lib/connectivity'

interface Props {
  profile: LocalProfile
  onLogout: () => void
}

type View =
  | { kind: 'list' }
  | { kind: 'detail'; shift: AdminShift }

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(n)
}

function formatDateTime(iso: string): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  debit: 'Débito',
  wallet: 'Billetera',
  credit: 'Crédito',
}

export function AdminDashboard({ profile, onLogout }: Props) {
  const online = useOnlineStatus()
  const [stores, setStores] = useState<AdminStore[]>([])
  const [storeId, setStoreId] = useState('')
  const [shifts, setShifts] = useState<AdminShift[]>([])
  const [loadingStores, setLoadingStores] = useState(true)
  const [loadingShifts, setLoadingShifts] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'list' })

  const loadStores = useCallback(async () => {
    setLoadingStores(true)
    setError(null)
    try {
      const list = await fetchAdminStores()
      setStores(list)
      setStoreId(prev => {
        if (prev && list.some(s => s.id === prev)) return prev
        return list[0]?.id ?? ''
      })
    } catch {
      setError('No se pudieron cargar los locales. Revisá la conexión.')
      setStores([])
    } finally {
      setLoadingStores(false)
    }
  }, [])

  const loadShifts = useCallback(async (id: string) => {
    if (!id) {
      setShifts([])
      return
    }
    setLoadingShifts(true)
    setError(null)
    try {
      const list = await fetchAdminShifts(id)
      setShifts(list)
    } catch {
      setError('No se pudieron cargar los turnos.')
      setShifts([])
    } finally {
      setLoadingShifts(false)
    }
  }, [])

  useEffect(() => {
    void loadStores()
  }, [loadStores])

  useEffect(() => {
    if (!storeId) return
    setView({ kind: 'list' })
    void loadShifts(storeId)
  }, [storeId, loadShifts])

  if (view.kind === 'detail') {
    return (
      <ShiftDetailView
        shift={view.shift}
        online={online}
        onBack={() => setView({ kind: 'list' })}
      />
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="sticky top-0 z-10 bg-gray-950/95 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Admin</p>
            <h1 className="text-lg font-bold truncate" title={profile.displayName}>
              {profile.displayName}
            </h1>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="shrink-0 text-sm text-gray-300 border border-gray-700 rounded-lg px-3 py-2"
          >
            Salir
          </button>
        </div>

        {!online && (
          <p className="mt-2 text-amber-300 text-sm">
            Sin conexión — los datos admin requieren internet.
          </p>
        )}

        <label className="block mt-3 text-sm text-gray-300">
          Local
          <select
            value={storeId}
            onChange={e => setStoreId(e.target.value)}
            disabled={loadingStores || stores.length === 0}
            className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white"
          >
            {stores.length === 0 && <option value="">Sin locales</option>}
            {stores.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main className="flex-1 px-4 py-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="font-semibold text-base">Turnos</h2>
          <button
            type="button"
            onClick={() => void loadShifts(storeId)}
            disabled={!storeId || loadingShifts}
            className="text-sm text-red-400 disabled:text-gray-600"
          >
            Actualizar
          </button>
        </div>

        {error && (
          <div className="mb-3 bg-red-900/40 border border-red-700 text-red-200 rounded-lg px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {(loadingStores || loadingShifts) && (
          <p className="text-gray-400 text-sm">Cargando...</p>
        )}

        {!loadingShifts && storeId && shifts.length === 0 && (
          <p className="text-gray-400 text-sm">
            No hay turnos sincronizados para este local.
          </p>
        )}

        <ul className="space-y-2">
          {shifts.map(shift => (
            <li key={shift.id}>
              <button
                type="button"
                onClick={() => setView({ kind: 'detail', shift })}
                className="w-full text-left bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="min-w-0 flex-1 truncate font-medium" title={shift.cashierName}>
                    {shift.cashierName}
                  </span>
                  <span
                    className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${
                      shift.closedAt
                        ? 'bg-gray-700 text-gray-200'
                        : 'bg-emerald-900/60 text-emerald-300'
                    }`}
                  >
                    {shift.closedAt ? 'Cerrado' : 'Abierto'}
                  </span>
                </div>
                <p className="text-sm text-gray-400 mt-1">
                  {shift.shiftType === 'morning' ? 'Mañana' : 'Tarde'} · {formatDateTime(shift.startedAt)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}

function ShiftDetailView({
  shift,
  online,
  onBack,
}: {
  shift: AdminShift
  online: boolean
  onBack: () => void
}) {
  const [sales, setSales] = useState<AdminSale[]>([])
  const [totals, setTotals] = useState<PaymentTotals>(sumPaymentTotals([]))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchAdminSalesForShift(shift.id)
      setSales(list.filter(s => s.status === 'confirmed'))
      setTotals(sumPaymentTotals(list))
    } catch {
      setError('No se pudieron cargar las ventas.')
      setSales([])
      setTotals(sumPaymentTotals([]))
    } finally {
      setLoading(false)
    }
  }, [shift.id])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="sticky top-0 z-10 bg-gray-950/95 border-b border-gray-800 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-red-400 mb-2"
        >
          ← Volver
        </button>
        <h1 className="text-lg font-bold truncate" title={shift.cashierName}>
          {shift.cashierName}
        </h1>
        <p className="text-sm text-gray-400">
          {shift.shiftType === 'morning' ? 'Mañana' : 'Tarde'} · {formatDateTime(shift.startedAt)}
          {shift.closedAt ? ` → ${formatDateTime(shift.closedAt)}` : ' · abierto'}
        </p>
        {!online && (
          <p className="mt-2 text-amber-300 text-sm">Sin conexión</p>
        )}
      </header>

      <main className="flex-1 px-4 py-4 space-y-4">
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-semibold">Totales por medio</h2>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="text-sm text-red-400 disabled:text-gray-600"
            >
              Actualizar
            </button>
          </div>
          {loading ? (
            <p className="text-gray-400 text-sm">Cargando...</p>
          ) : (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map(method => (
                <div key={method} className="flex justify-between gap-2 col-span-2 sm:col-span-1">
                  <dt className="text-gray-400">{METHOD_LABEL[method]}</dt>
                  <dd className="font-medium tabular-nums">{formatMoney(totals[method])}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-2 col-span-2 border-t border-gray-800 pt-2 mt-1">
                <dt className="font-semibold">Total</dt>
                <dd className="font-bold tabular-nums">{formatMoney(totals.total)}</dd>
              </div>
            </dl>
          )}
        </section>

        {error && (
          <div className="bg-red-900/40 border border-red-700 text-red-200 rounded-lg px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <section>
          <h2 className="font-semibold mb-2">Ventas ({sales.length})</h2>
          {!loading && sales.length === 0 && (
            <p className="text-gray-400 text-sm">Sin ventas confirmadas en este turno.</p>
          )}
          <ul className="space-y-2">
            {sales.map(sale => {
              const methods = [...new Set(sale.payments.map(p => METHOD_LABEL[p.paymentMethod]))]
              const itemNames = sale.items.map(i => i.productName).join(', ')
              return (
                <li
                  key={sale.id}
                  className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-300" title={itemNames}>
                      {itemNames || 'Venta'}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {formatMoney(sale.total)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 truncate" title={methods.join(' · ')}>
                    {formatDateTime(sale.createdAt)}
                    {methods.length > 0 ? ` · ${methods.join(' · ')}` : ''}
                  </p>
                </li>
              )
            })}
          </ul>
        </section>
      </main>
    </div>
  )
}
