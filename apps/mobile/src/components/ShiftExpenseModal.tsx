/**
 * Gasto del turno: concepto libre o proveedor de la lista (con deuda).
 */
import { useEffect, useRef, useState } from 'react'
import { useBackLayer } from '../lib/backStack'
import { useKeyboardInset } from '../lib/keyboardInset'
import NumericInput from './NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import { computeProviderVisit } from '../lib/expenseVisit'
import {
  filterProviders,
  getProviderBalance,
  listCachedProviders,
  refreshProvidersCache,
} from '../lib/posCaches'
import { formatMoney } from '../lib/adminFirestore'
import { providerIdFromName } from '../lib/adminLedger'
import type { CachedProvider } from '../types/pos'

const DEFAULT_CONCEPTS = ['Insumos', 'Limpieza', 'Servicios', 'Otros']

export interface ShiftExpensePayload {
  concept: string | null
  amount: number
  notes: string | null
  providerId: string | null
  providerName: string | null
  newDebtAmount: number
  paysOldDebt: number
}

interface Props {
  storeId: string
  onConfirm: (payload: ShiftExpensePayload) => void
  onClose: () => void
}

export function ShiftExpenseModal({ storeId, onConfirm, onClose }: Props) {
  useBackLayer(true, onClose)
  const keyboardInset = useKeyboardInset()
  const [providers, setProviders] = useState<CachedProvider[]>([])
  const [providerInput, setProviderInput] = useState('')
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [showProviderSuggestions, setShowProviderSuggestions] = useState(false)
  const [concept, setConcept] = useState('')
  const [showConceptSuggestions, setShowConceptSuggestions] = useState(false)
  const [totalRaw, setTotalRaw] = useState('')
  const [amountRaw, setAmountRaw] = useState('')
  const [notes, setNotes] = useState('')
  const [previousBalance, setPreviousBalance] = useState(0)
  const [loadingDebt, setLoadingDebt] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const providerInteractedRef = useRef(false)

  useEffect(() => {
    void (async () => {
      try {
        await refreshProvidersCache()
      } catch (err) {
        console.error('[expense] No se pudo refrescar proveedores', err)
      }
      setProviders(await listCachedProviders())
    })()
  }, [])

  const matchedProviderId = selectedProviderId
    ?? providers.find(p => p.name.toLowerCase() === providerInput.trim().toLowerCase())?.id
    ?? null

  useEffect(() => {
    if (!matchedProviderId) {
      setPreviousBalance(0)
      return
    }
    let cancelled = false
    setLoadingDebt(true)
    void getProviderBalance(matchedProviderId, storeId)
      .then(bal => { if (!cancelled) setPreviousBalance(bal) })
      .catch(err => {
        console.error('[expense] No se pudo leer deuda del proveedor', err)
        if (!cancelled) setPreviousBalance(0)
      })
      .finally(() => { if (!cancelled) setLoadingDebt(false) })
    return () => { cancelled = true }
  }, [matchedProviderId, storeId])

  const filteredProviders = filterProviders(providers, providerInput)
  const filteredConcepts = concept.trim().length === 0
    ? DEFAULT_CONCEPTS
    : DEFAULT_CONCEPTS.filter(s => s.toLowerCase().includes(concept.toLowerCase()))

  const hasProvider = providerInput.trim().length > 0
  const visitTotal = hasProvider ? (parseNumericInput(totalRaw) ?? 0) : 0
  const delivered = parseNumericInput(amountRaw) ?? 0
  const visit = hasProvider && visitTotal > 0
    ? computeProviderVisit({ visitTotal, delivered, previousBalance })
    : null

  function selectProvider(p: CachedProvider) {
    setProviderInput(p.name)
    setSelectedProviderId(p.id)
    setShowProviderSuggestions(false)
    setError(null)
  }

  function handleConfirm() {
    const hasProviderLocal = providerInput.trim().length > 0
    const hasConcept = concept.trim().length > 0
    if (!hasProviderLocal && !hasConcept) {
      setError('Ingresá un proveedor o un concepto.')
      return
    }

    if (!hasProviderLocal) {
      const amount = parseNumericInput(amountRaw)
      if (amount === null || amount <= 0) {
        setError('Ingresá un monto mayor a 0.')
        return
      }
      onConfirm({
        concept: concept.trim().slice(0, 80),
        amount,
        notes: notes.trim() ? notes.trim().slice(0, 200) : null,
        providerId: null,
        providerName: null,
        newDebtAmount: 0,
        paysOldDebt: 0,
      })
      return
    }

    if (!visitTotal || visitTotal <= 0) {
      setError('Ingresá el total de la visita.')
      return
    }
    const resolved = visit ?? computeProviderVisit({ visitTotal, delivered, previousBalance })
    const providerName = providerInput.trim().slice(0, 100)
    onConfirm({
      concept: hasConcept ? concept.trim().slice(0, 80) : null,
      amount: resolved.amountForVisit,
      notes: notes.trim() ? notes.trim().slice(0, 200) : null,
      providerId: selectedProviderId ?? providerIdFromName(providerName),
      providerName,
      newDebtAmount: resolved.newDebtAmount,
      paysOldDebt: resolved.paysOldDebt,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/80"
      style={{ paddingBottom: keyboardInset }}
    >
      <div className="max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-gray-900 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-white" title="Registrar gasto">
            Registrar gasto
          </h2>
          <button type="button" onClick={onClose} className="shrink-0 text-2xl leading-none text-gray-400 hover:text-white">
            ×
          </button>
        </div>

        <div className="relative">
          <label className="mb-1 block text-xs text-gray-400">Proveedor</label>
          <input
            type="text"
            value={providerInput}
            onChange={e => {
              setProviderInput(e.target.value.slice(0, 100))
              setSelectedProviderId(null)
              providerInteractedRef.current = true
              setShowProviderSuggestions(true)
              setError(null)
            }}
            onFocus={() => { if (providerInteractedRef.current) setShowProviderSuggestions(true) }}
            onClick={() => { providerInteractedRef.current = true; setShowProviderSuggestions(true) }}
            maxLength={100}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="Elegí de la lista o escribí un nombre…"
          />
          {showProviderSuggestions && filteredProviders.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 shadow-lg">
              {filteredProviders.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    onMouseDown={() => selectProvider(p)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-gray-700"
                  >
                    <span className="min-w-0 flex-1 truncate" title={p.name}>{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {loadingDebt && hasProvider && (
            <p className="mt-1 text-xs text-gray-500">Consultando deuda…</p>
          )}
          {!loadingDebt && hasProvider && previousBalance !== 0 && (
            <p className={`mt-1 text-xs ${previousBalance > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {previousBalance > 0
                ? `Deuda de este local: ${formatMoney(previousBalance)}`
                : `Saldo a favor: ${formatMoney(-previousBalance)}`}
            </p>
          )}
        </div>

        <div className="relative">
          <label className="mb-1 block text-xs text-gray-400">
            Concepto {hasProvider ? <span className="text-gray-500">(opcional)</span> : <span>*</span>}
          </label>
          <input
            type="text"
            value={concept}
            onChange={e => { setConcept(e.target.value.slice(0, 80)); setShowConceptSuggestions(true); setError(null) }}
            onFocus={() => setShowConceptSuggestions(true)}
            maxLength={80}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder={hasProvider ? 'Descripción adicional…' : 'Ej. bolsas, limpieza…'}
          />
          {showConceptSuggestions && filteredConcepts.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-32 w-full overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 shadow-lg">
              {filteredConcepts.map(s => (
                <li key={s}>
                  <button
                    type="button"
                    onMouseDown={() => { setConcept(s); setShowConceptSuggestions(false) }}
                    className="w-full px-3 py-2 text-left text-sm text-white hover:bg-gray-700"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {hasProvider ? (
          <>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Total de la visita</label>
              <NumericInput
                value={totalRaw}
                onChange={v => { setTotalRaw(v); setError(null) }}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="0"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Entregado al proveedor</label>
              <NumericInput
                value={amountRaw}
                onChange={v => { setAmountRaw(v); setError(null) }}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="0"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                0 = no se pagó nada (queda como deuda). Más que la visita salda deuda anterior.
              </p>
            </div>
            {visit && visitTotal > 0 && (
              <div className="space-y-1 rounded-xl border border-gray-700 bg-gray-800/80 px-4 py-3 text-sm">
                {visit.displayedNewDebt > 0 && (
                  <div className="flex justify-between gap-2 text-amber-300">
                    <span>Deuda de esta visita</span>
                    <span className="font-semibold">{formatMoney(visit.displayedNewDebt)}</span>
                  </div>
                )}
                {visit.paysOldDebt > 0 && (
                  <div className="flex justify-between gap-2 text-emerald-300">
                    <span>Exceso / salda anterior</span>
                    <span className="font-semibold">{formatMoney(visit.paysOldDebt)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2 text-white">
                  <span>Sale de caja</span>
                  <span className="font-semibold">{formatMoney(visit.amountForVisit)}</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div>
            <label className="mb-1 block text-xs text-gray-400">Monto</label>
            <NumericInput
              value={amountRaw}
              onChange={v => { setAmountRaw(v); setError(null) }}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="0"
            />
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs text-gray-400">Nota (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value.slice(0, 200))}
            maxLength={200}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gray-500"
            placeholder="Observaciones…"
          />
        </div>

        {error && (
          <p className="text-center text-sm font-medium text-orange-400">{error}</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-gray-800 py-4 font-semibold text-white transition-colors hover:bg-gray-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-xl bg-red-600 py-4 font-bold text-white transition-colors hover:bg-red-700"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
