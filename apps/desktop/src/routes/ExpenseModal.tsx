/**
 * Modal para registrar un gasto durante el turno activo.
 *
 * Dos modos excluyentes:
 *   - Gasto: qué se pagó + monto. Sin proveedor ni mercadería.
 *   - Proveedor: quién trajo mercadería, renglones, entregado / deuda.
 * El concepto no se pide en una visita: el proveedor identifica el registro.
 * Autocomplete de proveedores (LIST_PROVIDERS). Nombre nuevo se crea al guardar.
 * Deuda pendiente: el exceso entregado se aplica solo. Comprobante al confirmar.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import NumericInput from '../components/NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import { formatPhoneInput } from '../lib/phoneInput'
import PaymentReceipt from '../components/PaymentReceipt'
import { isAdminAdjustNote } from '../lib/providerLedgerNotes'
import { Button, CollapseReveal, Modal, SuggestPopover } from '../components/ui'
import { namedSuggest } from '../lib/namedSuggest'
import type { ExpenseRow, ProductRow, ProviderDebtRow, ProviderRow, StoreRow } from '../types/hw-api'
import ProviderVisitMerchBlock, { type PurchasePriceMap } from './ProviderVisitMerchBlock'
import { ChickenVisitForm, MediaResVisitForm, ProviderIntakeKindPicker } from './ProviderVisitKindUi'
import {
  merchProductKey,
  merchVisitReceiptItems,
  purchasePriceChanges,
  resolveMerchVisitLine,
  visitLinesFromForm,
  type MerchVisitFormLine,
  type MerchVisitReceiptItem,
  type ProviderIntakeKind,
  type PurchasePriceChange,
} from '@carniceria/shared'

interface Props {
  onRegistered: () => void
  /** Llamado inmediatamente cuando el gasto se guardó en DB, antes de que el usuario
   * cierre el comprobante. Permite que el padre refresque el balance sin esperar al cierre. */
  onSaved?: () => void
  onCancel: () => void
  onDraftChanged?: () => void
  /** Si se pasa, el modal opera en modo edición sobre este gasto existente. */
  editingExpense?: ExpenseRow
}

type ExpenseKind = 'simple' | 'provider'
type ErrorField = 'provider' | 'kind' | 'concept' | 'amount' | 'merch' | null

const FIELD =
  'w-full rounded-lg border border-line bg-input px-3 py-2 text-ink placeholder:text-subtle focus:outline-none focus:border-line-accent'

function kindFromExpense(expense: ExpenseRow | undefined): ExpenseKind {
  if (!expense) return 'provider'
  return expense.providerId || expense.provider ? 'provider' : 'simple'
}

interface ReceiptData {
  businessName: string
  providerName: string
  concept?: string
  date: string
  visitTotal: number
  totalDelivered: number
  previousBalance: number
  oldDebtPaid: number
  newDebt: number
  creditBalance: number
  creditApplied: number
  /** Saldo final de ESTE local: positivo = debo; negativo = a favor */
  finalBalance: number
  storeName?: string
  items: MerchVisitReceiptItem[]
}

export default function ExpenseModal({ onRegistered, onSaved, onCancel, onDraftChanged, editingExpense }: Props) {
  const isEditing = !!editingExpense

  // --- Proveedor ---
  const [providerInput, setProviderInput] = useState(editingExpense?.provider ?? '')
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(editingExpense?.providerId ?? null)
  const [providerSuggestions, setProviderSuggestions] = useState<ProviderRow[]>([])
  const [providersLoaded, setProvidersLoaded] = useState(false)
  const [showProviderSuggestions, setShowProviderSuggestions] = useState(false)
  const providerInteractedRef = useRef(false)

  // --- Concepto ---
  const [kind, setKind] = useState<ExpenseKind>(() => kindFromExpense(editingExpense))
  const [concept, setConcept] = useState(editingExpense?.concept ?? '')
  const [conceptSuggestions, setConceptSuggestions] = useState<string[]>([])
  const [showConceptSuggestions, setShowConceptSuggestions] = useState(false)
  const conceptInteractedRef = useRef(false)
  const conceptInputRef = useRef<HTMLInputElement>(null)
  const insumosConceptRef = useRef<HTMLInputElement>(null)

  // --- Deuda ---
  const [providerDebt, setProviderDebt] = useState<ProviderDebtRow | null>(null)
  const [loadingDebt, setLoadingDebt] = useState(false)

  // --- Local de deuda cross-local ---
  const [stores, setStores] = useState<StoreRow[]>([])
  const [crossLocalDebt, setCrossLocalDebt] = useState(false)
  const [debtStoreId, setDebtStoreId] = useState<string>('')
  const [currentStoreId, setCurrentStoreId] = useState<string>('')
  const [crossStoreDebt, setCrossStoreDebt] = useState<ProviderDebtRow | null>(null)
  const [loadingCrossDebt, setLoadingCrossDebt] = useState(false)

  // --- Montos ---
  const [totalRaw, setTotalRaw] = useState(() => {
    if (!editingExpense) return ''
    const total = editingExpense.amount + (editingExpense.newDebtAmount ?? 0)
    return total > 0 ? String(total) : ''
  })
  const [amountRaw, setAmountRaw] = useState(() => {
    if (!editingExpense) return ''
    const paid = editingExpense.amount + (editingExpense.paysOldDebt ?? 0)
    return paid > 0 ? String(paid) : ''
  })
  const [notes, setNotes] = useState(editingExpense?.notes ?? '')
  const [merchLines, setMerchLines] = useState<MerchVisitFormLine[]>([])
  const [intakeKind, setIntakeKind] = useState<ProviderIntakeKind | null>(null)
  const [savingKind, setSavingKind] = useState(false)
  const [catalog, setCatalog] = useState<ProductRow[]>([])
  const [lastPrices, setLastPrices] = useState<PurchasePriceMap>({})
  const [confirmStep, setConfirmStep] = useState<'prices' | 'summary' | null>(null)
  const [priceChanges, setPriceChanges] = useState<PurchasePriceChange[]>([])
  const [draftHydrated, setDraftHydrated] = useState(!!editingExpense)
  const acceptPriceUpdatesRef = useRef(true)
  const kindTouchedRef = useRef(false)
  const [factsReceipt, setFactsReceipt] = useState<{
    providerName: string
    items: MerchVisitReceiptItem[]
  } | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<ErrorField>(null)

  // --- Comprobante ---
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [businessName, setBusinessName] = useState('')

  const providerInputRef = useRef<HTMLInputElement>(null)

  function showError(message: string, field: ErrorField) {
    setError(message)
    setErrorField(field)
  }

  function clearError() {
    setError(null)
    setErrorField(null)
  }

  function fieldClass(invalid: boolean): string {
    return invalid ? `${FIELD} border-danger focus:border-danger` : FIELD
  }

  useEffect(() => {
    void window.hw.listProviders().then(r => {
      if (r.ok) setProviderSuggestions(r.data)
    }).finally(() => setProvidersLoaded(true))
    void window.hw.getExpenseCategories().then(r => {
      if (r.ok) setConceptSuggestions([...r.data].sort((a, b) => a.localeCompare(b, 'es-AR')))
    })
    void window.hw.getInitStatus().then(r => {
      if (r.ok) setBusinessName(r.data.businessName)
    })
    // El local actual de la cajera es el del turno abierto, no el default de config.
    void window.hw.getUserOpenShift().then(r => {
      if (r.ok && r.data) setCurrentStoreId(r.data.storeId)
    })
    void window.hw.getStores().then(r => {
      if (r.ok) setStores(r.data.filter(s => !s.archivedAt))
    })
    void window.hw.getProducts().then(r => {
      if (r.ok) setCatalog(r.data)
    })
    if (!editingExpense) {
      void window.hw.getMerchVisitDraft().then(r => {
        if (!r.ok || !r.data) {
          setDraftHydrated(true)
          return
        }
        if (r.data.providerName) setProviderInput(r.data.providerName)
        if (r.data.providerId) setSelectedProviderId(r.data.providerId)
        if (r.data.notes) setNotes(r.data.notes)
        setMerchLines(r.data.lines)
        setDraftHydrated(true)
      })
    } else {
      setDraftHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (!draftHydrated) return
    if (kind === 'provider') providerInputRef.current?.focus()
    else conceptInputRef.current?.focus()
  }, [kind, draftHydrated])

  // Inicializa debtStoreId al primer local que no sea el actual, una vez que ambos datos están disponibles.
  useEffect(() => {
    if (!currentStoreId || stores.length === 0) return
    const otherStores = stores.filter(s => s.id !== currentStoreId)
    setDebtStoreId(otherStores[0]?.id ?? '')
  }, [stores, currentStoreId])

  const filteredProviders = namedSuggest(providerSuggestions, providerInput, p => p.name)
  const exactProvider = filteredProviders.exact
  const listedProviders = filteredProviders.listed

  const filteredConcepts = namedSuggest(conceptSuggestions, concept, s => s)
  const listedConcepts = filteredConcepts.listed

  function handleConceptChange(next: string) {
    const exact = namedSuggest(conceptSuggestions, next, s => s).exact
    setConcept(exact ?? next)
    conceptInteractedRef.current = true
    setShowConceptSuggestions(!exact)
    clearError()
  }

  function handleConceptFocus() {
    if (conceptInteractedRef.current) setShowConceptSuggestions(true)
  }

  function handleConceptClick() {
    conceptInteractedRef.current = true
    setShowConceptSuggestions(true)
  }

  // Consulta la deuda del otro local cuando se activa cross-local.
  // Funciona tanto si el proveedor fue seleccionado del autocomplete (selectedProviderId)
  // como si fue escrito a mano con nombre que coincide exactamente con uno existente.
  const matchedProviderId = selectedProviderId ?? exactProvider?.id ?? null

  useEffect(() => {
    if (!crossLocalDebt || !matchedProviderId || !debtStoreId) {
      setCrossStoreDebt(null)
      return
    }
    setLoadingCrossDebt(true)
    void window.hw.getProviderDebt({ providerId: matchedProviderId, storeId: debtStoreId })
      .then(r => { if (r.ok) setCrossStoreDebt(r.data) })
      .finally(() => setLoadingCrossDebt(false))
  }, [crossLocalDebt, matchedProviderId, debtStoreId])

  const fetchProviderDebt = useCallback(async (pid: string) => {
    if (!pid) { setProviderDebt(null); return }
    setLoadingDebt(true)
    const r = await window.hw.getProviderDebt({ providerId: pid })
    setLoadingDebt(false)
    if (r.ok) setProviderDebt(r.data)
  }, [])

  useEffect(() => {
    if (!selectedProviderId) return
    void fetchProviderDebt(selectedProviderId)
  }, [selectedProviderId, fetchProviderDebt])

  useEffect(() => {
    if (kindTouchedRef.current) return
    if (!matchedProviderId) {
      setIntakeKind(null)
      return
    }
    const p = providerSuggestions.find(x => x.id === matchedProviderId)
    setIntakeKind(p?.intakeKind ?? null)
  }, [matchedProviderId, providerSuggestions])

  useEffect(() => {
    if (!selectedProviderId) {
      setLastPrices({})
      return
    }
    void window.hw.getProviderPurchasePrices({ providerId: selectedProviderId }).then(r => {
      if (!r.ok) return
      const map: PurchasePriceMap = {}
      for (const row of r.data) map[row.productKey] = row.unitCost
      setLastPrices(map)
    })
  }, [selectedProviderId])

  function selectProviderFromList(p: ProviderRow) {
    setProviderInput(p.name)
    if (p.id !== selectedProviderId) setProviderDebt(null)
    setSelectedProviderId(p.id)
    setShowProviderSuggestions(false)
    kindTouchedRef.current = false
    if (intakeKind !== (p.intakeKind ?? null)) setMerchLines([])
    setIntakeKind(p.intakeKind ?? null)
  }

  function handleProviderInputChange(value: string) {
    setProviderInput(value)
    clearError()
    kindTouchedRef.current = false

    const exact = namedSuggest(providerSuggestions, value, p => p.name).exact
    if (exact) {
      selectProviderFromList(exact)
      return
    }

    setSelectedProviderId(null)
    setProviderDebt(null)
    setIntakeKind(null)
    setShowProviderSuggestions(true)
  }

  useEffect(() => {
    if (selectedProviderId || providerSuggestions.length === 0) return
    const exact = namedSuggest(providerSuggestions, providerInput, p => p.name).exact
    if (exact) selectProviderFromList(exact)
  }, [providerSuggestions])

  function resetVisitDraft() {
    setMerchLines([])
    setTotalRaw('')
    setAmountRaw('')
    clearError()
  }

  async function chooseIntakeKind(next: ProviderIntakeKind) {
    const previous = intakeKind
    resetVisitDraft()
    kindTouchedRef.current = true
    setIntakeKind(next)
    setSavingKind(true)
    const r = await window.hw.setProviderIntakeKind({
      providerId: selectedProviderId ?? undefined,
      provider: selectedProviderId ? undefined : providerInput.trim(),
      intakeKind: next,
    })
    setSavingKind(false)
    if (!r.ok) {
      setIntakeKind(previous)
      showError(r.error, 'kind')
      return
    }
    setSelectedProviderId(r.data.id)
    setProviderSuggestions(prev => [r.data, ...prev.filter(p => p.id !== r.data.id)])
  }

  const hasProviderName = providerInput.trim().length > 0
  const providerResolved = selectedProviderId != null || exactProvider != null
  const isNewProvider = providersLoaded && hasProviderName && !providerResolved && listedProviders.length === 0
  const showVisitFields = kind === 'provider' && (providerResolved || isNewProvider)
  const merchResolved = merchLines.length > 0 ? visitLinesFromForm(merchLines) : null
  const merchTotal = merchResolved?.ok ? merchResolved.total : null
  const totalParsed = showVisitFields
    ? (merchTotal != null ? merchTotal : (parseNumericInput(totalRaw) ?? 0))
    : null
  const entregadoParsed = parseNumericInput(amountRaw) ?? 0
  const previousBalance = providerDebt?.balance ?? 0
  const previousDebt = Math.max(0, previousBalance)
  const previousCredit = Math.max(0, -previousBalance)
  const hasProviderDebt = previousDebt > 0
  const hasProviderCredit = previousCredit > 0

  // Deuda nueva generada por esta visita
  const autoNewDebt = totalParsed !== null
    ? Math.max(0, totalParsed - entregadoParsed)
    : 0

  // El saldo a favor del local se descuenta solo de esta visita (el ledger ya lo tiene).
  const creditAppliedToVisit = Math.min(previousCredit, autoNewDebt)
  const displayedNewDebt = Math.max(0, autoNewDebt - creditAppliedToVisit)

  // Exceso sobre el costo de la visita → va a saldar deuda vieja o genera saldo a favor
  const excessOverVisit = totalParsed !== null
    ? Math.max(0, entregadoParsed - totalParsed)
    : 0

  // Cuánto de ese exceso cancela deuda vieja del local actual (capped en la deuda existente)
  const autoPaysOldDebt = Math.min(excessOverVisit, previousDebt)

  // Lo que queda después de cancelar deuda del local actual (solo exceso de efectivo)
  const excessAfterLocalDebt = Math.max(0, excessOverVisit - previousDebt)

  // --- Cálculos cross-local ---
  const crossStoreBalance = (crossLocalDebt && crossStoreDebt) ? Math.max(0, crossStoreDebt.balance) : 0
  // Cuánto del exceso (ya descontada la deuda local) va al otro local
  const appliedToCrossDebt = Math.min(excessAfterLocalDebt, crossStoreBalance)
  // Deuda restante en el otro local tras este pago
  const remainingCrossDebt = crossStoreBalance - appliedToCrossDebt
  // Lo que queda después de saldar deuda del otro local → saldo a favor del negocio
  const creditBalance = Math.max(0, excessAfterLocalDebt - crossStoreBalance)

  // Saldo final tras la transacción (positivo = debo, negativo = me deben)
  // En modo cross-local, el exceso cubre primero la deuda del otro local
  const finalBalance = (() => {
    if (totalParsed === null || totalParsed === 0) return 0
    const totalOwed = previousBalance + totalParsed
    const effectivePaid = crossLocalDebt && crossStoreBalance > 0
      ? Math.min(entregadoParsed, totalOwed + crossStoreBalance)
      : entregadoParsed
    return totalOwed - effectivePaid
  })()

  function switchKind(next: ExpenseKind) {
    if (next === kind || isEditing) return
    if (kind === 'provider' && merchLines.length > 0) {
      void persistDraft()
    }
    setKind(next)
    clearError()
  }

  async function persistDraft() {
    if (isEditing || !draftHydrated) return
    if (!hasProviderName) return
    if (merchLines.length === 0) {
      await window.hw.discardMerchVisitDraft()
      onDraftChanged?.()
      return
    }
    await window.hw.saveMerchVisitDraft({
      providerId: selectedProviderId ?? undefined,
      provider: selectedProviderId ? undefined : providerInput.trim(),
      notes: notes.trim() || undefined,
      lines: merchLines,
    })
    onDraftChanged?.()
  }

  async function handleClose() {
    await persistDraft()
    onCancel()
  }

  async function confirmVisit(acceptPriceUpdates: boolean) {
    if (!merchResolved?.ok || !totalParsed) return
    const amountForVisit = Math.min(entregadoParsed, totalParsed)
    const totalPaysOldDebt = crossLocalDebt && crossStoreBalance > 0
      ? appliedToCrossDebt
      : excessOverVisit
    setSaving(true)
    clearError()
    const r = await window.hw.confirmMerchVisit({
      lines: merchResolved.drafts,
      notes: notes.trim() || undefined,
      providerId: selectedProviderId ?? undefined,
      provider: selectedProviderId ? undefined : providerInput.trim(),
      amount: amountForVisit,
      newDebtAmount: autoNewDebt > 0 ? autoNewDebt : undefined,
      paysOldDebt: totalPaysOldDebt > 0 ? totalPaysOldDebt : undefined,
      debtStoreId: crossLocalDebt && debtStoreId ? debtStoreId : undefined,
      acceptPriceUpdates,
      visitKind: intakeKind === 'chicken' || intakeKind === 'media_res' ? intakeKind : 'catalog',
    })
    setSaving(false)
    if (!r.ok) { showError(r.error, 'merch'); setConfirmStep(null); return }
    onDraftChanged?.()
    onSaved?.()
    setConfirmStep(null)
    setReceipt({
      businessName,
      providerName: providerInput.trim(),
      concept: undefined,
      date: new Date().toISOString(),
      visitTotal: totalParsed,
      totalDelivered: entregadoParsed,
      previousBalance,
      oldDebtPaid: autoPaysOldDebt,
      newDebt: displayedNewDebt,
      creditBalance,
      creditApplied: creditAppliedToVisit,
      finalBalance,
      storeName: stores.find(s => s.id === currentStoreId)?.name,
      items: merchVisitReceiptItems(merchResolved.drafts),
    })
  }

  async function confirmMediaRes() {
    if (!merchResolved?.ok) return
    setSaving(true)
    clearError()
    const r = await window.hw.confirmMerchVisit({
      lines: merchResolved.drafts,
      notes: notes.trim() || undefined,
      providerId: selectedProviderId ?? undefined,
      provider: selectedProviderId ? undefined : providerInput.trim(),
      amount: 0,
      acceptPriceUpdates: false,
      visitKind: 'media_res',
    })
    setSaving(false)
    if (!r.ok) { showError(r.error, 'merch'); return }
    onDraftChanged?.()
    onSaved?.()
    setFactsReceipt({
      providerName: providerInput.trim(),
      items: merchVisitReceiptItems(merchResolved.drafts),
    })
  }

  async function handleSubmit() {
    if (kind === 'simple') {
      if (!concept.trim()) {
        showError('Ingresá qué se pagó.', 'concept')
        return
      }
      const amount = parseNumericInput(amountRaw)
      if (!amount || amount <= 0) { showError('Ingresá un monto válido.', 'amount'); return }
      setSaving(true)
      clearError()
      const payload: Parameters<typeof window.hw.registerExpense>[0] = {
        amount,
        notes: notes.trim() || undefined,
        concept: concept.trim(),
      }
      const r = isEditing
        ? await window.hw.updateExpense({ id: editingExpense!.id, ...payload })
        : await window.hw.registerExpense(payload)
      setSaving(false)
      if (!r.ok) { showError(r.error, 'amount'); return }
      onSaved?.()
      onRegistered()
      return
    }

    if (!hasProviderName) { showError('Ingresá el proveedor.', 'provider'); return }
    if (!intakeKind) { showError('Elegí qué trae este proveedor.', 'kind'); return }

    if (intakeKind === 'insumos') {
      if (!concept.trim()) {
        showError('Ingresá qué se pagó.', 'concept')
        return
      }
    }

    if (intakeKind === 'media_res') {
      if (!merchResolved?.ok) {
        showError(merchResolved && 'error' in merchResolved ? merchResolved.error : 'Cargá el kilo de cada media res.', 'merch')
        return
      }
      void confirmMediaRes()
      return
    }

    if (intakeKind === 'chicken' && (!merchResolved?.ok || merchLines.length === 0)) {
      showError(merchResolved && 'error' in merchResolved ? merchResolved.error : 'Cargá los cajones, los kilos y el precio.', 'merch')
      return
    }

    if (!totalParsed || totalParsed <= 0) { showError('Ingresá el total de la visita.', 'amount'); return }

    if (!isEditing && merchLines.length > 0) {
      if (!merchResolved?.ok) {
        showError(merchResolved && 'error' in merchResolved ? merchResolved.error : 'Revisá los productos.', 'merch')
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

    // Entregado 0 / vacío es válido: el proveedor dejó mercadería y no se le pagó nada.

    const amountForVisit = Math.min(entregadoParsed, totalParsed)
    // En modo cross-local, paysOldDebt incluye lo aplicado a la deuda del otro local
    // En modo normal, incluye lo que cancela la deuda del local actual + saldo a favor
    const totalPaysOldDebt = crossLocalDebt && crossStoreBalance > 0
      ? appliedToCrossDebt   // el backend registra como payment event en el otro local
      : excessOverVisit      // en modo normal: cancela deuda local o genera saldo a favor

    setSaving(true)
    clearError()

    const payload: Parameters<typeof window.hw.registerExpense>[0] = {
      amount: amountForVisit,
      notes: notes.trim() || undefined,
      newDebtAmount: autoNewDebt > 0 ? autoNewDebt : undefined,
      paysOldDebt: totalPaysOldDebt > 0 ? totalPaysOldDebt : undefined,
      debtStoreId: crossLocalDebt && debtStoreId ? debtStoreId : undefined,
      concept: intakeKind === 'insumos' ? concept.trim() : undefined,
    }

    if (selectedProviderId) {
      payload.providerId = selectedProviderId
    } else {
      payload.provider = providerInput.trim()
    }

    const r = isEditing
      ? await window.hw.updateExpense({ id: editingExpense!.id, ...payload })
      : await window.hw.registerExpense(payload)
    setSaving(false)

    if (!r.ok) { showError(r.error, 'amount'); return }

    if (!isEditing) {
      await window.hw.discardMerchVisitDraft()
      onDraftChanged?.()
    }

    // Notificar al padre inmediatamente para que refresque el balance,
    // sin esperar a que el usuario cierre el comprobante.
    onSaved?.()

    // Al editar no mostramos comprobante (ya hay un registro previo)
    if (isEditing) { onRegistered(); return }

    // Mostrar comprobante fotográfico
    setReceipt({
      businessName,
      providerName: providerInput.trim(),
      concept: intakeKind === 'insumos' ? concept.trim() || undefined : undefined,
      date: new Date().toISOString(),
      visitTotal: totalParsed,
      totalDelivered: entregadoParsed,
      previousBalance,
      oldDebtPaid: autoPaysOldDebt,
      newDebt: displayedNewDebt,
      creditBalance,
      creditApplied: creditAppliedToVisit,
      finalBalance,
      storeName: stores.find(s => s.id === currentStoreId)?.name,
      items: merchResolved?.ok ? merchVisitReceiptItems(merchResolved.drafts) : [],
    })
  }

  // ── COMPROBANTE ────────────────────────────────────────────────────────
  if (factsReceipt) {
    return (
      <Modal
        open
        onClose={onRegistered}
        title="Visita registrada"
        size="md"
        footer={(
          <Button variant="primary" onClick={onRegistered}>Cerrar</Button>
        )}
      >
        <div className="space-y-3">
          <p className="min-w-0 truncate text-sm font-medium text-ink" title={factsReceipt.providerName}>
            {factsReceipt.providerName}
          </p>
          {factsReceipt.items.length > 0 ? (
            <ul className="max-h-[11.5rem] overflow-y-auto [scrollbar-gutter:stable] divide-y divide-line rounded-xl border border-line bg-raised/40 px-4">
              {factsReceipt.items.map((item, i) => (
                <li key={`${item.name}-${i}`} className="flex items-baseline justify-between gap-3 py-2 min-w-0">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink" title={item.name}>{item.name}</span>
                  <span className="shrink-0 tabular-nums text-sm text-muted" title={item.qty}>{item.qty}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Modal>
    )
  }

  if (receipt) {
    const isCreditBalance = receipt.finalBalance < 0
    const isDebtBalance = receipt.finalBalance > 0
    const isSettled = receipt.finalBalance === 0
    const storeLabel = receipt.storeName
      ? `Saldo en ${receipt.storeName}`
      : 'Saldo de este local'

    return (
      <PaymentReceipt
        businessName={receipt.businessName}
        date={receipt.date}
        providerName={receipt.providerName}
        concept={receipt.concept}
        items={receipt.items}
        onClose={onRegistered}
        resultClassName={
          isCreditBalance
            ? 'bg-success/10 border border-success/30'
            : isDebtBalance
              ? 'border border-amber-500/30 bg-amber-500/10'
              : 'bg-success/10 border border-success/30'
        }
        result={
          isSettled ? (
            <>
              <p className="text-xs font-semibold text-success uppercase tracking-wide">{storeLabel}</p>
              <p className="text-2xl font-bold text-success mt-1">Sin deuda</p>
              {receipt.creditApplied > 0 && (
                <p className="text-[11px] text-success mt-1 leading-relaxed">
                  La visita de {formatARS(receipt.visitTotal)} no quedó en deuda porque se aplicó
                  saldo a favor de {formatARS(receipt.creditApplied)}
                  {receipt.totalDelivered > 0
                    ? ` y se entregaron ${formatARS(receipt.totalDelivered)}`
                    : ' (no se entregó efectivo)'}
                  .
                </p>
              )}
            </>
          ) : isDebtBalance ? (
            <>
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">{storeLabel}</p>
              <p className="text-2xl font-bold text-amber-600 mt-1">{formatARS(receipt.finalBalance)}</p>
              {receipt.newDebt > 0 && receipt.previousBalance > 0 && receipt.newDebt !== receipt.finalBalance && (
                <p className="text-[11px] text-amber-600/80 mt-0.5">
                  De esta visita: {formatARS(receipt.newDebt)}
                </p>
              )}
              {receipt.creditApplied > 0 && (
                <p className="text-[11px] text-success mt-1">
                  Ya se descontó saldo a favor de {formatARS(receipt.creditApplied)}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-success uppercase tracking-wide">{storeLabel}</p>
              <p className="text-2xl font-bold text-success mt-1">
                A favor {formatARS(Math.abs(receipt.finalBalance))}
              </p>
              <p className="text-[11px] text-success/80 mt-0.5">el proveedor deberá descontar en próxima visita</p>
            </>
          )
        }
      >
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Total de la visita</span>
            <span className="font-semibold text-ink">{formatARS(receipt.visitTotal)}</span>
          </div>

          {receipt.previousBalance > 0 && (
            <div className="flex justify-between text-danger">
              <span>Deuda anterior de este local</span>
              <span className="font-semibold tabular-nums">{formatARS(receipt.previousBalance)}</span>
            </div>
          )}

          <div className="flex justify-between border-t border-line pt-2">
            <span className="font-medium text-muted">Total entregado</span>
            <span className="font-bold text-ink">{formatARS(receipt.totalDelivered)}</span>
          </div>

          {receipt.creditApplied > 0 && (
            <div className="flex justify-between text-success">
              <span>Saldo a favor aplicado</span>
              <span className="font-semibold">− {formatARS(receipt.creditApplied)}</span>
            </div>
          )}
        </div>
      </PaymentReceipt>
    )
  }

  if (confirmStep === 'prices') {
    return (
      <Modal open onClose={() => setConfirmStep(null)} title="Precios de compra" size="md">
        <p className="text-sm text-muted">Estos precios son distintos a la última visita. ¿Los recordamos para la próxima?</p>
        <ul className="mt-3 space-y-2">
          {priceChanges.map(c => (
            <li key={c.productKey} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={c.name}>{c.name}</span>
              <span className="shrink-0 tabular-nums text-muted">{formatARS(c.previous)} → {formatARS(c.next)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => { acceptPriceUpdatesRef.current = false; setConfirmStep('summary') }}>
            Usar ahora, no cambiar
          </Button>
          <Button variant="primary" onClick={() => { acceptPriceUpdatesRef.current = true; setConfirmStep('summary') }}>
            Recordar los nuevos
          </Button>
        </div>
      </Modal>
    )
  }

  if (confirmStep === 'summary' && merchResolved?.ok) {
    const summaryLines = merchResolved.drafts.flatMap((d, i) => {
      const r = resolveMerchVisitLine(d, { id: String(i), sortOrder: i })
      return r.ok ? [r.line] : []
    })
    return (
      <Modal
        open
        onClose={() => setConfirmStep(null)}
        title="Confirmar visita"
        size="md"
        footer={(
          <>
            <Button variant="secondary" className="mr-auto" onClick={() => setConfirmStep(null)}>Volver</Button>
            <Button variant="primary" loading={saving} onClick={() => void confirmVisit(acceptPriceUpdatesRef.current)}>
              Confirmar
            </Button>
          </>
        )}
      >
        <ul className="space-y-1 text-sm">
          {summaryLines.map(line => (
            <li key={line.id} className="flex items-center justify-between gap-2 min-w-0">
              <span className="min-w-0 flex-1 truncate" title={line.rubroName}>{line.rubroName}</span>
              <span className="shrink-0 tabular-nums text-muted">{formatARS(line.costTotal)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm font-semibold">Total {formatARS(totalParsed ?? 0)} · Entregado {formatARS(entregadoParsed)}</p>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </Modal>
    )
  }

  // ── FORMULARIO ────────────────────────────────────────────────────────
  return (
    <Modal
      open
      onClose={() => { void handleClose() }}
      closeOnOverlay={!saving}
      closeOnEscape={!saving}
      title={isEditing ? 'Editar gasto' : 'Gastos'}
      size="lg"
      frame={showVisitFields ? 'workspace' : 'hug'}
      footer={(
        <>
          <div className="mr-auto flex min-w-0 flex-1 items-center gap-3">
            {error && (
              <p role="alert" className="min-w-0 flex-1 truncate text-sm font-medium text-danger" title={error}>
                {error}
              </p>
            )}
            <Button variant="secondary" onClick={() => { void handleClose() }} disabled={saving}>
              Cerrar
            </Button>
          </div>
          {kind === 'provider' && merchLines.length > 0 && !isEditing && (
            <Button variant="secondary" disabled={saving} onClick={() => {
              void window.hw.discardMerchVisitDraft().then(() => {
                onDraftChanged?.()
                onCancel()
              })
            }}>
              Descartar visita
            </Button>
          )}
          <Button variant="primary" onClick={() => void handleSubmit()} loading={saving}>
            {isEditing ? 'Actualizar' : intakeKind === 'media_res' ? 'Registrar kilos' : 'Registrar'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        {!isEditing && (
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-app p-1" role="tablist" aria-label="Tipo de registro">
            {([
              { id: 'provider' as const, label: 'Proveedor' },
              { id: 'simple' as const, label: 'Gasto' },
            ]).map(opt => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={kind === opt.id}
                onClick={() => switchKind(opt.id)}
                className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                  kind === opt.id
                    ? 'bg-panel text-ink shadow-[0_1px_2px_rgba(28,28,30,0.12)]'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        <CollapseReveal open={kind === 'provider'}>
        <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm text-muted">Proveedor</label>
          <input
            ref={providerInputRef}
            type="text"
            value={providerInput}
            onChange={e => handleProviderInputChange(e.target.value)}
            onFocus={() => { if (providerInteractedRef.current) setShowProviderSuggestions(true) }}
            onClick={() => { providerInteractedRef.current = true; setShowProviderSuggestions(true) }}
            onBlur={() => setTimeout(() => setShowProviderSuggestions(false), 150)}
            placeholder="Nombre del proveedor…"
            maxLength={100}
            autoComplete="off"
            className={fieldClass(errorField === 'provider')}
          />
          <SuggestPopover
            anchorRef={providerInputRef}
            open={showProviderSuggestions && listedProviders.length > 0 && !showVisitFields}
          >
            <ul>
              {listedProviders.map(p => (
                <li
                  key={p.id}
                  onMouseDown={e => { e.preventDefault(); selectProviderFromList(p) }}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-hover flex items-center gap-2"
                >
                  <span className="flex-1 min-w-0 truncate" title={p.name}>{p.name}</span>
                  {p.phone && (
                    <span className="shrink-0 text-xs text-muted" title={formatPhoneInput(p.phone)}>
                      {formatPhoneInput(p.phone)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </SuggestPopover>
          {showVisitFields && (
            <p className="min-h-[1rem] text-[11px] text-muted" aria-live="polite">
              {loadingDebt ? 'Consultando deuda…' : null}
            </p>
          )}
        </div>

        {showVisitFields && hasProviderDebt && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-danger">Deuda anterior</p>
              <span className="shrink-0 text-sm font-bold tabular-nums text-danger">{formatARS(previousDebt)}</span>
            </div>
            <p className="mt-1 text-[11px] text-danger/80">
              Si entregás más que el total, el excedente cancela esta deuda.
            </p>
            {isAdminAdjustNote(providerDebt?.lastEventNotes) && (
              <p className="mt-1 text-[11px] text-ink/80" title={providerDebt?.lastEventNotes ?? undefined}>
                {providerDebt?.lastEventNotes}
              </p>
            )}
          </div>
        )}
        {showVisitFields && hasProviderCredit && (
          <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-3">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-success">Saldo a favor</p>
              <span className="shrink-0 text-sm font-bold tabular-nums text-success">{formatARS(previousCredit)}</span>
            </div>
            <p className="mt-1 text-[11px] text-success">Se descuenta solo de esta visita.</p>
            {isAdminAdjustNote(providerDebt?.lastEventNotes) && (
              <p className="mt-1 text-[11px] text-ink/80" title={providerDebt?.lastEventNotes ?? undefined}>
                {providerDebt?.lastEventNotes}
              </p>
            )}
          </div>
        )}

        {showVisitFields && !isEditing && (
          <div className={errorField === 'kind' ? 'rounded-xl ring-2 ring-danger' : undefined}>
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
          </div>
        )}

        {showVisitFields && !isEditing && intakeKind === 'catalog' && (
          <ProviderVisitMerchBlock
            products={catalog}
            lastPrices={lastPrices}
            lines={merchLines}
            onChange={lines => { setMerchLines(lines); clearError() }}
            invalid={errorField === 'merch'}
          />
        )}
        {showVisitFields && !isEditing && intakeKind === 'media_res' && (
          <div className={errorField === 'merch' ? 'rounded-xl ring-2 ring-danger' : undefined}>
            <MediaResVisitForm lines={merchLines} onChange={lines => { setMerchLines(lines); clearError() }} />
          </div>
        )}
        {showVisitFields && !isEditing && intakeKind === 'chicken' && (
          <div className={errorField === 'merch' ? 'rounded-xl ring-2 ring-danger' : undefined}>
            <ChickenVisitForm lines={merchLines} lastPrices={lastPrices} onChange={lines => { setMerchLines(lines); clearError() }} />
          </div>
        )}

        {(showVisitFields && intakeKind === 'insumos') && (
        <div className="space-y-1">
          <label className="text-sm text-muted">Qué se pagó</label>
          <input
            ref={insumosConceptRef}
            type="text"
            value={concept}
            onChange={e => handleConceptChange(e.target.value)}
            placeholder="Bolsas, limpieza…"
            maxLength={80}
            autoComplete="off"
            onFocus={handleConceptFocus}
            onClick={handleConceptClick}
            onBlur={() => setTimeout(() => setShowConceptSuggestions(false), 150)}
            className={fieldClass(errorField === 'concept')}
          />
          <SuggestPopover
            anchorRef={insumosConceptRef}
            open={showVisitFields && intakeKind === 'insumos' && showConceptSuggestions && listedConcepts.length > 0}
          >
            <ul>
              {listedConcepts.map(s => (
                <li
                  key={s}
                  onMouseDown={e => { e.preventDefault(); setConcept(s); setShowConceptSuggestions(false) }}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-hover"
                >
                  {s}
                </li>
              ))}
            </ul>
          </SuggestPopover>
        </div>
        )}

        {showVisitFields && intakeKind && intakeKind !== 'media_res' && (
          <div className="space-y-3">
            {merchLines.length === 0 && (intakeKind === 'catalog' || intakeKind === 'insumos') ? (
            <div className="space-y-1">
              <label className="text-sm text-muted">Total de la visita ($)</label>
              <NumericInput
                value={totalRaw}
                onChange={v => { setTotalRaw(v); clearError() }}
                placeholder="0"
                className={fieldClass(errorField === 'amount')}
              />
            </div>
            ) : (
            <p className="text-sm text-muted">
              Total de la visita:{' '}
              <span className="font-semibold tabular-nums text-ink">{formatARS(totalParsed ?? 0)}</span>
            </p>
            )}

            <div className="space-y-1">
              <label className="text-sm text-muted">Entregado al proveedor ($)</label>
              <NumericInput
                value={amountRaw}
                onChange={v => { setAmountRaw(v); clearError() }}
                placeholder="0"
                className={FIELD}
              />
              <p className="text-[11px] text-muted">Vacío = queda debiendo. Si das de más, se aplica a deuda anterior.</p>
            </div>

            {totalParsed !== null && totalParsed > 0 && (
              <div className={`space-y-1.5 rounded-xl border px-4 py-3 ${
                finalBalance > 0 || remainingCrossDebt > 0
                  ? 'border-amber-500/30 bg-amber-500/10'
                  : 'border-success/30 bg-success/10'
              }`}>
                {previousDebt > 0 && (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted">Deuda anterior</span>
                    <span className="tabular-nums text-ink">{formatARS(previousDebt)}</span>
                  </div>
                )}

                {previousDebt > 0 ? (
                  displayedNewDebt > 0 && (
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted">De esta visita</span>
                      <span className="tabular-nums text-ink">{formatARS(displayedNewDebt)}</span>
                    </div>
                  )
                ) : (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted">Esta visita</span>
                    <span className="tabular-nums text-ink">{formatARS(totalParsed)}</span>
                  </div>
                )}

                {creditAppliedToVisit > 0 && (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-success">Saldo a favor aplicado</span>
                    <span className="font-semibold tabular-nums text-success">− {formatARS(creditAppliedToVisit)}</span>
                  </div>
                )}

                {autoPaysOldDebt > 0 && (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-success">Deuda anterior saldada</span>
                    <span className="tabular-nums text-success">− {formatARS(autoPaysOldDebt)}</span>
                  </div>
                )}

                {finalBalance > 0 && (
                  <div className="flex items-center justify-between gap-2 border-t border-line pt-1.5 text-sm">
                    <span className="font-medium text-ink">Saldo de este local</span>
                    <span className="text-lg font-bold tabular-nums text-ink">{formatARS(finalBalance)}</span>
                  </div>
                )}

                {crossLocalDebt && crossStoreBalance > 0 && appliedToCrossDebt > 0 && (
                  <div className="flex items-center justify-between gap-2 border-t border-line pt-1.5 text-sm">
                    <span className="text-success">Deuda otro local pagada</span>
                    <span className="tabular-nums text-success">− {formatARS(appliedToCrossDebt)}</span>
                  </div>
                )}

                {crossLocalDebt && remainingCrossDebt > 0 && (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-ink">Deuda otro local restante</span>
                    <span className="font-bold tabular-nums text-ink">{formatARS(remainingCrossDebt)}</span>
                  </div>
                )}

                {crossLocalDebt && crossStoreBalance > 0 && remainingCrossDebt === 0 && appliedToCrossDebt > 0 && creditBalance === 0 && autoNewDebt === 0 && (
                  <div className="text-sm font-medium text-success">Deuda del otro local saldada</div>
                )}

                {creditBalance > 0 && creditBalance !== Math.abs(Math.min(0, finalBalance)) && (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-success">Exceso de este pago</span>
                    <span className="font-semibold tabular-nums text-success">+ {formatARS(creditBalance)}</span>
                  </div>
                )}

                {finalBalance < 0 && (
                  <div className="flex items-center justify-between gap-2 border-t border-line pt-1.5 text-sm">
                    <span className="font-medium text-success">Saldo de este local</span>
                    <span className="text-lg font-bold tabular-nums text-success">A favor {formatARS(-finalBalance)}</span>
                  </div>
                )}

                {finalBalance === 0 && creditBalance === 0 && displayedNewDebt === 0 && (!crossLocalDebt || remainingCrossDebt === 0) && (
                  <div className="text-sm font-medium text-success">Este local queda sin deuda</div>
                )}
              </div>
            )}
          </div>
        )}

        {showVisitFields && intakeKind !== 'media_res' && currentStoreId && stores.filter(s => s.id !== currentStoreId).length > 0 && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={crossLocalDebt}
                onChange={e => {
                  const checked = e.target.checked
                  setCrossLocalDebt(checked)
                  if (checked && (!debtStoreId || debtStoreId === currentStoreId)) {
                    const otherStores = stores.filter(s => s.id !== currentStoreId)
                    setDebtStoreId(otherStores[0]?.id ?? '')
                  }
                }}
                className="rounded border-line bg-raised text-accent focus:ring-accent focus:ring-offset-panel"
              />
              <span className="text-sm text-muted">
                El pago corresponde a deuda de otro local
              </span>
            </label>
            {crossLocalDebt && (
              <div className="space-y-1">
                <label className="text-xs text-muted">Local al que se imputa la deuda</label>
                <select
                  value={debtStoreId}
                  onChange={e => setDebtStoreId(e.target.value)}
                  className={FIELD}
                >
                  {stores.filter(s => s.id !== currentStoreId).map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted">
                  Sale de esta caja; la deuda queda en el local elegido.
                </p>
                {/* Deuda del otro local con este proveedor */}
                {matchedProviderId && (
                  <div className="mt-1">
                    {loadingCrossDebt ? (
                      <p className="text-xs text-muted">Consultando deuda...</p>
                    ) : crossStoreDebt && crossStoreDebt.balance > 0 ? (
                      // Solo mostrar el cuadro si la deuda no queda cubierta por el pago actual.
                      // Si ya está saldada, el resumen de arriba lo indica y este cuadro sería ruido visual.
                      remainingCrossDebt > 0 ? (
                        <div className="rounded-lg px-3 py-2 bg-danger/10 border border-danger/30">
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-danger">Deuda pendiente de ese local</span>
                            <span className="text-sm font-bold text-danger">{formatARS(remainingCrossDebt)}</span>
                          </div>
                          <p className="text-[11px] text-danger/80 mt-0.5">
                            Este pago no alcanza para saldarla.
                          </p>
                        </div>
                      ) : null
                    ) : crossStoreDebt && crossStoreDebt.balance < 0 ? (
                      <p className="text-[11px] text-success mt-1">
                        Ese local tiene saldo a favor {formatARS(-crossStoreDebt.balance)}.
                      </p>
                    ) : crossStoreDebt && crossStoreDebt.balance <= 0 ? (
                      <p className="text-[11px] text-success/70 mt-1">Sin deuda pendiente en ese local.</p>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        </div>
        </CollapseReveal>

        <CollapseReveal open={kind === 'simple'}>
        <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm text-muted">Qué se pagó</label>
          <input
            ref={conceptInputRef}
            type="text"
            value={concept}
            onChange={e => handleConceptChange(e.target.value)}
            placeholder="Bolsas, limpieza…"
            maxLength={80}
            autoComplete="off"
            onFocus={handleConceptFocus}
            onClick={handleConceptClick}
            onBlur={() => setTimeout(() => setShowConceptSuggestions(false), 150)}
            className={fieldClass(errorField === 'concept')}
          />
          <SuggestPopover
            anchorRef={conceptInputRef}
            open={kind === 'simple' && showConceptSuggestions && listedConcepts.length > 0}
          >
            <ul>
              {listedConcepts.map(s => (
                <li
                  key={s}
                  onMouseDown={e => { e.preventDefault(); setConcept(s); setShowConceptSuggestions(false) }}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-hover"
                >
                  {s}
                </li>
              ))}
            </ul>
          </SuggestPopover>
        </div>
        <div className="space-y-1">
          <label className="text-sm text-muted">Monto ($)</label>
          <NumericInput
            value={amountRaw}
            onChange={v => { setAmountRaw(v); clearError() }}
            placeholder="0"
            className={fieldClass(errorField === 'amount')}
          />
        </div>
        </div>
        </CollapseReveal>

        <div className="space-y-1">
          <label className="text-sm text-muted">{kind === 'provider' ? 'Observaciones' : 'Notas'}</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={kind === 'provider' ? 'Observaciones…' : undefined}
            maxLength={300}
            className={FIELD}
          />
        </div>

      </div>
    </Modal>
  )
}
