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
  LabeledNumericInput,
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
} from '../../lib/adminFirestore'
import { parseNumericInput, formatNumericInputValue } from '../../lib/numericInput'
import type { LocalProfile } from '../../types/pos'

interface Props {
  onBack: () => void
  profile: LocalProfile
  embedded?: boolean
  kind?: 'butcher' | 'cashier'
  hideCreate?: boolean
  onOpenPayroll?: () => void
}

export function EmployeesScreen({
  onBack,
  profile,
  embedded = false,
  kind,
  hideCreate = false,
  onOpenPayroll,
}: Props) {
  const online = useOnlineStatus()
  useBackLayer(!embedded, onBack)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [listMode, setListMode] = useState<'active' | 'archived'>('active')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Employee | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchEmployees()
      setEmployees(list)
    } catch {
      setError('No se pudieron cargar los empleados.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const displayed = employees.filter(e => {
    if (listMode === 'active' ? e.archivedAt : !e.archivedAt) return false
    if (kind && (e.kind === 'cashier' ? 'cashier' : 'butcher') !== kind) return false
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const roleLabel = kind === 'cashier' ? 'cajeras' : 'carniceros'

  return (
    <div className={`flex ${embedded ? '' : 'h-full min-h-0'} flex-col bg-zinc-950 text-zinc-100`}>
      {embedded ? (
        <div className="flex items-center justify-end gap-2 border-b border-zinc-800 px-4 py-2">
          {listMode === 'active' && onOpenPayroll && (
            <button
              type="button"
              onClick={onOpenPayroll}
              className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              title="Sueldo menos vales de la semana"
            >
              Liquidación
            </button>
          )}
          {!hideCreate && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
              aria-label="Nuevo empleado"
            >
              +
            </button>
          )}
        </div>
      ) : (
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
      )}

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

      <main className="px-4 py-4">
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}
        {loading && <Spinner />}
        {!loading && !error && displayed.length === 0 && (
          <EmptyState message={listMode === 'archived' ? `No hay ${roleLabel} eliminados.` : `No hay ${roleLabel}.`} />
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
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-zinc-500">
                    {formatMoney(emp.weeklyWage)}/semana
                  </p>
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
          onRefresh={() => void load()}
        />
      )}

      {showCreate && (
        <CreateEmployeeModal
          createdBy={profile.uid}
          kind={kind ?? 'butcher'}
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
  const [editWageInput, setEditWageInput] = useState(formatNumericInputValue(String(employee.weeklyWage)))
  const [savingEdit, setSavingEdit] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

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
    const weeklyWage = parseNumericInput(editWageInput) ?? 0
    await updateEmployee(employee.id, { name: editName.trim(), weeklyWage })
    onUpdated({ ...employee, name: editName.trim(), weeklyWage, salary: weeklyWage })
    onRefresh()
    setEditing(false)
    setSavingEdit(false)
  }

  const handleArchiveToggle = async () => {
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
            <LabeledNumericInput
              label="Sueldo semanal ($)"
              value={editWageInput}
              onChange={setEditWageInput}
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
                  setEditWageInput(formatNumericInputValue(String(employee.weeklyWage)))
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
                {formatMoney(employee.weeklyWage)}/semana
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
          onClick={() => setConfirmArchive(true)}
        >
          {employee.archivedAt
            ? (employee.kind === 'cashier' ? 'Restaurar cajera' : 'Restaurar carnicero')
            : (employee.kind === 'cashier' ? 'Eliminar cajera' : 'Eliminar carnicero')}
        </Btn>
      </div>

      {confirmArchive && (
        <ConfirmModal
          title={employee.archivedAt
            ? (employee.kind === 'cashier' ? 'Restaurar cajera' : 'Restaurar carnicero')
            : (employee.kind === 'cashier' ? 'Eliminar cajera' : 'Eliminar carnicero')}
          message={
            employee.archivedAt
              ? `¿Restaurar a ${employee.name}?`
              : `¿Estás seguro que querés eliminar ${employee.name}?`
          }
          confirmLabel={employee.archivedAt ? 'Restaurar' : 'Eliminar'}
          danger={!employee.archivedAt}
          onClose={() => setConfirmArchive(false)}
          onConfirm={handleArchiveToggle}
        />
      )}
    </Modal>
  )
}

interface CreateEmployeeModalProps {
  createdBy: string
  kind: 'butcher' | 'cashier'
  onClose: () => void
  onCreate: () => Promise<void>
}

function CreateEmployeeModal({
  createdBy,
  kind,
  onClose,
  onCreate,
}: CreateEmployeeModalProps) {
  const [name, setName] = useState('')
  const [wageInput, setWageInput] = useState('')
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
      await createEmployee({
        name: name.trim(),
        weeklyWage: parseNumericInput(wageInput) ?? 0,
        createdBy,
        kind,
      })
      await onCreate()
    } catch {
      setErr('No se pudo crear el empleado.')
      setSaving(false)
    }
  }

  return (
    <Modal title={kind === 'cashier' ? 'Nueva cajera (sueldo)' : 'Nuevo carnicero'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <LabeledInput
          label="Nombre *"
          value={name}
          onChange={setName}
          placeholder="Nombre del empleado"
          maxLength={100}
          required
        />
        <LabeledNumericInput
          label="Sueldo semanal ($)"
          value={wageInput}
          onChange={setWageInput}
          placeholder="0"
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
