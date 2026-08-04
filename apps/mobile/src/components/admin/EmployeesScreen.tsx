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
  fetchEmployees,
  fetchEmployeeValesForEmployee,
  createEmployee,
  updateEmployee,
  archiveEmployee,
  unarchiveEmployee,
  formatMoney,
  formatDate,
  type Employee,
  type EmployeeVale,
  type StoreDoc,
} from '../../lib/adminFirestore'

interface Props {
  onBack: () => void
  stores: StoreDoc[]
}

export function EmployeesScreen({ onBack, stores }: Props) {
  const online = useOnlineStatus()
  const activeStores = stores.filter(s => !s.archivedAt)
  const [storeId, setStoreId] = useState<string>(() => activeStores[0]?.id ?? '')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Employee | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async (sid: string) => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchEmployees(sid || undefined)
      setEmployees(list)
    } catch {
      setError('No se pudieron cargar los empleados.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(storeId)
  }, [storeId, load])

  const displayed = employees.filter(e => {
    if (!showArchived && e.archivedAt) return false
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const storeMap = new Map(stores.map(s => [s.id, s.name]))

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <ScreenHeader
        title="Carniceros"
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
            aria-label="Nuevo empleado"
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
        {error && <ErrorBanner message={error} onRetry={() => void load(storeId)} />}
        {loading && <Spinner />}
        {!loading && !error && displayed.length === 0 && (
          <EmptyState message="No hay empleados." />
        )}
        {!loading && !error && displayed.length > 0 && (
          <ul className="space-y-2">
            {displayed.map(emp => (
              <li key={emp.id}>
                <button
                  type="button"
                  onClick={() => setSelected(emp)}
                  className={`w-full rounded-xl border px-4 py-3 text-left hover:border-zinc-700 transition-colors ${
                    emp.archivedAt
                      ? 'border-zinc-800/50 bg-zinc-900/50 opacity-60'
                      : 'border-zinc-800 bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="min-w-0 flex-1 truncate font-medium text-zinc-100"
                      title={emp.name}
                    >
                      {emp.name}
                    </span>
                    {emp.archivedAt && (
                      <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
                        Archivado
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-zinc-500">
                    <span>{storeMap.get(emp.storeId) ?? emp.storeId}</span>
                    <span className="font-mono">{formatMoney(emp.salary)}/mes</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {selected && (
        <EmployeeDetailModal
          employee={selected}
          onClose={() => setSelected(null)}
          onUpdated={updated => {
            setEmployees(prev => prev.map(e => e.id === updated.id ? updated : e))
            setSelected(updated)
          }}
          onRefresh={() => void load(storeId)}
        />
      )}

      {showCreate && (
        <CreateEmployeeModal
          stores={activeStores}
          defaultStoreId={storeId}
          onClose={() => setShowCreate(false)}
          onCreate={async () => {
            setShowCreate(false)
            void load(storeId)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Employee detail modal
// ---------------------------------------------------------------------------

interface EmployeeDetailModalProps {
  employee: Employee
  onClose: () => void
  onUpdated: (e: Employee) => void
  onRefresh: () => void
}

function EmployeeDetailModal({
  employee,
  onClose,
  onUpdated,
  onRefresh,
}: EmployeeDetailModalProps) {
  const [vales, setVales] = useState<EmployeeVale[]>([])
  const [loadingVales, setLoadingVales] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(employee.name)
  const [editSalaryInput, setEditSalaryInput] = useState(String(employee.salary))
  const [savingEdit, setSavingEdit] = useState(false)

  const loadVales = useCallback(async () => {
    setLoadingVales(true)
    try {
      const list = await fetchEmployeeValesForEmployee(employee.id)
      setVales(list)
    } finally {
      setLoadingVales(false)
    }
  }, [employee.id])

  useEffect(() => {
    void loadVales()
  }, [loadVales])

  const handleSaveEdit = async () => {
    if (!editName.trim()) return
    setSavingEdit(true)
    const salary = parseDigits(editSalaryInput)
    await updateEmployee(employee.id, { name: editName.trim(), salary })
    onUpdated({ ...employee, name: editName.trim(), salary })
    onRefresh()
    setEditing(false)
    setSavingEdit(false)
  }

  const handleArchiveToggle = async () => {
    const action = employee.archivedAt ? 'restaurar' : 'archivar'
    if (!confirm(`¿Querés ${action} a ${employee.name}?`)) return
    if (employee.archivedAt) {
      await unarchiveEmployee(employee.id)
      onUpdated({ ...employee, archivedAt: null })
    } else {
      await archiveEmployee(employee.id)
      onUpdated({ ...employee, archivedAt: new Date().toISOString() })
    }
    onRefresh()
  }

  const valeTotal = vales.reduce((s, v) => s + v.amount, 0)

  return (
    <Modal title={employee.name} onClose={onClose}>
      <div className="space-y-4 max-h-[80vh] overflow-y-auto">
        {editing ? (
          <div className="space-y-2">
            <LabeledInput
              label="Nombre"
              value={editName}
              onChange={setEditName}
              maxLength={100}
            />
            <LabeledInput
              label="Sueldo mensual ($)"
              value={editSalaryInput}
              onChange={v => setEditSalaryInput(filterDigits(v))}
              inputMode="numeric"
            />
            <div className="flex gap-2">
              <Btn className="flex-1" onClick={handleSaveEdit} loading={savingEdit}>
                Guardar
              </Btn>
              <Btn
                variant="ghost"
                className="flex-1"
                onClick={() => {
                  setEditing(false)
                  setEditName(employee.name)
                  setEditSalaryInput(String(employee.salary))
                }}
              >
                Cancelar
              </Btn>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm text-zinc-400">Sueldo:</span>
              <span className="font-mono font-semibold text-zinc-100">
                {formatMoney(employee.salary)}/mes
              </span>
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-2 text-sm text-zinc-500 underline"
            >
              Editar datos
            </button>
          </div>
        )}

        {/* Vales summary */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">
              Vales ({vales.length})
            </p>
            {vales.length > 0 && (
              <span className="font-mono text-sm text-amber-400">{formatMoney(valeTotal)}</span>
            )}
          </div>
          {loadingVales ? (
            <Spinner />
          ) : vales.length === 0 ? (
            <EmptyState message="Sin vales registrados." />
          ) : (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto">
              {vales.slice(0, 30).map(v => (
                <li key={v.id} className="flex items-center gap-2 min-w-0 text-sm">
                  <span className="shrink-0 text-xs text-zinc-500">
                    {formatDate(v.paidAt)}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-zinc-400"
                    title={v.description ?? 'Adelanto'}
                  >
                    {v.description ?? 'Adelanto'}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-amber-400">
                    {formatMoney(v.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Btn
          variant={employee.archivedAt ? 'ghost' : 'danger'}
          className="w-full"
          onClick={handleArchiveToggle}
        >
          {employee.archivedAt ? 'Restaurar empleado' : 'Archivar empleado'}
        </Btn>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Create employee modal
// ---------------------------------------------------------------------------

interface CreateEmployeeModalProps {
  stores: StoreDoc[]
  defaultStoreId: string
  onClose: () => void
  onCreate: () => Promise<void>
}

function CreateEmployeeModal({
  stores,
  defaultStoreId,
  onClose,
  onCreate,
}: CreateEmployeeModalProps) {
  const [storeId, setStoreId] = useState(defaultStoreId || (stores[0]?.id ?? ''))
  const [name, setName] = useState('')
  const [salaryInput, setSalaryInput] = useState('')
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
      await createEmployee({
        name: name.trim(),
        salary: parseDigits(salaryInput),
        storeId,
      })
      await onCreate()
    } catch {
      setErr('No se pudo crear el empleado.')
      setSaving(false)
    }
  }

  return (
    <Modal title="Nuevo carnicero" onClose={onClose}>
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
          placeholder="Nombre del empleado"
          maxLength={100}
          required
        />
        <LabeledInput
          label="Sueldo mensual ($)"
          value={salaryInput}
          onChange={v => setSalaryInput(filterDigits(v))}
          placeholder="0"
          inputMode="numeric"
        />
        {err && (
          <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400/80">
            {err}
          </p>
        )}
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
