/**
 * Empleados: cajeras y carniceros en una sola página, dos sectores.
 * Las acciones viven en el modal de la tarjeta; un solo alta elige el tipo.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import NumericInput from '../components/NumericInput'
import { formatARS, toLocalDate } from '../lib/datetime'
import { formatNumericInputValue, parseNumericInput } from '../lib/numericInput'
import { Button, Modal, ScreenHeader } from '../components/ui'
import { GrantButcherAccessModal, RevokeButcherAccessModal } from '../components/ButcherAccessModals'
import { buildStaffRoster, type StaffKind, type StaffMember } from '../lib/staffRoster'
import SalaryPaymentModal from './SalaryPaymentModal'
import type { CashierRow, EmployeeRow, EmployeeValeRow, StoreRow } from '../types/hw-api'

interface Props {
  onBack: () => void
}

export default function StaffScreen({ onBack }: Props) {
  const [cashiers, setCashiers] = useState<CashierRow[]>([])
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [stores, setStores] = useState<StoreRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showLiquidation, setShowLiquidation] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [cashiersR, empR, storesR] = await Promise.all([
      window.hw.listCashiers(),
      window.hw.listEmployees({ includeArchived: true }),
      window.hw.getStores(),
    ])
    if (!cashiersR.ok) {
      setError(cashiersR.error ?? 'No se pudieron cargar las cajeras.')
      setLoading(false)
      return
    }
    if (!empR.ok) {
      setError(empR.error ?? 'No se pudieron cargar los empleados.')
      setLoading(false)
      return
    }
    let empList = empR.data
    for (const cashier of cashiersR.data) {
      const name = cashier.displayName.trim()
      if (!name) continue
      const existing = empList.find(
        e => e.kind === 'cashier' && e.name.trim().toLowerCase() === name.toLowerCase(),
      )
      if (!existing) {
        if (!cashier.active) continue
        const created = await window.hw.createEmployee({ name, weeklyWage: 0, kind: 'cashier' })
        if (created.ok) empList = [...empList, created.data]
        continue
      }
      if (cashier.active && !existing.active) {
        const restored = await window.hw.unarchiveEmployee({ id: existing.id })
        if (restored.ok) {
          empList = empList.map(e => e.id === existing.id ? restored.data : e)
        }
      }
    }
    setCashiers(cashiersR.data)
    setEmployees(empList)
    if (storesR.ok) setStores(storesR.data.filter(s => !s.archivedAt))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const roster = useMemo(
    () => buildStaffRoster(
      cashiers,
      employees.map(e => ({
        id: e.id,
        name: e.name,
        weeklyWage: e.weeklyWage,
        active: e.active,
        kind: e.kind,
        homeStoreId: e.homeStoreId,
        firebaseUid: e.firebaseUid,
      })),
    ),
    [cashiers, employees],
  )

  const selected = useMemo(() => {
    if (!selectedKey) return null
    return [...roster.cashiers, ...roster.butchers].find(m => m.key === selectedKey) ?? null
  }, [roster, selectedKey])

  const visibleCashiers = roster.cashiers.filter(m => (showArchived ? !m.active : m.active))
  const visibleButchers = roster.butchers.filter(m => (showArchived ? !m.active : m.active))

  return (
    <div className="flex h-screen flex-col bg-app text-ink">
      <ScreenHeader
        title="Empleados"
        subtitle="Cajeras y carniceros · sueldo, vales y acceso a la app"
        onBack={onBack}
        actions={
          !showArchived ? (
            <Button size="sm" onClick={() => setShowCreate(true)}>+ Nuevo</Button>
          ) : undefined
        }
      />

      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-6 py-2.5">
        <div className="flex rounded-xl bg-raised p-0.5">
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              !showArchived ? 'bg-panel text-ink shadow-[0_1px_2px_rgba(28,28,30,0.12)]' : 'text-muted hover:text-ink'
            }`}
          >
            Activos
          </button>
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              showArchived ? 'bg-panel text-ink shadow-[0_1px_2px_rgba(28,28,30,0.12)]' : 'text-muted hover:text-ink'
            }`}
          >
            Eliminados
          </button>
        </div>
        {!showArchived && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLiquidation(true)}
            title="Sueldo menos vales de la semana"
          >
            Liquidación
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {loading && (
          <p className="py-16 text-center text-sm text-muted">Cargando empleados…</p>
        )}
        {error && !loading && (
          <div className="rounded-xl border border-danger/40 bg-danger/10 p-4">
            <p className="text-sm text-danger">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 text-xs text-muted hover:text-ink"
            >
              Reintentar
            </button>
          </div>
        )}
        {!loading && !error && (
          <div className="space-y-5">
            <StaffSection
              title="Cajeras"
              hint="Acceso a la app · cobran de la caja el fin de semana"
              empty={
                showArchived
                  ? 'No hay cajeras inactivas.'
                  : 'No hay cajeras. Agregá una con “+ Nuevo”.'
              }
              members={visibleCashiers}
              onSelect={m => setSelectedKey(m.key)}
            />
            <StaffSection
              title="Carniceros"
              hint="Sueldo y vales. Acceso al celu desde la ficha."
              empty={
                showArchived
                  ? 'No hay carniceros eliminados.'
                  : 'No hay carniceros. Agregá uno con “+ Nuevo”.'
              }
              members={visibleButchers}
              onSelect={m => setSelectedKey(m.key)}
            />
          </div>
        )}
      </div>

      {selected && (
        <EmployeeDetailModal
          key={selected.key}
          member={selected}
          stores={stores}
          cashierStores={cashiers.find(c => c.uid === selected.cashierUid)?.authorizedStores ?? []}
          onClose={() => setSelectedKey(null)}
          onChanged={async () => {
            await load()
          }}
        />
      )}

      {showCreate && (
        <CreateEmployeeModal
          stores={stores}
          employees={employees}
          onClose={() => setShowCreate(false)}
          onSaved={async () => {
            setShowCreate(false)
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

function StaffSection({
  title,
  hint,
  empty,
  members,
  onSelect,
}: {
  title: string
  hint: string
  empty: string
  members: StaffMember[]
  onSelect: (m: StaffMember) => void
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-[11px] text-muted">{hint}</p>
      {members.length === 0 ? (
        <p className="mt-4 text-sm text-subtle">{empty}</p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          {members.map(m => (
            <EmployeeCard key={m.key} member={m} onClick={() => onSelect(m)} />
          ))}
        </div>
      )}
    </section>
  )
}

function EmployeeCard({ member, onClick }: { member: StaffMember; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-[15.5rem] shrink-0 rounded-xl border px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(28,28,30,0.08)] transition-colors hover:border-line-strong focus:outline-none focus:ring-2 focus:ring-accent/30 ${
        member.active
          ? 'border-line-strong bg-raised hover:bg-hover'
          : 'border-line bg-panel opacity-80'
      }`}
    >
      <p className="line-clamp-2 break-words text-sm font-medium text-ink" title={member.name}>
        {member.name}
      </p>
      <p className="mt-1 text-xs tabular-nums text-muted">
        {formatARS(member.weeklyWage)} / sem.
      </p>
      {member.email && (
        <p className="mt-0.5 truncate text-[11px] text-muted" title={member.email}>
          {member.email}
        </p>
      )}
      {member.kind === 'butcher' && member.firebaseUid && (
        <p className="mt-1 text-[10px] text-success">Acceso celular</p>
      )}
      {!member.active && (
        <p className="mt-1 text-[10px] uppercase tracking-wide text-subtle">
          {member.kind === 'cashier' ? 'Inactiva' : 'Eliminado'}
        </p>
      )}
    </button>
  )
}

function EmployeeDetailModal({
  member,
  stores,
  cashierStores,
  onClose,
  onChanged,
}: {
  member: StaffMember
  stores: StoreRow[]
  cashierStores: string[]
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [vales, setVales] = useState<EmployeeValeRow[]>([])
  const [loadingVales, setLoadingVales] = useState(Boolean(member.employeeId))
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(member.name)
  const [editWage, setEditWage] = useState(formatNumericInputValue(String(member.weeklyWage)))
  const [editHome, setEditHome] = useState(member.homeStoreId ?? '')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'toggle' | 'delete' | 'archive' | 'restore' | null>(null)
  const [accessPanel, setAccessPanel] = useState<'grant' | 'revoke' | null>(null)
  const [grantingAccess, setGrantingAccess] = useState(false)

  useEffect(() => {
    if (!member.employeeId) {
      setVales([])
      setLoadingVales(false)
      return
    }
    setLoadingVales(true)
    void window.hw.listVales({ employeeId: member.employeeId }).then(r => {
      setLoadingVales(false)
      if (r.ok) setVales(r.data.filter(v => !v.cancelledAt))
    })
  }, [member.employeeId])

  async function saveEdit() {
    const name = editName.trim()
    if (!name) {
      setFormError('El nombre es obligatorio.')
      return
    }
    const weeklyWage = parseNumericInput(editWage)
    if (weeklyWage === null || weeklyWage < 0) {
      setFormError('Ingresá un sueldo semanal válido (0 o más).')
      return
    }
    setSaving(true)
    setFormError(null)
    if (member.cashierUid) {
      const authorizedStores = cashierStores.length > 0
        ? cashierStores
        : stores.filter(s => !s.archivedAt).map(s => s.id)
      if (authorizedStores.length === 0) {
        setSaving(false)
        setFormError('No hay locales activos para actualizar la cajera.')
        return
      }
      const r = await window.hw.updateCashier({
        uid: member.cashierUid,
        displayName: name,
        authorizedStores,
      })
      if (!r.ok) {
        setSaving(false)
        setFormError(r.error ?? 'No se pudo actualizar la cuenta.')
        return
      }
    }
    if (member.employeeId) {
      const r = await window.hw.updateEmployee({
        id: member.employeeId,
        name,
        weeklyWage,
        homeStoreId: editHome || null,
      })
      if (!r.ok) {
        setSaving(false)
        setFormError(r.error ?? 'No se pudo actualizar el sueldo.')
        return
      }
    } else {
      const r = await window.hw.createEmployee({
        name,
        weeklyWage,
        kind: 'cashier',
        homeStoreId: editHome || null,
      })
      if (!r.ok) {
        setSaving(false)
        setFormError(r.error ?? 'No se pudo crear la ficha de sueldo.')
        return
      }
    }
    setSaving(false)
    await onChanged()
  }

  async function runConfirm() {
    setBusy(true)
    setFormError(null)
    if (confirm === 'toggle' && member.cashierUid) {
      const r = await window.hw.toggleCashier({ uid: member.cashierUid, active: !member.active })
      if (!r.ok) {
        setBusy(false)
        setFormError(r.error ?? 'No se pudo cambiar el estado.')
        setConfirm(null)
        return
      }
    }
    if (confirm === 'delete' && member.cashierUid) {
      const r = await window.hw.deleteCashier({ uid: member.cashierUid })
      if (!r.ok) {
        setBusy(false)
        setFormError(r.error ?? 'No se pudo eliminar.')
        setConfirm(null)
        return
      }
      if (member.employeeId) await window.hw.archiveEmployee({ id: member.employeeId })
    }
    if (confirm === 'archive' && member.employeeId) {
      const r = await window.hw.archiveEmployee({ id: member.employeeId })
      if (!r.ok) {
        setBusy(false)
        setFormError(r.error ?? 'No se pudo eliminar.')
        setConfirm(null)
        return
      }
    }
    if (confirm === 'restore' && member.employeeId) {
      const r = await window.hw.unarchiveEmployee({ id: member.employeeId })
      if (!r.ok) {
        setBusy(false)
        setFormError(r.error ?? 'No se pudo restaurar.')
        setConfirm(null)
        return
      }
    }
    setBusy(false)
    setConfirm(null)
    await onChanged()
  }

  const valeTotal = vales.reduce((s, v) => s + v.amount, 0)
  const roleLabel = member.kind === 'cashier' ? 'Cajera' : 'Carnicero'

  return (
    <>
    <Modal
      open
      onClose={onClose}
      header={
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold tracking-tight text-ink" title={member.name}>{member.name}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {roleLabel}
              {member.kind === 'cashier'
                ? ' · acceso a la app'
                : member.firebaseUid
                  ? ' · sueldo, vales y acceso celular'
                  : ' · sueldo y vales'}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar">Cerrar</Button>
        </div>
      }
    >
          {member.email && (
            <p className="truncate text-sm text-muted" title={member.email}>
              {member.email}
            </p>
          )}

          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-ink">Nombre</label>
                <input
                  type="text"
                  value={editName}
                  maxLength={100}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-ink">Sueldo semanal ($)</label>
                <NumericInput
                  value={editWage}
                  onChange={setEditWage}
                  className="w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-ink">Local habitual</label>
                <select
                  value={editHome}
                  onChange={e => setEditHome(e.target.value)}
                  className="w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-accent/30"
                >
                  <option value="">Ambos / sin asignar</option>
                  {stores.filter(s => !s.archivedAt).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false)
                    setEditName(member.name)
                    setEditWage(formatNumericInputValue(String(member.weeklyWage)))
                    setEditHome(member.homeStoreId ?? '')
                    setFormError(null)
                  }}
                  className="flex-1 rounded-lg px-4 py-2 text-sm text-ink hover:bg-hover"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveEdit()}
                  className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium hover:bg-accent disabled:bg-raised"
                >
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-line bg-app px-4 py-3">
              <p className="text-sm text-muted">
                Sueldo:{' '}
                <span className="font-semibold tabular-nums text-ink">
                  {formatARS(member.weeklyWage)} / sem.
                </span>
              </p>
              <p className="mt-1 text-sm text-muted">
                Local habitual:{' '}
                <span className="text-ink">
                  {member.homeStoreId
                    ? (stores.find(s => s.id === member.homeStoreId)?.name ?? 'Local')
                    : 'Ambos'}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-2 text-sm text-muted underline"
              >
                Editar datos
              </button>
            </div>
          )}

          {member.employeeId && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-wide text-muted">Vales ({vales.length})</p>
                {vales.length > 0 && (
                  <span className="font-mono text-sm text-ink">{formatARS(valeTotal)}</span>
                )}
              </div>
              {loadingVales ? (
                <p className="text-sm text-subtle">Cargando vales…</p>
              ) : vales.length === 0 ? (
                <p className="text-sm text-subtle">Sin vales registrados.</p>
              ) : (
                <ul className="max-h-40 space-y-1.5 overflow-y-auto">
                  {vales.slice(0, 30).map(v => (
                    <li key={v.id} className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="shrink-0 text-xs text-muted">{toLocalDate(v.paidAt)}</span>
                      <span
                        className="min-w-0 flex-1 truncate text-muted"
                        title={v.description ?? 'Adelanto'}
                      >
                        {v.description ?? 'Adelanto'}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-ink">
                        {formatARS(v.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {formError && <p className="text-sm text-danger">{formError}</p>}

          {confirm ? (
            <div className="rounded-lg border border-line bg-app p-3">
              <p className="text-sm text-ink">
                {confirm === 'toggle' && (member.active
                  ? `¿Desactivar a ${member.name}? No podrá entrar a la app.`
                  : `¿Reactivar a ${member.name}?`)}
                {confirm === 'delete' && `¿Estás seguro que querés eliminar a ${member.name}?`}
                {confirm === 'archive' && `¿Estás seguro que querés eliminar a ${member.name}?`}
                {confirm === 'restore' && `¿Restaurar a ${member.name}?`}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                  className="flex-1 rounded-xl border border-line py-2 text-sm text-ink hover:bg-hover"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runConfirm()}
                  className={`flex-1 rounded-xl py-2 text-sm font-semibold ${
                    confirm === 'restore' || (confirm === 'toggle' && !member.active)
                      ? 'bg-accent text-ink hover:bg-accent'
                      : 'border border-danger/40 bg-danger/15 text-danger hover:bg-danger/25'
                  }`}
                >
                  {busy ? '…' : confirm === 'restore' ? 'Restaurar' : confirm === 'toggle'
                    ? (member.active ? 'Desactivar' : 'Reactivar')
                    : 'Eliminar'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {member.kind === 'butcher' && member.employeeId && member.active && !member.firebaseUid && (
                <button
                  type="button"
                  disabled={grantingAccess}
                  onClick={() => {
                    const employeeId = member.employeeId
                    if (!employeeId) return
                    setGrantingAccess(true)
                    setFormError(null)
                    void window.hw.grantButcherAccess({ employeeId }).then(async r => {
                      setGrantingAccess(false)
                      if (r.ok) {
                        await onChanged()
                        return
                      }
                      if (r.code === 'EMAIL_REQUIRED') {
                        setAccessPanel('grant')
                        return
                      }
                      setFormError(r.error ?? 'No se pudo otorgar el acceso.')
                    })
                  }}
                  className="w-full rounded-lg border border-line-accent bg-accent-soft px-4 py-2 text-sm text-success hover:bg-hover disabled:opacity-50"
                >
                  {grantingAccess ? 'Restableciendo…' : 'Dar acceso al celular'}
                </button>
              )}
              {member.kind === 'butcher' && member.employeeId && member.firebaseUid && (
                <button
                  type="button"
                  onClick={() => setAccessPanel('revoke')}
                  className="w-full rounded-lg border border-amber-900/40 px-4 py-2 text-sm text-amber-400/80 hover:bg-amber-950/40"
                >
                  Revocar acceso
                </button>
              )}
              {member.cashierUid && (
                <button
                  type="button"
                  onClick={() => setConfirm('toggle')}
                  className="w-full rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-hover"
                >
                  {member.active ? 'Desactivar' : 'Reactivar'}
                </button>
              )}
              {member.cashierUid && member.active && (
                <button
                  type="button"
                  onClick={() => setConfirm('delete')}
                  className="w-full rounded-lg border border-danger/30 px-4 py-2 text-sm text-danger hover:bg-danger/10"
                >
                  Eliminar
                </button>
              )}
              {!member.cashierUid && member.employeeId && member.active && (
                <button
                  type="button"
                  onClick={() => setConfirm('archive')}
                  className="w-full rounded-lg border border-danger/30 px-4 py-2 text-sm text-danger hover:bg-danger/10"
                >
                  Eliminar
                </button>
              )}
              {!member.cashierUid && member.employeeId && !member.active && (
                <button
                  type="button"
                  onClick={() => setConfirm('restore')}
                  className="w-full rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-hover"
                >
                  Restaurar
                </button>
              )}
            </div>
          )}
    </Modal>
      {accessPanel === 'grant' && member.employeeId && (
        <GrantButcherAccessModal
          employeeName={member.name}
          onCancel={() => setAccessPanel(null)}
          onGrant={async email => {
            const employeeId = member.employeeId
            if (!employeeId) return 'Falta la ficha del empleado.'
            const r = await window.hw.grantButcherAccess({ employeeId, email })
            if (!r.ok) return r.error ?? 'No se pudo otorgar el acceso.'
            setAccessPanel(null)
            await onChanged()
            return null
          }}
        />
      )}
      {accessPanel === 'revoke' && member.employeeId && (
        <RevokeButcherAccessModal
          employeeName={member.name}
          onCancel={() => setAccessPanel(null)}
          onConfirm={async () => {
            const employeeId = member.employeeId
            if (!employeeId) return
            const r = await window.hw.revokeButcherAccess({ employeeId })
            if (!r.ok) {
              setFormError(r.error ?? 'No se pudo revocar el acceso.')
              setAccessPanel(null)
              return
            }
            setAccessPanel(null)
            await onChanged()
          }}
        />
      )}
    </>
  )
}

function CreateEmployeeModal({
  stores,
  employees,
  onClose,
  onSaved,
}: {
  stores: StoreRow[]
  employees: EmployeeRow[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [kind, setKind] = useState<StaffKind | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [wage, setWage] = useState('')
  const [homeStoreId, setHomeStoreId] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [createdEmail, setCreatedEmail] = useState<string | null>(null)

  const storeIds = stores.filter(s => !s.archivedAt).map(s => s.id)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!kind) return
    const trimmed = name.trim()
    if (!trimmed) {
      setFormError('El nombre es obligatorio.')
      return
    }
    if (kind === 'cashier' && trimmed.length < 2) {
      setFormError('El nombre debe tener al menos 2 caracteres.')
      return
    }
    const weeklyWage = parseNumericInput(wage)
    if (weeklyWage === null || weeklyWage < 0) {
      setFormError('Ingresá un sueldo semanal válido (0 o más).')
      return
    }
    setSaving(true)
    setFormError(null)

    if (kind === 'cashier') {
      const mail = email.trim().toLowerCase()
      if (!mail || !mail.includes('@')) {
        setSaving(false)
        setFormError('El email es obligatorio.')
        return
      }
      if (storeIds.length === 0) {
        setSaving(false)
        setFormError('No hay locales activos. Creá un local antes de dar de alta una cajera.')
        return
      }
      const r = await window.hw.createCashier({
        displayName: trimmed,
        email: mail,
        authorizedStores: storeIds,
      })
      if (!r.ok) {
        setSaving(false)
        setFormError(r.error ?? 'No se pudo crear la cajera.')
        return
      }
      const existing = employees.find(
        emp => emp.kind === 'cashier' && emp.name.trim().toLowerCase() === trimmed.toLowerCase(),
      )
      if (existing) {
        await window.hw.updateEmployee({
          id: existing.id,
          weeklyWage,
          homeStoreId: homeStoreId || null,
        })
      } else {
        await window.hw.createEmployee({
          name: trimmed,
          weeklyWage,
          kind: 'cashier',
          homeStoreId: homeStoreId || null,
        })
      }
      setSaving(false)
      setCreatedEmail(mail)
      return
    }

    const r = await window.hw.createEmployee({
      name: trimmed,
      weeklyWage,
      kind: 'butcher',
      homeStoreId: homeStoreId || null,
    })
    setSaving(false)
    if (!r.ok) {
      setFormError(r.error ?? 'No se pudo crear el empleado.')
      return
    }
    await onSaved()
  }

  if (createdEmail) {
    return (
      <Modal
        open
        onClose={() => { void onSaved() }}
        title="Cajera creada"
        footer={<Button className="mr-auto" onClick={() => void onSaved()}>Cerrar</Button>}
      >
        <p className="text-sm text-muted">
          Se envió un email a <strong className="text-ink">{createdEmail}</strong> para que configure su contraseña.
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={saving ? () => {} : onClose}
      closeOnOverlay={!saving}
      title="Nuevo empleado"
    >
        {!kind ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">¿Qué tipo de empleado querés agregar?</p>
            <button
              type="button"
              onClick={() => setKind('cashier')}
              className="w-full rounded-xl border border-line bg-raised px-4 py-3 text-left hover:bg-hover"
            >
              <p className="text-sm font-medium">Cajera</p>
              <p className="mt-0.5 text-xs text-muted">Acceso a la app · sueldo y vales</p>
            </button>
            <button
              type="button"
              onClick={() => setKind('butcher')}
              className="w-full rounded-xl border border-line bg-raised px-4 py-3 text-left hover:bg-hover"
            >
              <p className="text-sm font-medium">Carnicero</p>
              <p className="mt-0.5 text-xs text-muted">Sueldo y vales. El acceso al celu se da después, desde la ficha.</p>
            </button>
            <Button fullWidth variant="secondary" onClick={onClose}>Cancelar</Button>
          </div>
        ) : (
          <form onSubmit={e => void handleSubmit(e)} className="space-y-4">
            <p className="text-xs text-muted">
              {kind === 'cashier'
                ? 'Recibirá un email para definir su contraseña. Puede operar en todos los locales activos.'
                : 'Queda registrado para asistencia, sueldo y vales. El acceso al celu se da desde la ficha.'}
            </p>
            <div>
              <label className="mb-1 block text-sm text-ink">Nombre</label>
              <input
                type="text"
                value={name}
                maxLength={100}
                onChange={e => setName(e.target.value)}
                autoFocus
                className="w-full rounded-lg border border-line bg-input px-3 py-2.5 text-ink focus:border-line-accent focus:outline-none"
                placeholder="Nombre del empleado"
              />
            </div>
            {kind === 'cashier' && (
              <div>
                <label className="mb-1 block text-sm text-ink">Email</label>
                <input
                  type="email"
                  value={email}
                  maxLength={120}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-line bg-input px-3 py-2.5 text-ink focus:border-line-accent focus:outline-none"
                  placeholder="cajera@ejemplo.com"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm text-ink">Sueldo semanal ($)</label>
              <NumericInput
                value={wage}
                onChange={setWage}
                className="w-full rounded-lg border border-line bg-input px-3 py-2.5 text-ink focus:border-line-accent focus:outline-none"
                placeholder="0"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink">Local habitual</label>
              <select
                value={homeStoreId}
                onChange={e => setHomeStoreId(e.target.value)}
                className="w-full rounded-lg border border-line bg-input px-3 py-2.5 text-ink focus:border-line-accent focus:outline-none"
              >
                <option value="">Ambos / sin asignar</option>
                {stores.filter(s => !s.archivedAt).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted">
                Si no asignás, aparece en asistencia y vales de todos los locales.
              </p>
            </div>
            {formError && <p className="text-sm text-danger">{formError}</p>}
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                disabled={saving}
                onClick={() => { setKind(null); setFormError(null) }}
              >
                Atrás
              </Button>
              <Button type="submit" className="flex-1" loading={saving}>
                {kind === 'cashier' ? 'Crear y enviar email' : 'Crear'}
              </Button>
            </div>
          </form>
        )}
    </Modal>
  )
}
