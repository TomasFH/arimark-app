/**
 * Gasto del turno: modo Gasto (qué se pagó + monto) o Proveedor (visita).
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
  setProviderIntakeKind,
} from '../lib/posCaches'
import { formatMoney } from '../lib/adminFirestore'
import { providerIdFromName } from '../lib/adminLedger'
import type { CachedProvider, CatalogProduct } from '../types/pos'
import {
  formatKg3,
  merchIntakeExpenseConcept,
  merchProductKey,
  purchasePriceChanges,
  resolveMerchVisitLine,
  type MerchIntakeLineSnapshot,
  type MerchVisitFormLine,
  type ProviderIntakeKind,
  type PurchasePriceChange,
} from '@carniceria/shared'
import {
  discardMerchVisitDraft,
  getMerchVisitDraft,
  getProviderPurchasePriceMap,
  saveMerchVisitDraft,
  type PurchasePriceMap,
} from '../lib/merchVisit'
import { ProviderVisitMerchBlock, visitLinesFromForm } from './ProviderVisitMerchBlock'
import { ChickenVisitForm, MediaResVisitForm, ProviderIntakeKindPicker } from './ProviderVisitKindUi'

const DEFAULT_CONCEPTS = ['Insumos', 'Limpieza', 'Servicios', 'Otros']

type ExpenseKind = 'simple' | 'provider'

export interface ShiftExpensePayload {
  concept: string | null
  amount: number
  notes: string | null
  providerId: string | null
  providerName: string | null
  newDebtAmount: number
  paysOldDebt: number
  merchLines?: MerchIntakeLineSnapshot[]
  acceptPriceUpdates?: boolean
  visitKind?: ProviderIntakeKind
}

interface Props {
  storeId: string
  shiftId: string
  userId: string
  catalog: CatalogProduct[]
  onConfirm: (payload: ShiftExpensePayload) => void
  onClose: () => void
  onDraftChanged?: () => void
}

export function ShiftExpenseModal({ storeId, shiftId, userId, catalog, onConfirm, onClose, onDraftChanged }: Props) {
  useBackLayer(true, onClose)
  const keyboardInset = useKeyboardInset()
  const [providers, setProviders] = useState<CachedProvider[]>([])
  const [providerInput, setProviderInput] = useState('')
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [showProviderSuggestions, setShowProviderSuggestions] = useState(false)
  const [kind, setKind] = useState<ExpenseKind>('provider')
  const [concept, setConcept] = useState('')
  const [showConceptSuggestions, setShowConceptSuggestions] = useState(false)
  const [totalRaw, setTotalRaw] = useState('')
  const [amountRaw, setAmountRaw] = useState('')
  const [notes, setNotes] = useState('')
  const [previousBalance, setPreviousBalance] = useState(0)
  const [loadingDebt, setLoadingDebt] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<'provider' | 'kind' | 'concept' | 'amount' | 'merch' | null>(null)
  const [merchLines, setMerchLines] = useState<MerchVisitFormLine[]>([])
  const [lastPrices, setLastPrices] = useState<PurchasePriceMap>({})
  const [draftHydrated, setDraftHydrated] = useState(false)
  const [confirmStep, setConfirmStep] = useState<'prices' | 'summary' | 'facts' | null>(null)
  const [priceChanges, setPriceChanges] = useState<PurchasePriceChange[]>([])
  const acceptPriceUpdatesRef = useRef(true)
  const providerInteractedRef = useRef(false)
  const kindTouchedRef = useRef(false)
  const [intakeKind, setIntakeKind] = useState<ProviderIntakeKind | null>(null)
  const [savingKind, setSavingKind] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        await refreshProvidersCache()
      } catch (err) {
        console.error('[expense] No se pudo refrescar proveedores', err)
      }
      setProviders(await listCachedProviders())
      const draft = await getMerchVisitDraft(shiftId)
      if (draft) {
        if (draft.providerName) setProviderInput(draft.providerName)
        if (draft.providerId) setSelectedProviderId(draft.providerId)
        if (draft.notes) setNotes(draft.notes)
        setMerchLines(draft.lines)
        if (draft.providerName || draft.lines.length > 0) setKind('provider')
      }
      setDraftHydrated(true)
    })()
  }, [shiftId])

  const matchedProviderId = selectedProviderId
    ?? providers.find(p => p.name.toLowerCase() === providerInput.trim().toLowerCase())?.id
    ?? null

  useEffect(() => {
    if (!matchedProviderId) {
      setPreviousBalance(0)
      setLastPrices({})
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
    void getProviderPurchasePriceMap(matchedProviderId)
      .then(map => { if (!cancelled) setLastPrices(map) })
      .catch(err => {
        console.error('[expense] No se pudieron leer costos de compra', err)
      })
    return () => { cancelled = true }
  }, [matchedProviderId, storeId])

  useEffect(() => {
    if (kindTouchedRef.current) return
    if (!matchedProviderId) {
      setIntakeKind(null)
      return
    }
    const p = providers.find(x => x.id === matchedProviderId)
    setIntakeKind(p?.intakeKind ?? null)
  }, [matchedProviderId, providers])

  const filteredProviders = filterProviders(providers, providerInput)
  const filteredConcepts = concept.trim().length === 0
    ? DEFAULT_CONCEPTS
    : DEFAULT_CONCEPTS.filter(s => s.toLowerCase().includes(concept.toLowerCase()))

  const hasProviderName = providerInput.trim().length > 0
  const showVisitFields = kind === 'provider' && hasProviderName
  const merchResolved = merchLines.length > 0 ? visitLinesFromForm(merchLines) : null
  const merchTotal = merchResolved?.ok ? merchResolved.total : null
  const visitTotal = showVisitFields
    ? (merchTotal != null ? merchTotal : (parseNumericInput(totalRaw) ?? 0))
    : 0
  const delivered = parseNumericInput(amountRaw) ?? 0
  const visit = showVisitFields && visitTotal > 0
    ? computeProviderVisit({ visitTotal, delivered, previousBalance })
    : null

  function switchKind(next: ExpenseKind) {
    if (next === kind) return
    if (kind === 'provider' && merchLines.length > 0) {
      void persistDraft()
    }
    setKind(next)
    setError(null)
  }

  function selectProvider(p: CachedProvider) {
    setProviderInput(p.name)
    setSelectedProviderId(p.id)
    setShowProviderSuggestions(false)
    kindTouchedRef.current = false
    if (intakeKind !== (p.intakeKind ?? null)) setMerchLines([])
    setIntakeKind(p.intakeKind ?? null)
    setError(null)
  }

  function resetVisitDraft() {
    setMerchLines([])
    setTotalRaw('')
    setAmountRaw('')
    setError(null)
  }

  async function chooseIntakeKind(next: ProviderIntakeKind) {
    const previous = intakeKind
    resetVisitDraft()
    kindTouchedRef.current = true
    setIntakeKind(next)
    setSavingKind(true)
    try {
      const row = await setProviderIntakeKind({
        id: selectedProviderId,
        name: providerInput.trim(),
        createdBy: userId,
        intakeKind: next,
      })
      setSelectedProviderId(row.id)
      setProviders(prev => [row, ...prev.filter(p => p.id !== row.id)])
    } catch (err) {
      console.error('[expense] No se pudo guardar el tipo de visita', err)
      setIntakeKind(previous)
      setError('No se pudo guardar qué trae. Reintentá.')
    } finally {
      setSavingKind(false)
    }
  }

  async function persistDraft() {
    if (!draftHydrated) return
    if (!hasProviderName) return
    if (merchLines.length === 0) {
      await discardMerchVisitDraft(shiftId)
      onDraftChanged?.()
      return
    }
    await saveMerchVisitDraft({
      shiftId,
      providerId: selectedProviderId,
      providerName: providerInput.trim(),
      notes: notes.trim() || null,
      lines: merchLines,
    })
    onDraftChanged?.()
  }

  async function handleClose() {
    await persistDraft()
    onClose()
  }

  function emitConfirm(acceptPriceUpdates: boolean, snapshots: MerchIntakeLineSnapshot[]) {
    const resolved = visit ?? computeProviderVisit({ visitTotal, delivered, previousBalance })
    const providerName = providerInput.trim().slice(0, 100)
    onConfirm({
      concept: merchIntakeExpenseConcept(snapshots.map(l => l.rubroName)),
      amount: resolved.amountForVisit,
      notes: notes.trim() ? notes.trim().slice(0, 200) : null,
      providerId: selectedProviderId ?? providerIdFromName(providerName),
      providerName,
      newDebtAmount: resolved.newDebtAmount,
      paysOldDebt: resolved.paysOldDebt,
      merchLines: snapshots,
      acceptPriceUpdates,
      visitKind: intakeKind === 'chicken' || intakeKind === 'media_res' ? intakeKind : 'catalog',
    })
  }

  function handleConfirm() {
    if (kind === 'simple') {
      if (!concept.trim()) {
        setError('Ingresá qué se pagó.')
        setErrorField('concept')
        return
      }
      const amount = parseNumericInput(amountRaw)
      if (amount === null || amount <= 0) {
        setError('Ingresá un monto mayor a 0.')
        setErrorField('amount')
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

    if (!providerInput.trim()) {
      setError('Ingresá el proveedor.')
      setErrorField('provider')
      return
    }
    if (!intakeKind) {
      setError('Elegí qué trae este proveedor.')
      setErrorField('kind')
      return
    }

    if (intakeKind === 'insumos') {
      if (!concept.trim()) {
        setError('Ingresá qué se pagó.')
        setErrorField('concept')
        return
      }
    }

    if (intakeKind === 'media_res') {
      if (!merchResolved?.ok) {
        setError(merchResolved && 'error' in merchResolved ? merchResolved.error : 'Cargá el kilo de cada media res.')
        setErrorField('merch')
        return
      }
      setConfirmStep('facts')
      return
    }

    if (intakeKind === 'chicken' && (!merchResolved?.ok || merchLines.length === 0)) {
      setError(merchResolved && 'error' in merchResolved ? merchResolved.error : 'Cargá los cajones, los kilos y el precio.')
      setErrorField('merch')
      return
    }

    if (!visitTotal || visitTotal <= 0) {
      setError('Ingresá el total de la visita.')
      setErrorField('amount')
      return
    }

    if (merchLines.length > 0) {
      if (!merchResolved?.ok) {
        setError(merchResolved && 'error' in merchResolved ? merchResolved.error : 'Revisá los productos.')
        setErrorField('merch')
        return
      }
      const changes = purchasePriceChanges(
        merchResolved.drafts.map(d => ({
          productKey: merchProductKey(d.productId, d.name),
          name: d.name,
          unitCost: d.unitCost,
        })),
        lastPrices,
      )
      setPriceChanges(changes)
      setConfirmStep(changes.length > 0 ? 'prices' : 'summary')
      return
    }

    const resolved = visit ?? computeProviderVisit({ visitTotal, delivered, previousBalance })
    const providerName = providerInput.trim().slice(0, 100)
    void discardMerchVisitDraft(shiftId).then(() => onDraftChanged?.())
    onConfirm({
      concept: intakeKind === 'insumos' ? concept.trim().slice(0, 80) : null,
      amount: resolved.amountForVisit,
      notes: notes.trim() ? notes.trim().slice(0, 200) : null,
      providerId: selectedProviderId ?? providerIdFromName(providerName),
      providerName,
      newDebtAmount: resolved.newDebtAmount,
      paysOldDebt: resolved.paysOldDebt,
    })
  }

  if (confirmStep === 'prices') {
    return (
      <div className="fixed inset-0 z-50 flex items-end bg-black/80" style={{ paddingBottom: keyboardInset }}>
        <div className="max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-gray-900 p-5">
          <h2 className="text-lg font-bold text-white">Precios de compra</h2>
          <p className="text-sm text-gray-400">Estos precios son distintos a la última visita. ¿Los recordamos para la próxima?</p>
          <ul className="space-y-2">
            {priceChanges.map(c => (
              <li key={c.productKey} className="flex items-center justify-between gap-2 text-sm text-white">
                <span className="min-w-0 flex-1 truncate" title={c.name}>{c.name}</span>
                <span className="shrink-0 tabular-nums text-gray-400">{formatMoney(c.previous)} → {formatMoney(c.next)}</span>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className="rounded-xl bg-gray-800 py-4 font-semibold text-white"
              onClick={() => { acceptPriceUpdatesRef.current = false; setConfirmStep('summary') }}
            >
              Usar ahora, no cambiar
            </button>
            <button
              type="button"
              className="rounded-xl bg-red-600 py-4 font-bold text-white"
              onClick={() => { acceptPriceUpdatesRef.current = true; setConfirmStep('summary') }}
            >
              Recordar los nuevos
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (confirmStep === 'summary' && merchResolved?.ok) {
    const summaryLines = merchResolved.drafts.flatMap((d, i) => {
      const r = resolveMerchVisitLine(d, { id: String(i), sortOrder: i })
      return r.ok ? [r.line] : []
    })
    return (
      <div className="fixed inset-0 z-50 flex items-end bg-black/80" style={{ paddingBottom: keyboardInset }}>
        <div className="max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-gray-900 p-5">
          <h2 className="text-lg font-bold text-white">Confirmar visita</h2>
          <ul className="space-y-1 text-sm">
            {summaryLines.map(line => (
              <li key={line.id} className="flex items-center justify-between gap-2 min-w-0 text-white">
                <span className="min-w-0 flex-1 truncate" title={line.rubroName}>{line.rubroName}</span>
                <span className="shrink-0 tabular-nums text-gray-400">{formatMoney(line.costTotal)}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm font-semibold text-white">
            Total {formatMoney(visitTotal)} · Entregado {formatMoney(delivered)}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="rounded-xl bg-gray-800 py-4 font-semibold text-white" onClick={() => setConfirmStep(null)}>
              Volver
            </button>
            <button
              type="button"
              className="rounded-xl bg-red-600 py-4 font-bold text-white"
              onClick={() => emitConfirm(acceptPriceUpdatesRef.current, summaryLines)}
            >
              Confirmar
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (confirmStep === 'facts' && merchResolved?.ok) {
    const factsLine = merchResolved.drafts.flatMap((d, i) => {
      const r = resolveMerchVisitLine(d, { id: String(i), sortOrder: i })
      return r.ok ? [r.line] : []
    })[0]
    return (
      <div className="fixed inset-0 z-50 flex items-end bg-black/80" style={{ paddingBottom: keyboardInset }}>
        <div className="max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-gray-900 p-5">
          <h2 className="text-lg font-bold text-white">Registrar kilos</h2>
          <p className="min-w-0 truncate text-sm text-gray-300" title={providerInput.trim()}>{providerInput.trim()}</p>
          <div className="space-y-2 rounded-xl border border-gray-700 bg-gray-800/80 px-4 py-3">
            <div className="flex justify-between gap-2 text-sm text-white">
              <span className="text-gray-400">Unidades</span>
              <span className="tabular-nums font-semibold">{factsLine?.count ?? 0}</span>
            </div>
            <div className="flex justify-between gap-2 text-sm text-white">
              <span className="text-gray-400">Kilos</span>
              <span className="tabular-nums font-semibold">{formatKg3(factsLine?.netKg ?? 0)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="rounded-xl bg-gray-800 py-4 font-semibold text-white" onClick={() => setConfirmStep(null)}>
              Volver
            </button>
            <button
              type="button"
              className="rounded-xl bg-red-600 py-4 font-bold text-white"
              onClick={() => {
                if (!factsLine) return
                onConfirm({
                  concept: null,
                  amount: 0,
                  notes: notes.trim() ? notes.trim().slice(0, 200) : null,
                  providerId: selectedProviderId ?? providerIdFromName(providerInput.trim()),
                  providerName: providerInput.trim().slice(0, 100),
                  newDebtAmount: 0,
                  paysOldDebt: 0,
                  merchLines: [factsLine],
                  acceptPriceUpdates: false,
                  visitKind: 'media_res',
                })
              }}
            >
              Confirmar
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/80"
      style={{ paddingBottom: keyboardInset }}
    >
      <div className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-gray-900">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-white" title="Gastos">
            Gastos
          </h2>
          <button type="button" onClick={() => { void handleClose() }} className="shrink-0 text-2xl leading-none text-gray-400 hover:text-white">
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/40 p-1">
          {([
            { id: 'provider' as const, label: 'Proveedor' },
            { id: 'simple' as const, label: 'Gasto' },
          ]).map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => switchKind(opt.id)}
              className={`rounded-lg py-3 text-sm font-semibold ${
                kind === opt.id ? 'bg-gray-800 text-white' : 'text-gray-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {kind === 'provider' && (
        <div className="relative">
          <label className="mb-1 block text-xs text-gray-400">Proveedor</label>
          <input
            type="text"
            value={providerInput}
            onChange={e => {
              setProviderInput(e.target.value.slice(0, 100))
              setSelectedProviderId(null)
              kindTouchedRef.current = false
              setIntakeKind(null)
              providerInteractedRef.current = true
              setShowProviderSuggestions(true)
              setError(null)
            }}
            onFocus={() => { if (providerInteractedRef.current) setShowProviderSuggestions(true) }}
            onClick={() => { providerInteractedRef.current = true; setShowProviderSuggestions(true) }}
            maxLength={100}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="Nombre del proveedor…"
          />
          {showProviderSuggestions && filteredProviders.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 shadow-lg">
              {filteredProviders.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); selectProvider(p) }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-gray-700"
                  >
                    <span className="min-w-0 flex-1 truncate" title={p.name}>{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {showVisitFields && (
            <p className="mt-1 min-h-[1rem] text-xs text-gray-500" aria-live="polite">
              {loadingDebt ? 'Consultando deuda…' : null}
            </p>
          )}
          {showVisitFields && previousBalance !== 0 && (
            <p className={`mt-1 text-xs ${previousBalance > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {previousBalance > 0
                ? `Deuda de este local: ${formatMoney(previousBalance)}`
                : `Saldo a favor: ${formatMoney(-previousBalance)}`}
            </p>
          )}
        </div>
        )}

        {showVisitFields && (
          <ProviderIntakeKindPicker
            value={intakeKind}
            busy={savingKind}
            onChoose={k => { void chooseIntakeKind(k) }}
            onClear={() => {
              kindTouchedRef.current = true
              setIntakeKind(null)
              resetVisitDraft()
            }}
          />
        )}
        {showVisitFields && intakeKind === 'catalog' && (
          <ProviderVisitMerchBlock
            products={catalog}
            lastPrices={lastPrices}
            lines={merchLines}
            onChange={lines => { setMerchLines(lines); setError(null); setErrorField(null) }}
            invalid={errorField === 'merch'}
          />
        )}
        {showVisitFields && intakeKind === 'media_res' && (
          <MediaResVisitForm lines={merchLines} onChange={setMerchLines} />
        )}
        {showVisitFields && intakeKind === 'chicken' && (
          <ChickenVisitForm lines={merchLines} lastPrices={lastPrices} onChange={setMerchLines} />
        )}

        {(kind === 'simple' || intakeKind === 'insumos') && (
        <div className="relative">
          <label className="mb-1 block text-xs text-gray-400">Qué se pagó</label>
          <input
            type="text"
            value={concept}
            onChange={e => { setConcept(e.target.value.slice(0, 80)); setShowConceptSuggestions(true); setError(null) }}
            onFocus={() => setShowConceptSuggestions(true)}
            maxLength={80}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="Bolsas, limpieza…"
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
        )}

        {showVisitFields && intakeKind && intakeKind !== 'media_res' && (
          <>
            {merchLines.length === 0 && (intakeKind === 'catalog' || intakeKind === 'insumos') ? (
              <div>
                <label className="mb-1 block text-xs text-gray-400">Total de la visita</label>
                <NumericInput
                  value={totalRaw}
                  onChange={v => { setTotalRaw(v); setError(null) }}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="0"
                />
              </div>
            ) : (
              <p className="text-sm text-gray-300">
                Total de la visita: <span className="font-semibold text-white">{formatMoney(visitTotal)}</span>
              </p>
            )}
            <div>
              <label className="mb-1 block text-xs text-gray-400">Entregado al proveedor</label>
              <NumericInput
                value={amountRaw}
                onChange={v => { setAmountRaw(v); setError(null) }}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="0"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                Vacío = queda debiendo. Si das de más, se aplica a deuda anterior.
              </p>
            </div>
            {visit && visitTotal > 0 && (
              <div className="space-y-1 rounded-xl border border-gray-700 bg-gray-800/80 px-4 py-3 text-sm">
                {visit.previousDebt > 0 && (
                  <div className="flex justify-between gap-2 text-amber-300">
                    <span>Deuda anterior</span>
                    <span className="font-semibold">{formatMoney(visit.previousDebt)}</span>
                  </div>
                )}
                {visit.previousDebt > 0 ? (
                  visit.displayedNewDebt > 0 && (
                    <div className="flex justify-between gap-2 text-amber-300">
                      <span>De esta visita</span>
                      <span className="font-semibold">{formatMoney(visit.displayedNewDebt)}</span>
                    </div>
                  )
                ) : (
                  <div className="flex justify-between gap-2 text-white">
                    <span>Esta visita</span>
                    <span className="font-semibold">{formatMoney(visitTotal)}</span>
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
        )}

        {kind === 'simple' && (
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
          <label className="mb-1 block text-xs text-gray-400">{kind === 'provider' ? 'Observaciones' : 'Notas'}</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value.slice(0, 200))}
            maxLength={200}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gray-500"
            placeholder={kind === 'provider' ? 'Observaciones…' : undefined}
          />
        </div>

        </div>
        <div className="shrink-0 space-y-3 border-t border-gray-800 bg-gray-900 px-5 py-4">
        {error && (
          <p role="alert" className="text-sm font-medium text-orange-400">{error}</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => { void handleClose() }}
            className="rounded-xl bg-gray-800 py-4 font-semibold text-white transition-colors hover:bg-gray-700"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-xl bg-red-600 py-4 font-bold text-white transition-colors hover:bg-red-700"
          >
            {intakeKind === 'media_res' ? 'Registrar kilos' : 'Guardar'}
          </button>
        </div>
        {kind === 'provider' && merchLines.length > 0 && (
          <button
            type="button"
            className="w-full text-center text-sm text-gray-400"
            onClick={() => {
              void discardMerchVisitDraft(shiftId).then(() => {
                onDraftChanged?.()
                onClose()
              })
            }}
          >
            Descartar visita
          </button>
        )}
        </div>
      </div>
    </div>
  )
}
