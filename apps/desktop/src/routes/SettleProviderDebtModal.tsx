/**
 * Cajera con turno: paga deuda de un proveedor (este local u otros)
 * sin registrar una visita de mercadería. El efectivo sale de esta caja.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import NumericInput from '../components/NumericInput'
import PaymentReceipt from '../components/PaymentReceipt'
import { formatIntegerWithDots, parseNumericInput } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import { isAdminAdjustNote } from '../lib/providerLedgerNotes'
import { previewCompensatedBalances } from '../lib/providerCompensation'
import type { ProviderRow, StoreRow } from '../types/hw-api'

interface Props {
  onClose: () => void
  onSaved?: () => void
}

interface StoreBalance {
  storeId: string
  storeName: string
  balance: number
  amountRaw: string
  lastEventNotes?: string | null
}

interface SettleReceiptLine {
  storeName: string
  paid: number
  remaining: number
  creditUsed: number
}

interface SettleReceipt {
  businessName: string
  providerName: string
  date: string
  usedCredit: boolean
  cashOut: number
  lines: SettleReceiptLine[]
}

export default function SettleProviderDebtModal({ onClose, onSaved }: Props) {
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [stores, setStores] = useState<StoreRow[]>([])
  const [providerInput, setProviderInput] = useState('')
  const [selected, setSelected] = useState<ProviderRow | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [rows, setRows] = useState<StoreBalance[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [useCredit, setUseCredit] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [receipt, setReceipt] = useState<SettleReceipt | null>(null)

  useEffect(() => {
    void window.hw.listProviders().then(r => { if (r.ok) setProviders(r.data) })
    void window.hw.getStores().then(r => {
      if (r.ok) setStores(r.data.filter(s => !s.archivedAt))
    })
    void window.hw.getInitStatus().then(r => {
      if (r.ok) setBusinessName(r.data.businessName)
    })
  }, [])

  const loadBalances = useCallback(async (provider: ProviderRow, storeList: StoreRow[]) => {
    setLoading(true)
    setError(null)
    try {
      const results = await Promise.all(
        storeList.map(async s => {
          const r = await window.hw.getProviderDebt({ providerId: provider.id, storeId: s.id })
          return {
            storeId: s.id,
            storeName: s.name,
            balance: r.ok && r.data ? r.data.balance : 0,
            amountRaw: '',
            lastEventNotes: r.ok && r.data ? r.data.lastEventNotes : null,
          }
        }),
      )
      setRows(results)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selected || stores.length === 0) return
    void loadBalances(selected, stores)
  }, [selected, stores, loadBalances])

  const filtered = providerInput.trim().length === 0
    ? providers
    : providers.filter(p => p.name.toLowerCase().includes(providerInput.toLowerCase()))

  function selectProvider(p: ProviderRow) {
    setSelected(p)
    setProviderInput(p.name)
    setShowSuggestions(false)
    setUseCredit(false)
    setError(null)
  }

  const anyDebt = rows.some(r => r.balance > 0)
  const creditRows = rows.filter(r => r.balance < 0)
  const hasMixed = anyDebt && creditRows.length > 0
  const creditTotal = creditRows.reduce((s, r) => s + Math.abs(r.balance), 0)
  const applyCredit = useCredit && hasMixed

  const effectiveByStore = useMemo(() => {
    const byStore: Record<string, number> = {}
    for (const r of rows) byStore[r.storeId] = r.balance
    return applyCredit ? previewCompensatedBalances(byStore) : byStore
  }, [rows, applyCredit])

  function remainingOf(storeId: string): number {
    return Math.max(0, effectiveByStore[storeId] ?? 0)
  }

  function setAmount(storeId: string, raw: string) {
    setRows(prev => prev.map(r => r.storeId === storeId ? { ...r, amountRaw: raw } : r))
    setError(null)
  }

  function fillStore(storeId: string, amount: number) {
    setAmount(storeId, amount > 0 ? formatIntegerWithDots(String(Math.round(amount))) : '')
  }

  function fillAllDebts() {
    setRows(prev => prev.map(r => {
      const rem = remainingOf(r.storeId)
      return rem > 0
        ? { ...r, amountRaw: formatIntegerWithDots(String(Math.round(rem))) }
        : { ...r, amountRaw: '' }
    }))
    setError(null)
  }

  function toggleCredit(next: boolean) {
    setUseCredit(next)
    setError(null)
    const byStore: Record<string, number> = {}
    for (const r of rows) byStore[r.storeId] = r.balance
    const preview = next && hasMixed ? previewCompensatedBalances(byStore) : byStore
    setRows(prev => prev.map(r => {
      const oldRem = remainingOf(r.storeId)
      const newRem = Math.max(0, preview[r.storeId] ?? 0)
      const typed = parseNumericInput(r.amountRaw) ?? 0
      if (typed <= 0) return r
      if (oldRem > 0 && typed >= oldRem) {
        return { ...r, amountRaw: newRem > 0 ? formatIntegerWithDots(String(Math.round(newRem))) : '' }
      }
      if (typed > newRem) {
        return { ...r, amountRaw: newRem > 0 ? formatIntegerWithDots(String(Math.round(newRem))) : '' }
      }
      return r
    }))
  }

  const allocations = useMemo(
    () => rows
      .map(r => {
        const typed = parseNumericInput(r.amountRaw) ?? 0
        const capped = Math.min(typed, remainingOf(r.storeId))
        return { storeId: r.storeId, storeName: r.storeName, amount: capped }
      })
      .filter(a => a.amount > 0),
    // remainingOf depends on effectiveByStore
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, effectiveByStore],
  )
  const total = allocations.reduce((s, a) => s + a.amount, 0)
  const remainingTotal = rows.reduce((s, r) => s + remainingOf(r.storeId), 0)

  async function handleSubmit() {
    if (!selected) { setError('Elegí un proveedor.'); return }
    if (total <= 0 && !applyCredit) {
      setError('Indicá cuánto se paga en al menos un local.')
      return
    }
    setSaving(true)
    setError(null)

    if (applyCredit) {
      const comp = await window.hw.compensateProviderStores({ providerId: selected.id })
      if (!comp.ok) {
        setSaving(false)
        setError(comp.error ?? 'No se pudo compensar.')
        return
      }
    }

    if (total > 0) {
      const r = await window.hw.payProviderFromShift({
        providerId: selected.id,
        allocations: allocations.map(a => ({ storeId: a.storeId, amount: a.amount })),
        notes: applyCredit ? 'Saldar deuda (con compensación)' : 'Saldar deuda',
      })
      if (!r.ok) {
        setSaving(false)
        setError(r.error ?? 'No se pudo registrar el pago.')
        return
      }
    }

    const lines: SettleReceiptLine[] = rows.map(r => {
      const paid = allocations.find(a => a.storeId === r.storeId)?.amount ?? 0
      const effective = effectiveByStore[r.storeId] ?? r.balance
      const after = effective - paid
      const debtReduced = Math.max(0, r.balance) - Math.max(0, effective)
      const creditConsumed = Math.max(0, -r.balance) - Math.max(0, -effective)
      return { storeName: r.storeName, paid, remaining: after, creditUsed: debtReduced + creditConsumed }
    }).filter(l => l.paid > 0 || l.creditUsed > 0 || l.remaining !== 0)

    setSaving(false)
    onSaved?.()
    setReceipt({
      businessName,
      providerName: selected.name,
      date: new Date().toISOString(),
      usedCredit: applyCredit,
      cashOut: total,
      lines: lines.length > 0 ? lines : rows.map(r => ({
        storeName: r.storeName,
        paid: 0,
        remaining: effectiveByStore[r.storeId] ?? r.balance,
        creditUsed: 0,
      })),
    })
  }

  if (receipt) {
    const leftover = receipt.lines.reduce((s, l) => s + Math.max(0, l.remaining), 0)
    const leftoverCredit = receipt.lines.reduce((s, l) => s + Math.max(0, -l.remaining), 0)
    const isSettled = leftover === 0 && leftoverCredit === 0
    return (
      <PaymentReceipt
        businessName={receipt.businessName || 'Nombre del negocio'}
        date={receipt.date}
        providerName={receipt.providerName}
        concept="Saldar deuda"
        onClose={() => { onClose() }}
        resultClassName={
          leftover > 0
            ? 'bg-amber-50 border border-amber-200'
            : leftoverCredit > 0
              ? 'bg-emerald-50 border border-emerald-200'
              : 'bg-green-50 border border-green-200'
        }
        result={
          leftover > 0 ? (
            <>
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Deuda restante</p>
              <p className="text-2xl font-bold text-amber-600 mt-1">{formatARS(leftover)}</p>
              <p className="text-[11px] text-amber-600/80 mt-0.5">suma de los locales que aún deben</p>
            </>
          ) : leftoverCredit > 0 ? (
            <>
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Sin deuda</p>
              <p className="text-2xl font-bold text-emerald-600 mt-1">A favor {formatARS(leftoverCredit)}</p>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Saldado ✓</p>
              <p className="text-2xl font-bold text-green-600 mt-1">Sin deuda</p>
            </>
          )
        }
      >
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Sale de esta caja</span>
            <span className="font-bold text-gray-900">{formatARS(receipt.cashOut)}</span>
          </div>
          {receipt.usedCredit && (
            <div className="flex justify-between text-emerald-700">
              <span>Compensación entre locales</span>
              <span className="font-semibold">Aplicada</span>
            </div>
          )}
          {receipt.lines.map(l => (
            <div key={l.storeName} className="border-t border-gray-100 pt-2 space-y-0.5">
              <p className="text-xs text-gray-500 truncate" title={l.storeName}>{l.storeName}</p>
              {l.creditUsed > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Saldo a favor usado</span>
                  <span>− {formatARS(l.creditUsed)}</span>
                </div>
              )}
              {l.paid > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Pagado</span>
                  <span className="font-semibold text-gray-900">{formatARS(l.paid)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600">Saldo del local</span>
                <span className={`font-semibold ${l.remaining > 0 ? 'text-amber-700' : l.remaining < 0 ? 'text-emerald-700' : 'text-green-700'}`}>
                  {l.remaining > 0
                    ? formatARS(l.remaining)
                    : l.remaining < 0
                      ? `A favor ${formatARS(-l.remaining)}`
                      : 'Sin deuda'}
                </span>
              </div>
            </div>
          ))}
          {isSettled && receipt.usedCredit && (
            <p className="text-[11px] text-emerald-700 pt-1">
              Se usó saldo a favor de otro local. No hace falta anotarlo de nuevo.
            </p>
          )}
        </div>
      </PaymentReceipt>
    )
  }

  const canSubmit = !saving && selected && (total > 0 || applyCredit)

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg min-h-[70vh] sm:min-h-[32rem] shadow-xl flex flex-col max-h-[90vh] border border-zinc-700">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-zinc-700 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold">Saldar deuda</h2>
            <p className="text-xs text-zinc-500">El efectivo sale de esta caja. No hace falta una visita.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800"
            title="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="shrink-0 px-4 pt-4 pb-2 relative">
          <label className="text-sm text-zinc-400">Proveedor</label>
          <input
            type="text"
            value={providerInput}
            maxLength={100}
            onChange={e => {
              setProviderInput(e.target.value)
              setSelected(null)
              setRows([])
              setUseCredit(false)
              setShowSuggestions(true)
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="Nombre del proveedor"
            className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-600"
          />
          {showSuggestions && filtered.length > 0 && (
            <ul className="absolute z-20 left-4 right-4 bg-zinc-800 border border-zinc-700 rounded-lg mt-1 max-h-56 overflow-y-auto shadow-lg">
              {filtered.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-700 truncate"
                    title={p.name}
                    onMouseDown={() => selectProvider(p)}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4 min-h-0">
          {loading && <p className="text-sm text-zinc-500">Consultando saldos…</p>}

          {!loading && selected && rows.length > 0 && (
            <div className="space-y-2">
              {hasMixed && (
                <label className="flex items-start gap-2 cursor-pointer select-none rounded-xl border border-emerald-800/50 bg-emerald-950/20 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={useCredit}
                    onChange={e => toggleCredit(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-emerald-200">Usar saldo a favor de otros locales</span>
                    <span className="block text-[11px] text-zinc-500 mt-0.5">
                      Opcional. Aplica {formatARS(creditTotal)} de {creditRows.map(r => r.storeName).join(', ')} contra la deuda. No sale efectivo. Podés desmarcarlo.
                    </span>
                  </span>
                </label>
              )}
              {anyDebt && remainingTotal > 0 && (
                <button
                  type="button"
                  onClick={fillAllDebts}
                  className="w-full py-2 rounded-lg border border-emerald-800/60 text-emerald-300 text-xs font-medium hover:bg-emerald-950/40"
                >
                  Pagar todo (todos los locales)
                </button>
              )}
              {rows.map(r => {
                const originalDebt = Math.max(0, r.balance)
                const originalCredit = Math.max(0, -r.balance)
                const effective = effectiveByStore[r.storeId] ?? r.balance
                const debt = Math.max(0, effective)
                const credit = Math.max(0, -effective)
                return (
                  <div key={r.storeId} className="rounded-xl border border-zinc-600 bg-zinc-700 px-3 py-2 space-y-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="min-w-0 flex-1 truncate text-sm text-zinc-200" title={r.storeName}>
                        {r.storeName}
                      </p>
                      <p
                        className={`shrink-0 text-xs font-semibold ${
                          debt > 0 ? 'text-orange-400' : credit > 0 ? 'text-emerald-400' : 'text-zinc-500'
                        }`}
                      >
                        {debt > 0
                          ? formatARS(debt)
                          : credit > 0
                            ? `A favor ${formatARS(credit)}`
                            : 'Sin deuda'}
                      </p>
                    </div>
                    {applyCredit && originalDebt > debt && (
                      <p className="text-[11px] text-emerald-400/80">
                        Resta pagar {formatARS(debt)}
                        {originalDebt > 0 ? ` (era ${formatARS(originalDebt)})` : ''}
                      </p>
                    )}
                    {applyCredit && originalCredit > 0 && credit === 0 && originalDebt === 0 && (
                      <p className="text-[11px] text-emerald-400/80">
                        Se usa el saldo a favor de {formatARS(originalCredit)}
                      </p>
                    )}
                    {isAdminAdjustNote(r.lastEventNotes) && (
                      <p className="text-[11px] text-violet-300/90 min-w-0" title={r.lastEventNotes ?? undefined}>
                        {r.lastEventNotes}
                      </p>
                    )}
                    {debt > 0 && (
                      <div className="flex items-center gap-2">
                        <NumericInput
                          value={r.amountRaw}
                          onChange={v => setAmount(r.storeId, v)}
                          placeholder="0"
                          className="min-w-0 flex-1 rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-600"
                        />
                        <button
                          type="button"
                          onClick={() => fillStore(r.storeId, debt)}
                          className="shrink-0 px-2 py-2 rounded-lg border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-800"
                        >
                          Todo
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {selected && !loading && !anyDebt && rows.length > 0 && (
            <p className="text-sm text-zinc-500">
              Este proveedor no tiene deuda pendiente. Si trajo mercadería, usá Gastos.
            </p>
          )}

          {!loading && selected && remainingTotal >= 0 && (anyDebt || applyCredit) && (
            <div className="space-y-1 border-t border-zinc-700 pt-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Resta pagar</span>
                <span className={`font-bold ${remainingTotal > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                  {formatARS(remainingTotal)}
                </span>
              </div>
              {total > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Sale de esta caja</span>
                  <span className="font-bold text-white">{formatARS(total)}</span>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="shrink-0 flex gap-2 px-4 py-3 border-t border-zinc-700">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-sm disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-sm disabled:opacity-40"
          >
            {saving ? 'Registrando…' : total > 0 ? 'Registrar pago' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
