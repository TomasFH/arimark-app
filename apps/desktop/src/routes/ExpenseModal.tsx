/**
 * Modal para registrar un gasto durante el turno activo.
 *
 * Tres modos excluyentes:
 *   - Otros: qué se pagó + monto. Sin proveedor ni mercadería.
 *   - Proveedor: quién trajo mercadería, renglones, entregado / deuda.
 *   - Entró y no se pagó acá: piezas y kilos, fuera del total de caja.
 * El concepto no se pide en una visita: el proveedor identifica el registro.
 * Autocomplete de proveedores (LIST_PROVIDERS). Nombre nuevo se crea al guardar.
 * Deuda pendiente: el exceso entregado se aplica solo. Comprobante al confirmar.
 */
import { useEffect, useRef, useState, useCallback, type KeyboardEvent } from 'react'
import NumericInput from '../components/NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import { formatPhoneInput } from '../lib/phoneInput'
import PaymentReceipt from '../components/PaymentReceipt'
import { isAdminAdjustNote } from '../lib/providerLedgerNotes'
import { Button, CollapseReveal, Modal, SuggestPopover } from '../components/ui'
import { namedSuggest } from '../lib/namedSuggest'
import type { ExpenseRow, ProviderDebtRow, ProviderRow, StoreRow } from '../types/hw-api'
import ProviderVisitMerchBlock, { type PurchaseMemoryMap, type VisitCatalogProduct } from './ProviderVisitMerchBlock'
import {
  emptyMediaResFormLine,
  isPieceArrivalFormLine,
  formatPurchaseUnitCost,
  formatRecallCostUnit,
  formatWeighMode,
  merchProductKey,
  merchVisitReceiptItems,
  productsForCatalogIntake,
  purchaseRecallChanges,
  resolveMerchVisitLine,
  visitLinesFromForm,
  type MerchVisitFormLine,
  type MerchVisitReceiptItem,
  type PurchaseRecallChange,
} from '@carniceria/shared'
import { MediaResVisitForm } from './ProviderVisitKindUi'

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

/** border-success/30 cae a currentColor (blanco en oscuro). El borde es el gris del sistema. */
const successNoticeClass =
  'border-line-strong bg-[color-mix(in_srgb,var(--success)_12%,transparent)]'

function markedIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return ((index % count) + count) % count
}

function kindFromExpense(expense: ExpenseRow | undefined): ExpenseKind {
  if (!expense) return 'provider'
  return expense.providerId || expense.provider ? 'provider' : 'simple'
}

function isUnpaidPieceLine(line: MerchVisitFormLine): boolean {
  return isPieceArrivalFormLine(line)
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
  const [providerHighlight, setProviderHighlight] = useState(0)
  const providerInteractedRef = useRef(false)

  // --- Concepto ---
  const [kind, setKind] = useState<ExpenseKind>(() => kindFromExpense(editingExpense))
  const [concept, setConcept] = useState(editingExpense?.concept ?? '')
  const [conceptSuggestions, setConceptSuggestions] = useState<string[]>([])
  const [showConceptSuggestions, setShowConceptSuggestions] = useState(false)
  const [conceptHighlight, setConceptHighlight] = useState(0)
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

  // Gasto de una visita confirmada: la deuda de la mercadería no se renegocia.
  // Entregado arranca en lo ya pagado de la visita más la deuda anterior que
  // este gasto ya saldó. Lo que se sume encima paga deuda anterior.
  const editingVisit = editingExpense?.visit
  const visitPaidLocked = Math.max(0, editingVisit?.paidAmount ?? 0)
  const visitDebtLocked = Math.max(0, editingVisit?.debtAmount ?? 0)
  const editingPaysOld = editingExpense?.paysOldDebt ?? 0
  const editingCashOut = editingVisit
    ? visitPaidLocked + editingPaysOld
    : (editingExpense?.amount ?? 0)
  const editingVisitTotal = editingVisit
    ? visitPaidLocked + visitDebtLocked
    : editingExpense
      ? Math.max(0, (editingExpense.amount ?? 0) - editingPaysOld) + (editingExpense.newDebtAmount ?? 0)
      : 0

  // --- Montos ---
  const [totalRaw, setTotalRaw] = useState(() => (
    editingVisitTotal > 0 ? String(editingVisitTotal) : ''
  ))
  const [amountRaw, setAmountRaw] = useState(() => (
    editingCashOut > 0 ? String(editingCashOut) : ''
  ))
  const [notes, setNotes] = useState(editingExpense?.notes ?? '')
  const [merchLines, setMerchLines] = useState<MerchVisitFormLine[]>([])
  const [catalog, setCatalog] = useState<VisitCatalogProduct[]>([])
  const [memory, setMemory] = useState<PurchaseMemoryMap>({})
  const [confirmStep, setConfirmStep] = useState<'prices' | 'summary' | null>(null)
  const [recallChanges, setRecallChanges] = useState<PurchaseRecallChange[]>([])
  const [suppliesOnly, setSuppliesOnly] = useState(false)
  const [unpaidArrival, setUnpaidArrival] = useState(false)
  const [paymentChannel, setPaymentChannel] = useState<'cash' | 'digital'>('cash')
  const [draftHydrated, setDraftHydrated] = useState(!!editingExpense)
  const acceptPriceUpdatesRef = useRef(true)
  const requestIdRef = useRef<string | null>(null)

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
        if (r.data.lines.length > 0 && r.data.lines.every(isUnpaidPieceLine)) setUnpaidArrival(true)
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
    setConceptHighlight(0)
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
    if (!currentStoreId) return
    void window.hw.getAllProducts(currentStoreId).then(r => {
      if (!r.ok) return
      setCatalog(productsForCatalogIntake(r.data.filter(p => p.active && p.available)).map(p => ({
        id: p.id,
        name: p.name,
        unit: p.unit,
        pluNumber: p.pluNumber,
        purchasePackLabel: p.purchasePackLabel,
        purchasePackContents: p.purchasePackContents,
      })))
    })
  }, [currentStoreId])

  useEffect(() => {
    if (!selectedProviderId) {
      setMemory({})
      return
    }
    void window.hw.getProviderPurchasePrices({ providerId: selectedProviderId }).then(r => {
      if (!r.ok) return
      const map: PurchaseMemoryMap = {}
      for (const row of r.data) {
        map[row.productKey] = {
          unitCost: row.unitCost,
          costUnit: row.costUnit,
          packContents: row.packContents ?? null,
          weighMode: row.weighMode ?? null,
        }
      }
      setMemory(map)
    })
  }, [selectedProviderId])

  function selectProviderFromList(p: ProviderRow) {
    setProviderInput(p.name)
    if (p.id !== selectedProviderId) setProviderDebt(null)
    setSelectedProviderId(p.id)
    const pieceVisit = p.intakeKind === 'media_res'
      && (merchLines.length === 0 || merchLines.every(isUnpaidPieceLine))
    setUnpaidArrival(pieceVisit)
    setSuppliesOnly(!pieceVisit && p.intakeKind === 'insumos')
    setConcept(p.intakeKind === 'insumos' ? (p.supplyConcept ?? '') : '')
    if (pieceVisit && merchLines.length === 0) setMerchLines([emptyMediaResFormLine()])
    setShowProviderSuggestions(false)
  }

  function handleProviderInputChange(value: string) {
    setProviderInput(value)
    clearError()

    const exact = namedSuggest(providerSuggestions, value, p => p.name).exact
    if (exact) {
      selectProviderFromList(exact)
      return
    }

    setSelectedProviderId(null)
    setProviderDebt(null)
    setSuppliesOnly(false)
    setUnpaidArrival(false)
    setConcept('')
    setProviderHighlight(0)
    setShowProviderSuggestions(true)
  }

  function moveSuggest(
    event: KeyboardEvent<HTMLInputElement>,
    open: boolean,
    count: number,
    highlight: number,
    setHighlight: (index: number) => void,
    openList: () => void,
    closeList: () => void,
    pick: (index: number) => void,
  ) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open || count <= 0) {
        openList()
        setHighlight(0)
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      setHighlight(markedIndex(highlight + step, count))
      return
    }
    if (!open || count <= 0) return
    if (event.key === 'Enter') {
      event.preventDefault()
      pick(markedIndex(highlight, count))
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeList()
    }
  }

  useEffect(() => {
    if (selectedProviderId || providerSuggestions.length === 0) return
    const exact = namedSuggest(providerSuggestions, providerInput, p => p.name).exact
    if (exact) selectProviderFromList(exact)
  }, [providerSuggestions])

  const hasProviderName = providerInput.trim().length > 0
  const providerResolved = selectedProviderId != null || exactProvider != null
  const isNewProvider = providersLoaded && hasProviderName && !providerResolved && listedProviders.length === 0
  const showVisitFields = kind === 'provider' && (providerResolved || isNewProvider)
  const providerListOpen = showProviderSuggestions && listedProviders.length > 0 && !showVisitFields
  const conceptListOpen = showConceptSuggestions && listedConcepts.length > 0
  const providerMarked = markedIndex(providerHighlight, listedProviders.length)
  const conceptMarked = markedIndex(conceptHighlight, listedConcepts.length)
  const merchResolved = !suppliesOnly && !isEditing && merchLines.length > 0 ? visitLinesFromForm(merchLines) : null
  const merchTotal = merchResolved?.ok ? merchResolved.total : null
  const totalParsed = showVisitFields
    ? (isEditing || suppliesOnly ? (parseNumericInput(totalRaw) ?? 0) : (merchTotal ?? 0))
    : null
  const entregadoParsed = parseNumericInput(amountRaw) ?? 0
  const previousBalance = (() => {
    const live = providerDebt?.balance ?? 0
    if (!editingVisit || !editingExpense) return live
    const ownNet = (editingExpense.newDebtAmount ?? 0) - (editingExpense.paysOldDebt ?? 0)
    return live - ownNet
  })()
  const previousDebt = Math.max(0, previousBalance)
  const previousCredit = Math.max(0, -previousBalance)
  const hasProviderDebt = previousDebt > 0
  const hasProviderCredit = previousCredit > 0

  // Deuda nueva generada por esta visita. En una visita ya confirmada, ese
  // número es el de la visita: entregado no lo achica.
  const autoNewDebt = editingVisit
    ? visitDebtLocked
    : totalParsed !== null
      ? Math.max(0, totalParsed - entregadoParsed)
      : 0

  // El saldo a favor del local se descuenta solo de esta visita (el ledger ya lo tiene).
  const creditAppliedToVisit = editingVisit ? 0 : Math.min(previousCredit, autoNewDebt)
  const displayedNewDebt = Math.max(0, autoNewDebt - creditAppliedToVisit)

  // Exceso sobre lo ya pagado de la visita → deuda anterior o saldo a favor.
  const excessOverVisit = editingVisit
    ? Math.max(0, entregadoParsed - visitPaidLocked)
    : totalParsed !== null
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
    if (totalParsed === null) return 0
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

  function visitLedgerPayload() {
    const paysForeignDebt = crossLocalDebt && crossStoreBalance > 0
    if (editingVisit) {
      const paysOld = Math.max(0, entregadoParsed - visitPaidLocked)
      return {
        amount: visitPaidLocked,
        newDebtAmount: visitDebtLocked > 0 ? visitDebtLocked : undefined,
        paysOldDebt: paysOld > 0 ? paysOld : undefined,
        debtStoreId: crossLocalDebt && debtStoreId ? debtStoreId : undefined,
        crossStorePayment: paysForeignDebt && paysOld > 0 ? appliedToCrossDebt : undefined,
      }
    }
    const amountForVisit = Math.min(entregadoParsed, totalParsed ?? 0)
    return {
      amount: amountForVisit,
      newDebtAmount: autoNewDebt > 0 ? autoNewDebt : undefined,
      paysOldDebt: excessOverVisit > 0 ? excessOverVisit : undefined,
      debtStoreId: crossLocalDebt && debtStoreId ? debtStoreId : undefined,
      // El otro local solo recibe su parte. El exceso de este local entra en
      // paysOldDebt (sale de caja) pero el handler lo imputa a la sesión.
      crossStorePayment: paysForeignDebt && excessOverVisit > 0 ? appliedToCrossDebt : undefined,
    }
  }

  function visitRequestId(): string {
    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID()
    return requestIdRef.current
  }

  async function rememberVisitShape(kind: 'insumos' | 'catalog', supplyConcept?: string) {
    const r = await window.hw.setProviderIntakeKind({
      providerId: selectedProviderId ?? undefined,
      provider: selectedProviderId ? undefined : providerInput.trim(),
      intakeKind: kind,
      supplyConcept: kind === 'insumos' ? supplyConcept : undefined,
    })
    if (!r.ok) return
    setProviderSuggestions(prev => [r.data, ...prev.filter(p => p.id !== r.data.id)])
    setSelectedProviderId(r.data.id)
  }

  function selectVisitTab(tab: 'goods' | 'supplies' | 'unpaid') {
    setPaymentChannel('cash')
    clearError()
    if (tab === 'supplies') {
      setUnpaidArrival(false)
      setSuppliesOnly(true)
      if (!concept.trim()) {
        const current = providerSuggestions.find(p => p.id === (selectedProviderId ?? exactProvider?.id))
        if (current?.supplyConcept) setConcept(current.supplyConcept)
      }
      return
    }
    if (tab === 'unpaid') {
      setSuppliesOnly(false)
      setUnpaidArrival(true)
      setMerchLines(current => (
        current.length > 0 && current.every(isUnpaidPieceLine) ? current : [emptyMediaResFormLine()]
      ))
      return
    }
    setSuppliesOnly(false)
    setUnpaidArrival(false)
    setMerchLines(current => (current.every(isUnpaidPieceLine) ? [] : current))
  }

  async function confirmUnpaid() {
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
      clientRequestId: visitRequestId(),
      paymentChannel: 'cash',
      visitKind: 'media_res',
    })
    setSaving(false)
    if (!r.ok) { showError(r.error, 'merch'); return }
    onDraftChanged?.()
    onSaved?.()
    onRegistered()
  }

  async function confirmVisit(acceptPriceUpdates: boolean) {
    if (!merchResolved?.ok) return
    setSaving(true)
    clearError()
    const r = await window.hw.confirmMerchVisit({
      lines: merchResolved.drafts,
      notes: notes.trim() || undefined,
      providerId: selectedProviderId ?? undefined,
      provider: selectedProviderId ? undefined : providerInput.trim(),
      ...visitLedgerPayload(),
      acceptPriceUpdates,
      clientRequestId: visitRequestId(),
      paymentChannel,
      visitKind: 'catalog',
    })
    setSaving(false)
    if (!r.ok) { showError(r.error, 'merch'); setConfirmStep(null); return }
    await rememberVisitShape('catalog')
    onDraftChanged?.()
    onSaved?.()
    setConfirmStep(null)
    setReceipt({
      businessName,
      providerName: providerInput.trim(),
      concept: undefined,
      date: new Date().toISOString(),
      visitTotal: totalParsed ?? 0,
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

    if (unpaidArrival) {
      if (!merchResolved?.ok) {
        showError(
          merchResolved && 'error' in merchResolved ? merchResolved.error : 'Cargá el kilo de cada media res.',
          'merch',
        )
        return
      }
      await confirmUnpaid()
      return
    }

    if (suppliesOnly) {
      if (!concept.trim()) {
        showError('Ingresá qué se pagó.', 'concept')
        return
      }
    } else if (!isEditing) {
      if (merchLines.length === 0) {
        showError('Agregá lo que llegó.', 'merch')
        return
      }
      if (!merchResolved?.ok) {
        showError(merchResolved && 'error' in merchResolved ? merchResolved.error : 'Revisá los productos.', 'merch')
        return
      }
      const changes = purchaseRecallChanges(
        merchResolved.drafts.filter(d => !d.notForSale && d.unitCost > 0 && d.costUnit).map(d => ({
          productKey: merchProductKey(d.productId, d.name),
          name: d.name,
          unitCost: d.unitCost,
          costUnit: d.costUnit ?? null,
          packContents: d.costUnit === 'pack' ? d.purchasePackContents : null,
          weighMode: d.weighMode ?? null,
        })),
        memory,
      )
      setRecallChanges(changes)
      setConfirmStep(changes.length > 0 ? 'prices' : 'summary')
      return
    }

    if (!editingVisit && (isEditing || suppliesOnly) && (!totalParsed || totalParsed <= 0)) {
      showError('Ingresá el total de la visita.', 'amount')
      return
    }

    setSaving(true)
    clearError()

    const payload: Parameters<typeof window.hw.registerExpense>[0] = {
      ...visitLedgerPayload(),
      notes: notes.trim() || undefined,
      concept: suppliesOnly ? concept.trim() : undefined,
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

    if (!isEditing && suppliesOnly) await rememberVisitShape('insumos', concept.trim())

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
      concept: suppliesOnly ? concept.trim() || undefined : undefined,
      date: new Date().toISOString(),
      visitTotal: totalParsed ?? 0,
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
            ? `border ${successNoticeClass}`
            : isDebtBalance
              ? 'border border-amber-500/30 bg-amber-500/10'
              : `border ${successNoticeClass}`
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
      <Modal open onClose={() => setConfirmStep(null)} title="Para la próxima visita" size="md">
        <p className="text-sm text-muted">Cambió el precio, la unidad, la equivalencia o la pesada. ¿Lo recordamos?</p>
        <ul className="mt-3 space-y-3">
          {recallChanges.map(c => (
            <li key={c.productKey} className="min-w-0 text-sm">
              <p className="truncate font-medium text-ink" title={c.name}>{c.name}</p>
              <div className="mt-1 space-y-0.5 text-xs text-muted">
                {c.price && (
                  <p className="tabular-nums">{formatPurchaseUnitCost(c.price.previous)} → {formatPurchaseUnitCost(c.price.next)}</p>
                )}
                {c.costUnit && (
                  <p>{formatRecallCostUnit(c.costUnit.previous)} → {formatRecallCostUnit(c.costUnit.next)}</p>
                )}
                {c.packContents && (
                  <p>1 cajón = {c.packContents.previous ?? '—'} → {c.packContents.next ?? '—'}</p>
                )}
                {c.weighMode && (
                  <p>{formatWeighMode(c.weighMode.previous)} → {formatWeighMode(c.weighMode.next)}</p>
                )}
                {c.duplicate && <p>Está dos veces. Se recuerda una sola forma.</p>}
              </div>
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
              <span
                className="min-w-0 flex-1 truncate"
                title={line.moneyRole === 'informed' ? `${line.rubroName} · costo informado` : line.rubroName}
              >
                {line.rubroName}
                {line.moneyRole === 'informed' ? ' · costo informado' : ''}
              </span>
              <span className="shrink-0 tabular-nums text-muted">
                {line.moneyRole === 'none' ? '—' : formatARS(line.costTotal)}
              </span>
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
            {isEditing ? 'Actualizar' : 'Registrar'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        {!isEditing && (
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-app p-1" role="tablist" aria-label="Tipo de registro">
            {([
              { id: 'provider' as const, label: 'Proveedor' },
              { id: 'simple' as const, label: 'Otros' },
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
            onKeyDownCapture={event => moveSuggest(
              event,
              providerListOpen,
              listedProviders.length,
              providerHighlight,
              setProviderHighlight,
              () => { providerInteractedRef.current = true; setShowProviderSuggestions(true) },
              () => setShowProviderSuggestions(false),
              index => {
                const provider = listedProviders[index]
                if (provider) selectProviderFromList(provider)
              },
            )}
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
              {listedProviders.map((p, index) => (
                <li
                  key={p.id}
                  data-suggest-marked={providerListOpen && index === providerMarked ? 'true' : undefined}
                  onMouseDown={e => { e.preventDefault(); selectProviderFromList(p) }}
                  onMouseEnter={() => setProviderHighlight(index)}
                  className={`px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${providerListOpen && index === providerMarked ? 'bg-accent-soft' : 'hover:bg-hover'}`}
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

        {showVisitFields && !unpaidArrival && hasProviderDebt && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-danger">Deuda anterior</p>
              <span className="shrink-0 text-sm font-bold tabular-nums text-danger">{formatARS(previousDebt)}</span>
            </div>
            {isAdminAdjustNote(providerDebt?.lastEventNotes) && (
              <p className="mt-1 text-[11px] text-ink/80" title={providerDebt?.lastEventNotes ?? undefined}>
                {providerDebt?.lastEventNotes}
              </p>
            )}
          </div>
        )}
        {showVisitFields && !unpaidArrival && hasProviderCredit && (
          <div className={`rounded-xl border ${successNoticeClass} px-4 py-3`}>
            <div className="flex items-center justify-between gap-2 min-w-0">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-success">Saldo a favor</p>
              <span className="shrink-0 text-sm font-bold tabular-nums text-success">{formatARS(previousCredit)}</span>
            </div>
            {isAdminAdjustNote(providerDebt?.lastEventNotes) && (
              <p className="mt-1 text-[11px] text-ink/80" title={providerDebt?.lastEventNotes ?? undefined}>
                {providerDebt?.lastEventNotes}
              </p>
            )}
          </div>
        )}

        {showVisitFields && !isEditing && (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Contenido de la visita">
            {([
              { id: 'goods', label: 'Mercadería' },
              { id: 'unpaid', label: 'Entró y no se pagó acá' },
              { id: 'supplies', label: 'Solo insumos' },
            ] as const).map(opt => {
              const selected = opt.id === 'supplies'
                ? suppliesOnly
                : opt.id === 'unpaid'
                  ? unpaidArrival
                  : !suppliesOnly && !unpaidArrival
              return (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  if (selected) return
                  selectVisitTab(opt.id)
                }}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  selected
                    ? 'border-line-strong bg-hover font-medium text-ink'
                    : 'border-line bg-panel font-normal text-ink hover:bg-hover'
                }`}
              >
                {opt.label}
              </button>
              )
            })}
          </div>
        )}

        {showVisitFields && !isEditing && unpaidArrival && (
          <MediaResVisitForm
            lines={merchLines}
            onChange={lines => { setMerchLines(lines); clearError() }}
          />
        )}

        {showVisitFields && !isEditing && !suppliesOnly && !unpaidArrival && (
          <ProviderVisitMerchBlock
            products={catalog}
            memory={memory}
            lines={merchLines}
            onChange={lines => { setMerchLines(lines); clearError() }}
            invalid={errorField === 'merch'}
          />
        )}

        {showVisitFields && suppliesOnly && (
        <div className="space-y-1 rounded-xl border border-line bg-app p-4">
          <label className="text-sm text-muted">Qué se pagó</label>
          <input
            ref={insumosConceptRef}
            type="text"
            value={concept}
            onChange={e => handleConceptChange(e.target.value)}
            onKeyDownCapture={event => moveSuggest(
              event,
              conceptListOpen,
              listedConcepts.length,
              conceptHighlight,
              setConceptHighlight,
              () => { conceptInteractedRef.current = true; setShowConceptSuggestions(true) },
              () => setShowConceptSuggestions(false),
              index => {
                const name = listedConcepts[index]
                if (!name) return
                setConcept(name)
                setShowConceptSuggestions(false)
              },
            )}
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
            open={showVisitFields && suppliesOnly && showConceptSuggestions && listedConcepts.length > 0}
          >
            <ul>
              {listedConcepts.map((s, index) => (
                <li
                  key={s}
                  data-suggest-marked={conceptListOpen && index === conceptMarked ? 'true' : undefined}
                  onMouseDown={e => { e.preventDefault(); setConcept(s); setShowConceptSuggestions(false) }}
                  onMouseEnter={() => setConceptHighlight(index)}
                  className={`px-3 py-2 text-sm cursor-pointer ${conceptListOpen && index === conceptMarked ? 'bg-accent-soft' : 'hover:bg-hover'}`}
                >
                  {s}
                </li>
              ))}
            </ul>
          </SuggestPopover>
        </div>
        )}

        {showVisitFields && !unpaidArrival && (
          <div className="space-y-3 rounded-xl border border-line bg-app p-4">
            {editingVisit ? (
            <p className="text-sm text-muted">
              Total de la visita:{' '}
              <span className="font-semibold tabular-nums text-ink">{formatARS(visitPaidLocked + visitDebtLocked)}</span>
            </p>
            ) : isEditing || suppliesOnly ? (
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
              {editingVisit && (
                <p className="text-xs text-muted">
                  {visitDebtLocked > 0
                    ? `Lo que entregues ahora sale de la caja y paga deuda anterior. La deuda de esta visita queda en ${formatARS(visitDebtLocked)}.`
                    : 'Lo que entregues de más sale de la caja y paga deuda anterior. Lo ya pagado de esta visita no cambia.'}
                </p>
              )}
              {!isEditing && (
                <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
                  <input
                    type="checkbox"
                    checked={paymentChannel === 'digital'}
                    onChange={e => setPaymentChannel(e.target.checked ? 'digital' : 'cash')}
                    className="rounded border-line bg-panel text-accent focus:ring-accent focus:ring-offset-panel"
                  />
                  <span className="text-sm text-ink">No salió de la caja</span>
                </label>
              )}
            </div>

            {totalParsed !== null && totalParsed > 0 && (
              <div className={`space-y-1.5 rounded-xl border px-4 py-3 ${
                finalBalance > 0 || remainingCrossDebt > 0
                  ? 'border-amber-500/30 bg-amber-500/10'
                  : successNoticeClass
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

        {showVisitFields && !unpaidArrival && currentStoreId && stores.filter(s => s.id !== currentStoreId).length > 0 && (
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
            onKeyDownCapture={event => moveSuggest(
              event,
              conceptListOpen,
              listedConcepts.length,
              conceptHighlight,
              setConceptHighlight,
              () => { conceptInteractedRef.current = true; setShowConceptSuggestions(true) },
              () => setShowConceptSuggestions(false),
              index => {
                const name = listedConcepts[index]
                if (!name) return
                setConcept(name)
                setShowConceptSuggestions(false)
              },
            )}
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
              {listedConcepts.map((s, index) => (
                <li
                  key={s}
                  data-suggest-marked={conceptListOpen && index === conceptMarked ? 'true' : undefined}
                  onMouseDown={e => { e.preventDefault(); setConcept(s); setShowConceptSuggestions(false) }}
                  onMouseEnter={() => setConceptHighlight(index)}
                  className={`px-3 py-2 text-sm cursor-pointer ${conceptListOpen && index === conceptMarked ? 'bg-accent-soft' : 'hover:bg-hover'}`}
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
