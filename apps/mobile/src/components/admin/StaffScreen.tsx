/**
 * Empleados: cajeras y carniceros en una sola página, dos sectores.
 * Las acciones viven en el modal de la tarjeta; un solo alta elige el tipo.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
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
import { PayrollScreen } from './PayrollScreen'
import { GrantButcherAccessModal, RevokeButcherAccessModal } from './ButcherAccessModals'
import {
  fetchAppUsers,
  fetchEmployees,
  fetchEmployeeValesForEmployee,
  createEmployee,
  updateEmployee,
  archiveEmployee,
  unarchiveEmployee,
  updateUserActive,
  updateUserDisplayName,
  formatMoney,
  formatDate,
  type AdminUser,
  type Employee,
  type EmployeeVale,
  type StoreDoc,
} from '../../lib/adminFirestore'
import { parseNumericInput, formatNumericInputValue } from '../../lib/numericInput'
import { buildStaffRoster, type StaffKind, type StaffMember } from '../../lib/staffRoster'
import { createTenantAuthUser, grantButcherAccess, revokeButcherAccess } from '../../lib/tenantAuth'
import {
  OFFLINE_ACCOUNT_MESSAGE,
  resolveButcherAccess,
  validateCashierAlta,
} from '../../lib/tenantAuthLogic'
import type { LocalProfile } from '../../types/pos'

interface Props {
  onBack: () => void
  profile: LocalProfile
  stores: StoreDoc[]
}

export function StaffScreen({ onBack, profile, stores }: Props) {
  useBackLayer(true, onBack)
  const online = useOnlineStatus()
  const [cashiers, setCashiers] = useState<AdminUser[]>([])
  const [butcherUsers, setButcherUsers] = useState<AdminUser[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [selected, setSelected] = useState<StaffMember | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showPayroll, setShowPayroll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [userList, empListRaw] = await Promise.all([
        fetchAppUsers(),
        fetchEmployees(),
      ])
      const cashierList = userList.filter(u => u.role === 'cashier')
      const butcherUsers = userList.filter(u => u.role === 'butcher')
      let empList = empListRaw
      let mutated = false
      for (const cashier of cashierList) {
        const name = cashier.displayName.trim()
        if (!name) continue
        const existing = empList.find(
          e => e.kind === 'cashier' && e.name.trim().toLowerCase() === name.toLowerCase(),
        )
        if (!existing) {
          if (!cashier.active) continue
          try {
            await createEmployee({ name, weeklyWage: 0, createdBy: profile.uid, kind: 'cashier' })
            mutated = true
          } catch {
            /* nombre en conflicto u offline */
          }
          continue
        }
        if (cashier.active && existing.archivedAt) {
          try {
            await unarchiveEmployee(existing.id)
            mutated = true
          } catch {
            /* offline */
          }
        }
      }
      setCashiers(cashierList)
      setButcherUsers(butcherUsers)
      setEmployees(mutated ? await fetchEmployees() : empList)
    } catch {
      setError('No se pudieron cargar los empleados.')
    } finally {
      setLoading(false)
    }
  }, [profile.uid])

  useEffect(() => {
    void load()
  }, [load])

  const roster = useMemo(
    () => {
      const butcherRefs = butcherUsers.map(u => ({
        uid: u.uid,
        email: u.email || null,
        role: u.role,
        employeeId: u.employeeId,
        active: u.active,
      }))
      return buildStaffRoster(
        cashiers,
        employees.map(e => {
          const access = e.kind === 'butcher'
            ? resolveButcherAccess({ id: e.id, firebaseUid: e.firebaseUid }, butcherRefs)
            : { firebaseUid: null as string | null, email: null as string | null }
          return {
            id: e.id,
            name: e.name,
            weeklyWage: e.weeklyWage,
            active: !e.archivedAt,
            kind: e.kind,
            homeStoreId: e.homeStoreId,
            firebaseUid: access.firebaseUid,
            email: access.email,
          }
        }),
      )
    },
    [cashiers, employees, butcherUsers],
  )

  const visibleCashiers = roster.cashiers.filter(m => (showArchived ? !m.active : m.active))
  const visibleButchers = roster.butchers.filter(m => (showArchived ? !m.active : m.active))

  if (showPayroll) {
    return <PayrollScreen onBack={() => setShowPayroll(false)} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <ScreenHeader
        title="Empleados"
        subtitle="Cajeras y carniceros"
        onBack={onBack}
        action={
          <div className="flex shrink-0 items-center gap-2">
            {!showArchived && (
              <button
                type="button"
                onClick={() => setShowPayroll(true)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
                title="Sueldo menos vales de la semana"
              >
                Liquidación
              </button>
            )}
            {!showArchived && (
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
        }
      />

      {!online && <OfflineBanner />}

      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
        <button
          type="button"
          onClick={() => setShowArchived(false)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            !showArchived ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Activos
        </button>
        <button
          type="button"
          onClick={() => setShowArchived(true)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            showArchived ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Eliminados
        </button>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}
        {loading && <Spinner />}
        {!loading && !error && (
          <div className="space-y-4">
            <StaffSection
              title="Cajeras"
              hint="Acceso a la app · cobran de la caja el fin de semana"
              empty={showArchived ? 'No hay cajeras inactivas.' : 'No hay cajeras.'}
              members={visibleCashiers}
              stores={stores}
              onSelect={setSelected}
            />
            <StaffSection
              title="Carniceros"
              hint="Sueldo y vales · el acceso al celu se da desde la ficha"
              empty={showArchived ? 'No hay carniceros eliminados.' : 'No hay carniceros.'}
              members={visibleButchers}
              stores={stores}
              onSelect={setSelected}
            />
          </div>
        )}
      </main>

      {selected && (
        <EmployeeDetailModal
          member={selected}
          createdBy={profile.uid}
          stores={stores}
          online={online}
          onClose={() => setSelected(null)}
          onChanged={async () => {
            await load()
            setSelected(null)
          }}
        />
      )}

      {showCreate && (
        <CreateEmployeeModal
          createdBy={profile.uid}
          stores={stores}
          employees={employees}
          online={online}
          onClose={() => setShowCreate(false)}
          onCreate={async () => {
            setShowCreate(false)
            await load()
          }}
        />
      )}
    </div>
  )
}

function StaffSection({
  title,
  hint,
  empty,
  members,
  stores,
  onSelect,
}: {
  title: string
  hint: string
  empty: string
  members: StaffMember[]
  stores: StoreDoc[]
  onSelect: (m: StaffMember) => void
}) {
  return (
    <section className="rounded-2xl border border-zinc-700/80 bg-zinc-800 p-4">
      <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
      <p className="mt-0.5 text-[11px] text-zinc-500">{hint}</p>
      {members.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">{empty}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {members.map(m => {
            const homeLabel = m.homeStoreId
              ? (stores.find(s => s.id === m.homeStoreId)?.name ?? 'Local')
              : null
            return (
            <button
              key={m.key}
              type="button"
              onClick={() => onSelect(m)}
              className={`w-full rounded-xl border px-3.5 py-3 text-left shadow-sm shadow-black/30 transition-colors hover:border-zinc-500 ${
                m.active
                  ? 'border-zinc-600 bg-zinc-700 hover:bg-zinc-600/80'
                  : 'border-zinc-700 bg-zinc-800/80 opacity-80'
              }`}
            >
              <p className="line-clamp-2 break-words text-sm font-medium text-zinc-100" title={m.name}>
                {m.name}
              </p>
              <p className="mt-1 text-xs tabular-nums text-zinc-400">
                {formatMoney(m.weeklyWage)}/semana
              </p>
              {homeLabel && (
                <p className="mt-0.5 truncate text-[11px] text-zinc-500" title={homeLabel}>
                  Habitual: {homeLabel}
                </p>
              )}
              {m.email && (
                <p className="mt-0.5 truncate text-[11px] text-zinc-500" title={m.email}>
                  {m.email}
                </p>
              )}
              {m.kind === 'butcher' && m.firebaseUid && (
                <p className="mt-1 text-[10px] text-emerald-500/80">Acceso celular</p>
              )}
              {!m.active && (
                <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-600">
                  {m.kind === 'cashier' ? 'Inactiva' : 'Eliminado'}
                </p>
              )}
            </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function EmployeeDetailModal({
  member,
  createdBy,
  stores,
  online,
  onClose,
  onChanged,
}: {
  member: StaffMember
  createdBy: string
  stores: StoreDoc[]
  online: boolean
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [vales, setVales] = useState<EmployeeVale[]>([])
  const [loadingVales, setLoadingVales] = useState(Boolean(member.employeeId))
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(member.name)
  const [editWage, setEditWage] = useState(formatNumericInputValue(String(member.weeklyWage)))
  const [editHome, setEditHome] = useState(member.homeStoreId ?? '')
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<'toggle' | 'archive' | 'restore' | null>(null)
  const [accessPanel, setAccessPanel] = useState<'grant' | 'revoke' | null>(null)
  const [grantingAccess, setGrantingAccess] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const loadVales = useCallback(async () => {
    if (!member.employeeId) {
      setVales([])
      setLoadingVales(false)
      return
    }
    setLoadingVales(true)
    try {
      const list = await fetchEmployeeValesForEmployee(member.employeeId)
      setVales(list)
    } finally {
      setLoadingVales(false)
    }
  }, [member.employeeId])

  useEffect(() => {
    void loadVales()
  }, [loadVales])

  async function handleSaveEdit() {
    if (!editName.trim()) return
    setSaving(true)
    const weeklyWage = parseNumericInput(editWage) ?? 0
    const name = editName.trim()
    if (member.cashierUid) {
      await updateUserDisplayName(member.cashierUid, name)
    }
    if (member.employeeId) {
      await updateEmployee(member.employeeId, {
        name,
        weeklyWage,
        homeStoreId: editHome || null,
      })
    } else {
      await createEmployee({
        name,
        weeklyWage,
        createdBy,
        kind: 'cashier',
        homeStoreId: editHome || null,
      })
    }
    setSaving(false)
    await onChanged()
  }

  async function handleConfirm() {
    if (confirm === 'toggle' && member.cashierUid) {
      await updateUserActive(member.cashierUid, !member.active)
    }
    if (confirm === 'archive' && member.employeeId) {
      await archiveEmployee(member.employeeId)
    }
    if (confirm === 'restore' && member.employeeId) {
      await unarchiveEmployee(member.employeeId)
    }
    await onChanged()
  }

  const valeTotal = vales.reduce((s, v) => s + v.amount, 0)
  const roleLabel = member.kind === 'cashier' ? 'Cajera' : 'Carnicero'

  return (
    <Modal title={member.name} onClose={onClose}>
      <div className="max-h-[80vh] space-y-4 overflow-y-auto">
        <p className="text-xs text-zinc-500">
          {roleLabel}
          {member.kind === 'cashier' ? ' · acceso a la app' : member.firebaseUid ? ' · acceso al celular' : ' · sueldo y vales'}
        </p>
        {member.email && (
          <p className="truncate text-sm text-zinc-400" title={member.email}>{member.email}</p>
        )}

        {editing ? (
          <div className="space-y-2">
            <LabeledInput label="Nombre" value={editName} onChange={setEditName} maxLength={100} />
            <LabeledNumericInput
              label="Sueldo semanal ($)"
              value={editWage}
              onChange={setEditWage}
            />
            <HomeStoreField stores={stores} value={editHome} onChange={setEditHome} />
            <div className="flex gap-2">
              <Btn className="flex-1" onClick={() => void handleSaveEdit()} loading={saving}>
                Guardar
              </Btn>
              <Btn
                variant="ghost"
                className="flex-1"
                onClick={() => {
                  setEditing(false)
                  setEditName(member.name)
                  setEditWage(formatNumericInputValue(String(member.weeklyWage)))
                  setEditHome(member.homeStoreId ?? '')
                }}
              >
                Cancelar
              </Btn>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
            <p className="text-sm text-zinc-400">
              Sueldo:{' '}
              <span className="font-mono font-semibold text-zinc-100">
                {formatMoney(member.weeklyWage)}/semana
              </span>
            </p>
            {member.homeStoreId && (
              <p className="mt-1 truncate text-sm text-zinc-400" title={stores.find(s => s.id === member.homeStoreId)?.name ?? 'Local'}>
                Habitual: {stores.find(s => s.id === member.homeStoreId)?.name ?? 'Local'}
              </p>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-2 text-sm text-zinc-500 underline"
            >
              Editar datos
            </button>
          </div>
        )}

        {member.employeeId && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Vales ({vales.length})</p>
              {vales.length > 0 && (
                <span className="font-mono text-sm text-zinc-300">{formatMoney(valeTotal)}</span>
              )}
            </div>
            {loadingVales ? (
              <Spinner />
            ) : vales.length === 0 ? (
              <EmptyState message="Sin vales registrados." />
            ) : (
              <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                {vales.slice(0, 30).map(v => (
                  <li key={v.id} className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="shrink-0 text-xs text-zinc-500">{formatDate(v.paidAt)}</span>
                    <span
                      className="min-w-0 flex-1 truncate text-zinc-400"
                      title={v.description ?? 'Adelanto'}
                    >
                      {v.description ?? 'Adelanto'}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-zinc-300">
                      {formatMoney(v.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {formError && (
          <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400/80">
            {formError}
          </p>
        )}

        {member.kind === 'butcher' && member.employeeId && member.active && !member.firebaseUid && (
          <Btn
            className="w-full"
            disabled={grantingAccess}
            onClick={() => {
              const employeeId = member.employeeId
              if (!employeeId) return
              if (!online) {
                setFormError(OFFLINE_ACCOUNT_MESSAGE)
                return
              }
              setGrantingAccess(true)
              setFormError(null)
              const authorizedStores = stores.filter(s => !s.archivedAt).map(s => s.id)
              void grantButcherAccess({
                employeeId,
                displayName: member.name,
                kind: member.kind,
                firebaseUid: member.firebaseUid,
                homeStoreId: member.homeStoreId,
                authorizedStores,
              }).then(async r => {
                setGrantingAccess(false)
                if (r.ok) {
                  await onChanged()
                  return
                }
                if (r.code === 'EMAIL_REQUIRED') {
                  setAccessPanel('grant')
                  return
                }
                setFormError(r.error)
              })
            }}
          >
            {grantingAccess ? 'Restableciendo…' : 'Dar acceso al celular'}
          </Btn>
        )}
        {member.kind === 'butcher' && member.employeeId && member.firebaseUid && (
          <Btn
            className="w-full"
            variant="danger"
            onClick={() => setAccessPanel('revoke')}
          >
            Revocar acceso
          </Btn>
        )}
        {member.cashierUid && (
          <Btn
            className="w-full"
            variant={member.active ? 'danger' : 'primary'}
            onClick={() => setConfirm('toggle')}
          >
            {member.active ? 'Desactivar' : 'Reactivar'}
          </Btn>
        )}
        {!member.cashierUid && member.employeeId && member.active && (
          <Btn variant="danger" className="w-full" onClick={() => setConfirm('archive')}>
            Eliminar
          </Btn>
        )}
        {!member.cashierUid && member.employeeId && !member.active && (
          <Btn className="w-full" onClick={() => setConfirm('restore')}>
            Restaurar
          </Btn>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          title={
            confirm === 'toggle'
              ? (member.active ? 'Desactivar' : 'Reactivar')
              : confirm === 'restore' ? 'Restaurar' : 'Eliminar'
          }
          message={
            confirm === 'toggle'
              ? (member.active
                ? `¿Desactivar a ${member.name}? No podrá entrar a la app.`
                : `¿Reactivar a ${member.name}?`)
              : confirm === 'restore'
                ? `¿Restaurar a ${member.name}?`
                : `¿Estás seguro que querés eliminar a ${member.name}?`
          }
          confirmLabel={
            confirm === 'toggle'
              ? (member.active ? 'Desactivar' : 'Reactivar')
              : confirm === 'restore' ? 'Restaurar' : 'Eliminar'
          }
          danger={confirm === 'archive' || (confirm === 'toggle' && member.active)}
          onClose={() => setConfirm(null)}
          onConfirm={handleConfirm}
        />
      )}
      {accessPanel === 'grant' && member.employeeId && (
        <GrantButcherAccessModal
          employeeName={member.name}
          onCancel={() => setAccessPanel(null)}
          onGrant={async email => {
            const employeeId = member.employeeId
            if (!employeeId) return 'Falta la ficha del empleado.'
            if (!online) return OFFLINE_ACCOUNT_MESSAGE
            const r = await grantButcherAccess({
              employeeId,
              displayName: member.name,
              kind: member.kind,
              firebaseUid: member.firebaseUid,
              homeStoreId: member.homeStoreId,
              authorizedStores: stores.filter(s => !s.archivedAt).map(s => s.id),
              email,
            })
            if (!r.ok) return r.error
            setAccessPanel(null)
            await onChanged()
            return null
          }}
        />
      )}
      {accessPanel === 'revoke' && member.employeeId && member.firebaseUid && (
        <RevokeButcherAccessModal
          employeeName={member.name}
          onCancel={() => setAccessPanel(null)}
          onConfirm={async () => {
            const employeeId = member.employeeId
            const uid = member.firebaseUid
            if (!employeeId || !uid) return 'Falta la cuenta del carnicero.'
            if (!online) return OFFLINE_ACCOUNT_MESSAGE
            const r = await revokeButcherAccess({ employeeId, firebaseUid: uid })
            if (!r.ok) return r.error
            setAccessPanel(null)
            await onChanged()
            return null
          }}
        />
      )}
    </Modal>
  )
}

function CreateEmployeeModal({
  createdBy,
  stores,
  employees,
  online,
  onClose,
  onCreate,
}: {
  createdBy: string
  stores: StoreDoc[]
  employees: Employee[]
  online: boolean
  onClose: () => void
  onCreate: () => Promise<void>
}) {
  const [kind, setKind] = useState<StaffKind | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [wageInput, setWageInput] = useState('')
  const [homeStoreId, setHomeStoreId] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [createdEmail, setCreatedEmail] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!kind) return
    const trimmed = name.trim()
    if (!trimmed) {
      setErr('El nombre es obligatorio.')
      return
    }
    const weeklyWage = parseNumericInput(wageInput)
    if (weeklyWage === null || weeklyWage < 0) {
      setErr('Ingresá un sueldo semanal válido (0 o más).')
      return
    }
    setSaving(true)
    setErr(null)

    if (kind === 'cashier') {
      const storeIds = stores.filter(s => !s.archivedAt).map(s => s.id)
      const validated = validateCashierAlta({
        name: trimmed,
        email,
        authorizedStores: storeIds,
      })
      if (!validated.ok) {
        setSaving(false)
        setErr(validated.error)
        return
      }
      if (!online) {
        setSaving(false)
        setErr(OFFLINE_ACCOUNT_MESSAGE)
        return
      }
      const authResult = await createTenantAuthUser({
        email: validated.email,
        displayName: validated.name,
        role: 'cashier',
        authorizedStores: storeIds,
      })
      if (!authResult.ok) {
        setSaving(false)
        setErr(authResult.error)
        return
      }
      try {
        const existing = employees.find(
          emp => emp.kind === 'cashier' && emp.name.trim().toLowerCase() === validated.name.toLowerCase(),
        )
        if (existing) {
          await updateEmployee(existing.id, {
            weeklyWage,
            homeStoreId: homeStoreId || null,
          })
        } else {
          await createEmployee({
            name: validated.name,
            weeklyWage,
            createdBy,
            kind: 'cashier',
            homeStoreId: homeStoreId || null,
          })
        }
      } catch (fichaErr) {
        console.error('[StaffScreen] Cuenta creada pero no se pudo guardar la ficha de sueldo', fichaErr)
      }
      setSaving(false)
      setCreatedEmail(validated.email)
      return
    }

    try {
      await createEmployee({
        name: trimmed,
        weeklyWage,
        createdBy,
        kind: 'butcher',
        homeStoreId: homeStoreId || null,
      })
      await onCreate()
    } catch {
      setErr('No se pudo crear el empleado.')
      setSaving(false)
    }
  }

  if (createdEmail) {
    return (
      <Modal title="Cajera creada" onClose={() => void onCreate()}>
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            Se envió un email a{' '}
            <span className="truncate font-medium text-white" title={createdEmail}>{createdEmail}</span>
            {' '}para que configure su contraseña.
          </p>
          <Btn className="w-full" onClick={() => void onCreate()}>Cerrar</Btn>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Nuevo empleado" onClose={onClose}>
      {!kind ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">¿Qué tipo de empleado querés agregar?</p>
          <button
            type="button"
            onClick={() => setKind('cashier')}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-left hover:border-zinc-600"
          >
            <p className="text-sm font-medium">Cajera</p>
            <p className="mt-0.5 text-xs text-zinc-500">Acceso a la app · sueldo y vales</p>
          </button>
          <button
            type="button"
            onClick={() => setKind('butcher')}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-left hover:border-zinc-600"
          >
            <p className="text-sm font-medium">Carnicero</p>
            <p className="mt-0.5 text-xs text-zinc-500">Sueldo y vales. El acceso al celu se da después, desde la ficha.</p>
          </button>
          <Btn variant="ghost" className="w-full" onClick={onClose}>Cancelar</Btn>
        </div>
      ) : (
        <form onSubmit={e => void handleSubmit(e)} className="space-y-3">
          <p className="text-xs text-zinc-500">
            {kind === 'cashier'
              ? 'Recibirá un email para definir su contraseña. Puede operar en todos los locales activos. Hace falta internet.'
              : 'Queda registrado para asistencia, sueldo y vales. El acceso al celu se da desde la ficha.'}
          </p>
          <LabeledInput
            label="Nombre *"
            value={name}
            onChange={setName}
            placeholder="Nombre del empleado"
            maxLength={100}
            required
          />
          {kind === 'cashier' && (
            <LabeledInput
              label="Email *"
              value={email}
              onChange={setEmail}
              placeholder="cajera@ejemplo.com"
              inputMode="email"
              maxLength={120}
            />
          )}
          <LabeledNumericInput
            label="Sueldo semanal ($)"
            value={wageInput}
            onChange={setWageInput}
            placeholder="0"
          />
          <HomeStoreField stores={stores} value={homeStoreId} onChange={setHomeStoreId} />
          {err && (
            <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400/80">
              {err}
            </p>
          )}
          <div className="flex gap-2">
            <Btn variant="ghost" className="flex-1" onClick={() => { setKind(null); setErr(null) }}>
              Atrás
            </Btn>
            <Btn type="submit" className="flex-1" loading={saving}>
              {kind === 'cashier' ? 'Crear y enviar email' : 'Crear'}
            </Btn>
          </div>
        </form>
      )}
    </Modal>
  )
}

function HomeStoreField({
  stores,
  value,
  onChange,
}: {
  stores: StoreDoc[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-zinc-300">Local habitual</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-white"
      >
        <option value="">Ambos / sin asignar</option>
        {stores.filter(s => !s.archivedAt).map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-zinc-500">
        Si no asignás, aparece en asistencia y vales de todos los locales.
      </p>
    </div>
  )
}
