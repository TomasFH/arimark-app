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
  Btn,
} from './shared'
import {
  fetchCashierUsers,
  updateUserActive,
  type AdminUser,
} from '../../lib/adminFirestore'

interface Props {
  onBack: () => void
  embedded?: boolean
}

export function CashiersScreen({ onBack, embedded = false }: Props) {
  const online = useOnlineStatus()
  useBackLayer(!embedded, onBack)
  const [cashiers, setCashiers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AdminUser | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchCashierUsers()
      setCashiers(list)
    } catch {
      setError('No se pudieron cargar las cajeras.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleToggleActive = async (cashier: AdminUser) => {
    const newActive = !cashier.active
    try {
      await updateUserActive(cashier.uid, newActive)
      const updated = { ...cashier, active: newActive }
      setCashiers(prev => prev.map(c => c.uid === cashier.uid ? updated : c))
      if (selected?.uid === cashier.uid) setSelected(updated)
    } catch {
      setError('No se pudo actualizar el estado.')
    }
  }

  return (
    <div className={`flex ${embedded ? '' : 'h-full min-h-0'} flex-col bg-zinc-950 text-zinc-100`}>
      {!embedded && <ScreenHeader title="Cajeras" onBack={onBack} />}

      {!online && <OfflineBanner />}

      <div className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-2.5">
        <p className="text-xs text-zinc-500">
          El alta de cuentas (email y contraseña) se hace desde la consola de Firebase.
          Acá podés ver y activar o desactivar cajeras. Los datos se sincronizan con la PC.
        </p>
      </div>

      <main className="px-4 py-4">
        {error && <ErrorBanner message={error} onRetry={load} />}
        {loading && <Spinner />}
        {!loading && !error && cashiers.length === 0 && (
          <EmptyState message="No hay cajeras registradas." />
        )}
        {!loading && !error && cashiers.length > 0 && (
          <ul className="space-y-2">
            {cashiers.map(cashier => (
              <li key={cashier.uid}>
                <button
                  type="button"
                  onClick={() => setSelected(cashier)}
                  className={`w-full rounded-xl border px-4 py-3 text-left hover:border-zinc-700 transition-colors ${
                    cashier.active
                      ? 'border-zinc-800 bg-zinc-900'
                      : 'border-zinc-800/50 bg-zinc-900/50 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="min-w-0 flex-1 truncate font-medium text-zinc-100"
                      title={cashier.displayName}
                    >
                      {cashier.displayName || cashier.email}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                        cashier.active
                          ? 'bg-emerald-950/50 text-emerald-400/70 border border-emerald-900/40'
                          : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                      }`}
                    >
                      {cashier.active ? 'Activa' : 'Inactiva'}
                    </span>
                  </div>
                  <p
                    className="mt-0.5 truncate text-xs text-zinc-500"
                    title={cashier.email}
                  >
                    {cashier.email}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {selected && (
        <CashierDetailModal
          cashier={selected}
          onClose={() => setSelected(null)}
          onToggleActive={handleToggleActive}
        />
      )}
    </div>
  )
}

interface CashierDetailModalProps {
  cashier: AdminUser
  onClose: () => void
  onToggleActive: (c: AdminUser) => Promise<void>
}

function CashierDetailModal({
  cashier,
  onClose,
  onToggleActive,
}: CashierDetailModalProps) {
  const [toggling, setToggling] = useState(false)

  const handleToggle = async () => {
    setToggling(true)
    await onToggleActive(cashier)
    setToggling(false)
  }

  return (
    <Modal title={cashier.displayName || cashier.email} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm">
          <p className="text-zinc-400">
            Email: <span className="text-zinc-200" title={cashier.email}>{cashier.email}</span>
          </p>
          <p className="mt-1 text-zinc-400">
            Estado:{' '}
            <span className={cashier.active ? 'text-emerald-400' : 'text-zinc-500'}>
              {cashier.active ? 'Activa' : 'Inactiva'}
            </span>
          </p>
        </div>

        <Btn
          className="w-full"
          variant={cashier.active ? 'danger' : 'primary'}
          loading={toggling}
          onClick={handleToggle}
        >
          {cashier.active ? 'Desactivar cajera' : 'Activar cajera'}
        </Btn>
      </div>
    </Modal>
  )
}
