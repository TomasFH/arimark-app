/**
 * Pantalla de apertura de turno en el celular.
 * Espejo del OpenShiftScreen del desktop: grilla precargada con lo dejado.
 */
import { useEffect, useState } from 'react'
import { useBackLayer } from '../lib/backStack'
import NumericInput from './NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import type { ShiftType } from '../types/pos'
import { ChangePasswordModal } from './ChangePasswordModal'
import { isEmptyBillCount } from '@carniceria/shared'
import { fetchCashHandover, type CashHandoverSnapshot } from '../lib/cashHandover'
import {
  BillCountGrid,
  billRowsCountedTotal,
  billRowsFromLines,
  billRowsToLines,
  emptyBillRows,
  type BillMode,
  type BillRowState,
} from './BillCountGrid'

const isDevEnv = import.meta.env.DEV

interface OpenShiftExtras {
  openingBills?: ReturnType<typeof billRowsToLines>
  confirmEmptyRegister?: boolean
  handover?: CashHandoverSnapshot | null
}

interface Props {
  displayName: string
  storeName: string
  storeId: string
  onOpen: (shiftType: ShiftType, openingCash: number, extras?: OpenShiftExtras) => void
  onLogout: () => void
  logoutLabel?: string
  onBack?: () => void
}

export function OpenShiftScreen({
  displayName,
  storeName,
  storeId,
  onOpen,
  onLogout,
  logoutLabel = 'Salir',
  onBack,
}: Props) {
  useBackLayer(Boolean(onBack), onBack ?? (() => {}))
  const [shiftType, setShiftType] = useState<ShiftType>('morning')
  const [cashInput, setCashInput] = useState('')
  const [error, setError] = useState('')
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [billMode, setBillMode] = useState<BillMode>('quantity')
  const [billRows, setBillRows] = useState<BillRowState[]>(emptyBillRows)
  const [handover, setHandover] = useState<CashHandoverSnapshot | null>(null)
  const [skipBills, setSkipBills] = useState(false)
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)

  useEffect(() => {
    void fetchCashHandover(storeId).then(next => {
      if (!next) return
      setHandover(next)
      const rows = billRowsFromLines(next.bills)
      setBillRows(rows)
    }).catch(() => { /* offline / sin doc */ })
  }, [storeId])

  function updateBillRow(denomination: number, field: 'quantity' | 'total', value: string) {
    setSkipBills(false)
    setBillRows(prev => {
      const next = prev.map(r => {
        if (r.denomination !== denomination) return r
        const updated = { ...r, [field]: value }
        if (field === 'total' && value !== '' && value !== '0') {
          const parsed = parseNumericInput(value)
          if (parsed !== null && parsed > 0 && parsed % denomination !== 0) {
            updated.totalError = `Debe ser múltiplo de $${denomination.toLocaleString('es-AR')}`
          } else {
            updated.totalError = null
          }
        } else {
          updated.totalError = null
        }
        return updated
      })
      return next
    })
  }

  function doOpen(confirmEmpty: boolean) {
    const cash = parseNumericInput(cashInput)
    if (cash === null || cash < 0) {
      setError('Ingresá el efectivo inicial.')
      return
    }
    const lines = skipBills ? undefined : billRowsToLines(billRows, billMode)
    onOpen(shiftType, cash, {
      openingBills: lines,
      confirmEmptyRegister: confirmEmpty || undefined,
      handover,
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const lines = skipBills ? [] : billRowsToLines(billRows, billMode)
    if (!isDevEnv && !skipBills && isEmptyBillCount(lines)) {
      setShowEmptyConfirm(true)
      return
    }
    doOpen(!skipBills && isEmptyBillCount(lines))
  }

  const countedTotal = billRowsCountedTotal(billRows, billMode)
  const expectedTotal = handover
    ? handover.bills.reduce((s, l) => s + l.denomination * l.quantity, 0)
    : undefined

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white" title={displayName}>{displayName}</p>
          <p className="truncate text-xs text-gray-400" title={storeName}>{storeName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setShowChangePassword(true)}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            Contraseña
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            {logoutLabel}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto w-full max-w-sm space-y-5">
          <div className="text-center">
            <h2 className="text-xl font-bold text-white">Abrir turno</h2>
            <p className="mt-1 text-sm text-gray-400">
              {handover
                ? `Precargado con lo que dejó ${handover.fromCashierName}`
                : 'Contá el efectivo de la registradora'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm text-gray-300">Tipo de turno</label>
              <div className="grid grid-cols-2 gap-3">
                {(['morning', 'evening'] as ShiftType[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setShiftType(t)}
                    className={`rounded-xl py-3 text-sm font-semibold transition-colors ${
                      shiftType === t
                        ? 'bg-green-700 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {t === 'morning' ? '☀️ Mañana' : '🌙 Tarde'}
                  </button>
                ))}
              </div>
            </div>

            <BillCountGrid
              rows={billRows}
              mode={billMode}
              onModeChange={setBillMode}
              onUpdate={updateBillRow}
              countedTotal={countedTotal}
              expectedTotal={expectedTotal}
              showExpectedDiff={Boolean(handover)}
              title="Lo que encontré en la registradora"
              subtitle={handover ? `Dejó ${handover.fromCashierName}` : 'Sin cierre anterior'}
            />

            {isDevEnv && (
              <button
                type="button"
                onClick={() => setSkipBills(true)}
                className="w-full text-xs text-gray-500 underline"
              >
                Omitir conteo (modo pruebas)
              </button>
            )}

            <div>
              <label className="mb-1 block text-sm text-gray-300">Efectivo inicial ($)</label>
              <NumericInput
                value={cashInput}
                onChange={v => {
                  setCashInput(v)
                  setError('')
                }}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-center text-xl text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="0"
              />
              <p className="mt-1 text-center text-[11px] text-gray-500">
                Lo que arranca el turno, no el conteo de la registradora.
              </p>
              {error && <p className="mt-1 text-center text-xs text-red-400">{error}</p>}
            </div>

            <button
              type="submit"
              className="w-full rounded-xl bg-green-700 px-4 py-4 text-lg font-bold text-white transition-colors hover:bg-green-600"
            >
              Abrir turno
            </button>
          </form>
        </div>
      </div>
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
      {showEmptyConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-gray-900 p-5">
            <h2 className="text-lg font-bold text-white">¿Caja vacía?</h2>
            <p className="text-sm text-gray-400">¿Confirmás que no queda ningún billete en caja?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShowEmptyConfirm(false)}
                className="rounded-xl bg-gray-800 py-3 font-semibold text-white"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEmptyConfirm(false)
                  doOpen(true)
                }}
                className="rounded-xl bg-green-700 py-3 font-bold text-white"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
