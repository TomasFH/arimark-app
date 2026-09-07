/**
 * Gestión de empleados / carniceros (solo admin).
 * ABM: crear, editar nombre/sueldo semanal, eliminar y restaurar.
 * Para carniceros: otorgar/revocar acceso celular (cuenta Firebase).
 */
import { useEffect, useState } from 'react'
import BackButton from '../components/BackButton'
import NumericInput from '../components/NumericInput'
import { formatARS } from '../lib/datetime'
import { formatNumericInputValue, parseNumericInput } from '../lib/numericInput'
import SalaryPaymentModal from './SalaryPaymentModal'
import { GrantButcherAccessModal, RevokeButcherAccessModal } from '../components/ButcherAccessModals'
import type { EmployeeRow } from '../types/hw-api'

interface Props {
  onBack?: () => void
  embedded?: boolean
  kind?: 'butcher' | 'cashier'
  hideCreate?: boolean
  showPayrollButton?: boolean
}

type ModalMode =
  | { type: 'none' }
  | { type: 'create' }
  | { type: 'edit'; employee: EmployeeRow }
  | { type: 'delete'; employee: EmployeeRow }
  | { type: 'grantAccess'; employee: EmployeeRow }
  | { type: 'revokeAccess'; employee: EmployeeRow }

export default function EmployeesScreen({
  onBack,
  embedded = false,
  kind,
  hideCreate = false,
  showPayrollButton = true,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [list, setList] = useState<EmployeeRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalMode>({ type: 'none' })
  const [showArchived, setShowArchived] = useState(false)
  const [showLiquidation, setShowLiquidation] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [grantingAccessId, setGrantingAccessId] = useState<string | null>(null)

  const roleLabel = kind === 'cashier' ? 'cajeras' : kind === 'butcher' ? 'carniceros' : 'empleados'

  async function load(includeArchived = showArchived) {
    setLoading(true)
    setError(null)
    const r = await window.hw.listEmployees(
      includeArchived ? { includeArchived: true } : undefined,
    )
    setLoading(false)
    if (r.ok) {
      const byActive = includeArchived ? r.data.filter(e => !e.active) : r.data
      const byKind = kind
        ? byActive.filter(e => (e.kind === 'cashier' ? 'cashier' : 'butcher') === kind)
        : byActive
      setList(byKind)
    } else {
      setError(r.error ?? 'Error al cargar empleados.')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived, kind])

  async function handleUnarchive(emp: EmployeeRow) {
    setRestoringId(emp.id)
    setError(null)
    const r = await window.hw.unarchiveEmployee({ id: emp.id })
    setRestoringId(null)
    if (!r.ok) {
      setError(r.error ?? 'No se pudo restaurar.')
      return
    }
    await load()
  }

  async function handleGrantAccess(emp: EmployeeRow) {
    setGrantingAccessId(emp.id)
    setError(null)
    const r = await window.hw.grantButcherAccess({ employeeId: emp.id })
    setGrantingAccessId(null)
    if (r.ok) {
      await load()
      return
    }
    if (r.code === 'EMAIL_REQUIRED') {
      setModal({ type: 'grantAccess', employee: emp })
      return
    }
    setError(r.error ?? 'No se pudo otorgar el acceso.')
  }

  return (
    <div className={`flex flex-col ${embedded ? '' : 'h-screen'} bg-zinc-950 text-white`}>
      <header className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/50 px-6 py-3 shrink-0">
        {!embedded && onBack && <BackButton onClick={onBack} />}
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-zinc-100 truncate">
            {embedded
              ? (kind === 'cashier' ? 'Sueldo y vales' : 'Alta y sueldos')
              : 'Empleados'}
          </h1>
          <p className="text-[10px] text-zinc-500 truncate">
            {showArchived ? 'Eliminados — restaurar para volver a usarlos' : 'Sueldo semanal y liquidación'}
          </p>
        </div>
        {!showArchived && showPayrollButton && (
          <button
            type="button"
            onClick={() => setShowLiquidation(true)}
            className="shrink-0 px-3 py-2 rounded-lg border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
            title="Sueldo menos vales de la semana"
          >
            Liquidación
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowArchived(v => !v)}
          className="shrink-0 px-3 py-2 rounded-lg border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
        >
          {showArchived ? 'Ver activos' : 'Ver eliminados'}
        </button>
        {!showArchived && !hideCreate && (
          <button
            type="button"
            onClick={() => setModal({ type: 'create' })}
            className="shrink-0 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium transition-colors"
          >
            + Nuevo
          </button>
        )}
      </header>

      <div className={embedded ? '' : 'flex-1 overflow-y-auto'}>
        {loading && (
          <div className="flex justify-center items-center py-16">
            <p className="text-zinc-500 text-sm">Cargando empleados…</p>
          </div>
        )}

        {error && !loading && (
          <div className="mx-4 mt-4 p-4 rounded-xl bg-red-950/30 border border-red-900/50">
            <p className="text-red-400/80 text-sm">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 text-xs text-zinc-500 hover:text-zinc-300"
            >
              Reintentar
            </button>
          </div>
        )}

        {!loading && !error && (
          <div className="p-4 space-y-2">
            {list.length === 0 && (
              <div className="text-center py-12">
                <p className="text-zinc-500 text-sm">
                  {showArchived ? `No hay ${roleLabel} eliminados.` : `No hay ${roleLabel} activos.`}
                </p>
                {!showArchived && !hideCreate && (
                  <p className="text-zinc-600 text-xs mt-1">
                    Creá uno con “+ Nuevo” para registrar asistencia y vales.
                  </p>
                )}
                {!showArchived && hideCreate && kind === 'cashier' && (
                  <p className="text-zinc-600 text-xs mt-1">
                    Las cajeras con cuenta de login aparecen acá para sueldo y vales.
                  </p>
                )}
              </div>
            )}

            {list.map(emp => (
              <div
                key={emp.id}
                className="flex items-center gap-2 min-w-0 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate" title={emp.name}>
                    {emp.name}
                  </p>
                  <p className="text-xs text-zinc-400 tabular-nums">
                    Sueldo semanal: {formatARS(emp.weeklyWage)}
                    {!emp.active && (
                      <span className="ml-2 text-zinc-500">· Eliminado</span>
                    )}
                    {emp.kind === 'butcher' && emp.firebaseUid && (
                      <span className="ml-2 text-emerald-500/80">· Acceso celular activo</span>
                    )}
                  </p>
                </div>
                {showArchived ? (
                  <button
                    type="button"
                    disabled={restoringId === emp.id}
                    onClick={() => void handleUnarchive(emp)}
                    className="shrink-0 text-xs text-zinc-300 hover:text-zinc-100 px-2 py-1 rounded-lg hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {restoringId === emp.id ? 'Restaurando…' : 'Restaurar'}
                  </button>
                ) : (
                  <>
                    {emp.kind === 'butcher' && (
                      emp.firebaseUid ? (
                        <button
                          type="button"
                          onClick={() => setModal({ type: 'revokeAccess', employee: emp })}
                          className="shrink-0 text-xs text-amber-400 hover:text-amber-300 px-2 py-1 rounded-lg hover:bg-zinc-800"
                          title="Revocar acceso al celular"
                        >
                          Revocar acceso
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={grantingAccessId === emp.id}
                          onClick={() => void handleGrantAccess(emp)}
                          className="shrink-0 text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded-lg hover:bg-zinc-800 disabled:opacity-50"
                          title="Dar acceso al celular"
                        >
                          {grantingAccessId === emp.id ? 'Restableciendo…' : 'Dar acceso'}
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => setModal({ type: 'edit', employee: emp })}
                      className="shrink-0 text-xs text-zinc-300 hover:text-zinc-100 px-2 py-1 rounded-lg hover:bg-zinc-800"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setModal({ type: 'delete', employee: emp })}
                      className="shrink-0 text-xs text-zinc-400 hover:text-red-400 px-2 py-1 rounded-lg hover:bg-zinc-800"
                    >
                      Eliminar
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {modal.type === 'create' && (
        <EmployeeFormModal
          title="Nuevo empleado"
          initialName=""
          initialWage=""
          onCancel={() => setModal({ type: 'none' })}
          onSave={async (name, weeklyWage) => {
            const r = await window.hw.createEmployee({ name, weeklyWage, kind: kind ?? 'butcher' })
            if (!r.ok) return r.error ?? 'No se pudo crear.'
            setModal({ type: 'none' })
            await load()
            return null
          }}
        />
      )}

      {modal.type === 'edit' && (
        <EmployeeFormModal
          title="Editar empleado"
          initialName={modal.employee.name}
          initialWage={formatNumericInputValue(String(modal.employee.weeklyWage))}
          onCancel={() => setModal({ type: 'none' })}
          onSave={async (name, weeklyWage) => {
            const r = await window.hw.updateEmployee({
              id: modal.employee.id,
              name,
              weeklyWage,
            })
            if (!r.ok) return r.error ?? 'No se pudo actualizar.'
            setModal({ type: 'none' })
            await load()
            return null
          }}
        />
      )}

      {modal.type === 'delete' && (
        <DeleteConfirmModal
          name={modal.employee.name}
          onCancel={() => setModal({ type: 'none' })}
          onConfirm={async () => {
            const r = await window.hw.archiveEmployee({ id: modal.employee.id })
            if (!r.ok) {
              setError(r.error ?? 'No se pudo eliminar.')
              setModal({ type: 'none' })
              return
            }
            setModal({ type: 'none' })
            await load()
          }}
        />
      )}

      {modal.type === 'grantAccess' && (
        <GrantButcherAccessModal
          employeeName={modal.employee.name}
          onCancel={() => setModal({ type: 'none' })}
          onGrant={async (email) => {
            const r = await window.hw.grantButcherAccess({ employeeId: modal.employee.id, email })
            if (!r.ok) return r.error ?? 'No se pudo otorgar el acceso.'
            setModal({ type: 'none' })
            await load()
            return null
          }}
        />
      )}

      {modal.type === 'revokeAccess' && (
        <RevokeButcherAccessModal
          employeeName={modal.employee.name}
          onCancel={() => setModal({ type: 'none' })}
          onConfirm={async () => {
            const r = await window.hw.revokeButcherAccess({ employeeId: modal.employee.id })
            if (!r.ok) {
              setError(r.error ?? 'No se pudo revocar el acceso.')
            }
            setModal({ type: 'none' })
            await load()
          }}
        />
      )}

      {showLiquidation && (
        <SalaryPaymentModal onClose={() => setShowLiquidation(false)} />
      )}
    </div>
  )
}

function EmployeeFormModal({
  title,
  initialName,
  initialWage,
  onCancel,
  onSave,
}: {
  title: string
  initialName: string
  initialWage: string
  onCancel: () => void
  onSave: (name: string, weeklyWage: number) => Promise<string | null>
}) {
  const [name, setName] = useState(initialName)
  const [wage, setWage] = useState(initialWage)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setFormError('El nombre es obligatorio.')
      return
    }
    const weeklyWage = parseNumericInput(wage)
    if (weeklyWage === null || weeklyWage < 0) {
      setFormError('Ingresá un sueldo semanal válido (0 o más).')
      return
    }
    setSaving(true)
    setFormError(null)
    const err = await onSave(trimmed, weeklyWage)
    setSaving(false)
    if (err) setFormError(err)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-overlay-fade">
      <form
        onSubmit={e => void handleSubmit(e)}
        className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-700 p-5 space-y-4"
      >
        <h2 className="text-lg font-semibold">{title}</h2>

        <div>
          <label className="block text-sm text-zinc-300 mb-1">Nombre</label>
          <input
            type="text"
            value={name}
            maxLength={100}
            onChange={e => setName(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Nombre del carnicero"
            autoFocus
            required
          />
        </div>

        <div>
          <label className="block text-sm text-zinc-300 mb-1">Sueldo semanal ($)</label>
          <NumericInput
            value={wage}
            onChange={setWage}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="0"
          />
        </div>

        {formError && (
          <p className="text-sm text-red-400/80">{formError}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}

function DeleteConfirmModal({
  name,
  onCancel,
  onConfirm,
}: {
  name: string
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-overlay-fade">
      <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-800 p-6 space-y-4">
        <h2 className="text-base font-semibold text-white min-w-0">
          ¿Estás seguro que querés eliminar{' '}
          <span className="truncate inline-block max-w-full align-bottom" title={name}>{name}</span>
          ?
        </h2>
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void onConfirm().finally(() => setBusy(false))
            }}
            className="flex-1 py-2 rounded-xl bg-red-900/60 hover:bg-red-900/80 border border-red-900/50 text-red-400/90 font-semibold disabled:opacity-40"
          >
            {busy ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}
