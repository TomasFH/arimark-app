/**
 * Modal para registrar un gasto durante el turno activo.
 *
 * Flujo:
 *   - Proveedor es el campo principal. Autocomplete global (LIST_PROVIDERS).
 *     Al seleccionar del autocomplete se pasa providerId exacto.
 *     Al tipear nombre nuevo, se crea el proveedor al guardar.
 *   - Concepto: campo libre para gastos sin proveedor.
 *   - Regla: se requiere proveedor O concepto (o ambos).
 *   - Si el proveedor tiene deuda pendiente, se muestra aviso y el exceso
 *     entregado se aplica automáticamente.
 *   - Si el pago excede la deuda, se genera un saldo a favor del negocio.
 *   - Al guardar se muestra un comprobante fotográfico.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import NumericInput from '../components/NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import { formatPhoneInput } from '../lib/phoneInput'
import PaymentReceipt from '../components/PaymentReceipt'
import type { ExpenseRow, ProviderDebtRow, ProviderRow, StoreRow } from '../types/hw-api'

interface Props {
  onRegistered: () => void
  /** Llamado inmediatamente cuando el gasto se guardó en DB, antes de que el usuario
   * cierre el comprobante. Permite que el padre refresque el balance sin esperar al cierre. */
  onSaved?: () => void
  onCancel: () => void
  /** Si se pasa, el modal opera en modo edición sobre este gasto existente. */
  editingExpense?: ExpenseRow
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
}

export default function ExpenseModal({ onRegistered, onSaved, onCancel, editingExpense }: Props) {
  const isEditing = !!editingExpense

  // --- Proveedor ---
  const [providerInput, setProviderInput] = useState(editingExpense?.provider ?? '')
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(editingExpense?.providerId ?? null)
  const [providerSuggestions, setProviderSuggestions] = useState<ProviderRow[]>([])
  const [showProviderSuggestions, setShowProviderSuggestions] = useState(false)
  const providerInteractedRef = useRef(false)

  // --- Concepto ---
  const [concept, setConcept] = useState(editingExpense?.concept ?? '')
  const [conceptSuggestions, setConceptSuggestions] = useState<string[]>([])
  const [showConceptSuggestions, setShowConceptSuggestions] = useState(false)
  const conceptInteractedRef = useRef(false)

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

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // --- Comprobante ---
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [businessName, setBusinessName] = useState('')

  const providerInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.hw.listProviders().then(r => {
      if (r.ok) setProviderSuggestions(r.data)
    })
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
    providerInputRef.current?.focus()
  }, [])

  // Inicializa debtStoreId al primer local que no sea el actual, una vez que ambos datos están disponibles.
  useEffect(() => {
    if (!currentStoreId || stores.length === 0) return
    const otherStores = stores.filter(s => s.id !== currentStoreId)
    setDebtStoreId(otherStores[0]?.id ?? '')
  }, [stores, currentStoreId])

  // Consulta la deuda del otro local cuando se activa cross-local.
  // Funciona tanto si el proveedor fue seleccionado del autocomplete (selectedProviderId)
  // como si fue escrito a mano con nombre que coincide exactamente con uno existente.
  const matchedProviderId = selectedProviderId
    ?? providerSuggestions.find(
        p => p.name.toLowerCase() === providerInput.trim().toLowerCase()
      )?.id
    ?? null

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

  const filteredProviders = providerInput.trim().length === 0
    ? providerSuggestions
    : providerSuggestions.filter(p => p.name.toLowerCase().includes(providerInput.toLowerCase()))

  const filteredConcepts = concept.trim().length === 0
    ? conceptSuggestions
    : conceptSuggestions.filter(s => s.toLowerCase().includes(concept.toLowerCase()))

  const fetchProviderDebt = useCallback(async (pid: string) => {
    if (!pid) { setProviderDebt(null); return }
    setLoadingDebt(true)
    const r = await window.hw.getProviderDebt({ providerId: pid })
    setLoadingDebt(false)
    if (r.ok) setProviderDebt(r.data)
  }, [])

  const debtTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleProviderInputChange(value: string) {
    setProviderInput(value)
    setSelectedProviderId(null)
    setProviderDebt(null)
    providerInteractedRef.current = true
    setShowProviderSuggestions(true)
  }

  function selectProviderFromList(p: ProviderRow) {
    setProviderInput(p.name)
    setSelectedProviderId(p.id)
    setShowProviderSuggestions(false)
    if (debtTimerRef.current) clearTimeout(debtTimerRef.current)
    void fetchProviderDebt(p.id)
  }

  const hasProvider = providerInput.trim().length > 0
  const totalParsed = hasProvider ? (parseNumericInput(totalRaw) ?? 0) : null
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

  async function handleSubmit() {
    const hasProviderLocal = providerInput.trim().length > 0
    const hasConcept = concept.trim().length > 0

    if (!hasProviderLocal && !hasConcept) {
      setError('Ingresá un proveedor o un concepto para el gasto.')
      return
    }

    // Gastos sin proveedor — flujo simple
    if (!hasProviderLocal) {
      const amount = parseNumericInput(amountRaw)
      if (!amount || amount <= 0) { setError('Ingresá un monto válido.'); return }
      setSaving(true)
      setError(null)
      const payload: Parameters<typeof window.hw.registerExpense>[0] = {
        amount,
        notes: notes.trim() || undefined,
        concept: hasConcept ? concept.trim() : undefined,
      }
      const r = isEditing
        ? await window.hw.updateExpense({ id: editingExpense!.id, ...payload })
        : await window.hw.registerExpense(payload)
      setSaving(false)
      if (!r.ok) { setError(r.error); return }
      onSaved?.()
      onRegistered()
      return
    }

    // Gastos con proveedor
    if (!totalParsed || totalParsed <= 0) { setError('Ingresá el total de la visita.'); return }
    // Entregado 0 / vacío es válido: el proveedor dejó mercadería y no se le pagó nada.

    const amountForVisit = Math.min(entregadoParsed, totalParsed)
    // En modo cross-local, paysOldDebt incluye lo aplicado a la deuda del otro local
    // En modo normal, incluye lo que cancela la deuda del local actual + saldo a favor
    const totalPaysOldDebt = crossLocalDebt && crossStoreBalance > 0
      ? appliedToCrossDebt   // el backend registra como payment event en el otro local
      : excessOverVisit      // en modo normal: cancela deuda local o genera saldo a favor

    setSaving(true)
    setError(null)

    const payload: Parameters<typeof window.hw.registerExpense>[0] = {
      amount: amountForVisit,
      notes: notes.trim() || undefined,
      newDebtAmount: autoNewDebt > 0 ? autoNewDebt : undefined,
      paysOldDebt: totalPaysOldDebt > 0 ? totalPaysOldDebt : undefined,
      debtStoreId: crossLocalDebt && debtStoreId ? debtStoreId : undefined,
    }

    if (selectedProviderId) {
      payload.providerId = selectedProviderId
    } else {
      payload.provider = providerInput.trim()
    }
    if (hasConcept) payload.concept = concept.trim()

    const r = isEditing
      ? await window.hw.updateExpense({ id: editingExpense!.id, ...payload })
      : await window.hw.registerExpense(payload)
    setSaving(false)

    if (!r.ok) { setError(r.error); return }

    // Notificar al padre inmediatamente para que refresque el balance,
    // sin esperar a que el usuario cierre el comprobante.
    onSaved?.()

    // Al editar no mostramos comprobante (ya hay un registro previo)
    if (isEditing) { onRegistered(); return }

    // Mostrar comprobante fotográfico
    setReceipt({
      businessName,
      providerName: providerInput.trim(),
      concept: concept.trim() || undefined,
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
        onClose={onRegistered}
        resultClassName={
          isCreditBalance
            ? 'bg-emerald-50 border border-emerald-200'
            : isDebtBalance
              ? 'bg-amber-50 border border-amber-200'
              : 'bg-green-50 border border-green-200'
        }
        result={
          isSettled ? (
            <>
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">{storeLabel}</p>
              <p className="text-2xl font-bold text-green-600 mt-1">Sin deuda</p>
              {receipt.newDebt > 0 && (
                <p className="text-[11px] text-green-700/80 mt-0.5">
                  De esta visita: {formatARS(receipt.newDebt)}
                </p>
              )}
              {receipt.creditApplied > 0 && (
                <p className="text-[11px] text-emerald-700 mt-1 leading-relaxed">
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
              {receipt.newDebt > 0 && (
                <p className="text-[11px] text-amber-600/80 mt-0.5">
                  De esta visita: {formatARS(receipt.newDebt)}
                </p>
              )}
              {receipt.creditApplied > 0 && (
                <p className="text-[11px] text-emerald-700 mt-1">
                  Ya se descontó saldo a favor de {formatARS(receipt.creditApplied)}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">{storeLabel}</p>
              <p className="text-2xl font-bold text-emerald-600 mt-1">
                A favor {formatARS(Math.abs(receipt.finalBalance))}
              </p>
              <p className="text-[11px] text-emerald-600/80 mt-0.5">el proveedor deberá descontar en próxima visita</p>
            </>
          )
        }
      >
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Total de la visita</span>
            <span className="font-semibold text-gray-900">{formatARS(receipt.visitTotal)}</span>
          </div>

          {receipt.previousBalance > 0 && (
            <div className="flex justify-between text-red-600">
              <span>Deuda anterior de este local</span>
              <span className="font-semibold">{formatARS(receipt.previousBalance)}</span>
            </div>
          )}

          <div className="flex justify-between border-t border-gray-100 pt-2">
            <span className="text-gray-600 font-medium">Total entregado</span>
            <span className="font-bold text-gray-900">{formatARS(receipt.totalDelivered)}</span>
          </div>

          {receipt.creditApplied > 0 && (
            <div className="flex justify-between text-emerald-700">
              <span>Saldo a favor aplicado</span>
              <span className="font-semibold">− {formatARS(receipt.creditApplied)}</span>
            </div>
          )}
        </div>
      </PaymentReceipt>
    )
  }

  // ── FORMULARIO ────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-zinc-800 rounded-2xl w-full max-w-xl shadow-xl space-y-4 p-6 max-h-[90vh] overflow-y-auto border border-zinc-700">
        <h2 className="text-lg font-semibold">{isEditing ? 'Editar gasto' : 'Registrar gasto'}</h2>

        {/* Proveedor */}
        <div className="space-y-1 relative">
          <label className="text-sm text-zinc-400">Proveedor</label>
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
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
          />
          {showProviderSuggestions && filteredProviders.length > 0 && (
            <ul className="absolute z-10 w-full bg-zinc-800 border border-zinc-700 rounded-lg mt-1 max-h-40 overflow-y-auto shadow-lg">
              {filteredProviders.map(p => (
                <li
                  key={p.id}
                  onMouseDown={() => selectProviderFromList(p)}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-zinc-700 flex items-center gap-2"
                >
                  <span className="flex-1 min-w-0 truncate" title={p.name}>{p.name}</span>
                  {p.phone && (
                    <span className="shrink-0 text-xs text-zinc-500" title={formatPhoneInput(p.phone)}>
                      {formatPhoneInput(p.phone)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Concepto */}
        <div className="space-y-1 relative">
          <label className="text-sm text-zinc-400">
            Concepto
            {providerInput.trim()
              ? <span className="text-zinc-500 ml-1">(opcional)</span>
              : <span className="text-zinc-400 ml-1">*</span>}
          </label>
          <input
            type="text"
            value={concept}
            onChange={e => {
              setConcept(e.target.value)
              conceptInteractedRef.current = true
              setShowConceptSuggestions(true)
            }}
            onFocus={() => { if (conceptInteractedRef.current) setShowConceptSuggestions(true) }}
            onClick={() => { conceptInteractedRef.current = true; setShowConceptSuggestions(true) }}
            onBlur={() => setTimeout(() => setShowConceptSuggestions(false), 150)}
            placeholder={providerInput.trim() ? 'Descripción adicional…' : 'Insumos, Limpieza…'}
            maxLength={80}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
          />
          {showConceptSuggestions && filteredConcepts.length > 0 && (
            <ul className="absolute z-10 w-full bg-zinc-800 border border-zinc-700 rounded-lg mt-1 max-h-40 overflow-y-auto shadow-lg">
              {filteredConcepts.map(s => (
                <li
                  key={s}
                  onMouseDown={() => { setConcept(s); setShowConceptSuggestions(false) }}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-zinc-700"
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Montos */}
        {providerInput.trim() ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm text-zinc-400">Total de la visita ($)</label>
              <NumericInput
                value={totalRaw}
                onChange={v => { setTotalRaw(v); setError(null) }}
                placeholder="0"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
              <p className="text-[11px] text-zinc-500">Costo total de lo que trajo el proveedor.</p>
            </div>

            <div className="space-y-1">
              <label className="text-sm text-zinc-400">Total entregado al proveedor ($)</label>
              <NumericInput
                value={amountRaw}
                onChange={v => { setAmountRaw(v); setError(null) }}
                placeholder="0"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
              <p className="text-[11px] text-zinc-500">
                0 o vacío = no se pagó nada (queda como deuda). Podés entregar más para saldar deuda anterior; el exceso queda a favor.
              </p>
            </div>

            {/* Resumen automático */}
            {totalParsed !== null && totalParsed > 0 && (
              <div className={`rounded-xl px-4 py-3 space-y-1.5 border ${
                finalBalance > 0 || remainingCrossDebt > 0
                  ? 'bg-amber-950/40 border-amber-700/50'
                  : creditBalance > 0 || finalBalance < 0
                    ? 'bg-emerald-950/40 border-emerald-700/50'
                    : 'bg-green-950/40 border-green-700/50'
              }`}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">Esta visita</span>
                  <span className="text-white">{formatARS(totalParsed)}</span>
                </div>

                {creditAppliedToVisit > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-emerald-300">Saldo a favor aplicado</span>
                    <span className="font-bold text-emerald-300">− {formatARS(creditAppliedToVisit)}</span>
                  </div>
                )}

                {autoPaysOldDebt > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-green-400">Deuda anterior saldada</span>
                    <span className="text-green-300">− {formatARS(autoPaysOldDebt)}</span>
                  </div>
                )}

                {displayedNewDebt > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">De esta visita</span>
                    <span className="text-zinc-200">{formatARS(displayedNewDebt)}</span>
                  </div>
                )}

                {finalBalance > 0 && (
                  <div className="flex items-center justify-between text-sm pt-1 border-t border-white/10">
                    <span className="text-amber-400 font-medium">Saldo de este local</span>
                    <span className="font-bold text-lg text-amber-300">{formatARS(finalBalance)}</span>
                  </div>
                )}

                {/* Filas cross-local: reemplazan "saldo a favor" cuando hay deuda del otro local */}
                {crossLocalDebt && crossStoreBalance > 0 && appliedToCrossDebt > 0 && (
                  <div className="flex items-center justify-between text-sm border-t border-white/10 pt-1.5 mt-0.5">
                    <span className="text-green-400">Deuda otro local pagada</span>
                    <span className="text-green-300">− {formatARS(appliedToCrossDebt)}</span>
                  </div>
                )}

                {crossLocalDebt && remainingCrossDebt > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-amber-400">Deuda otro local restante</span>
                    <span className="font-bold text-amber-300">{formatARS(remainingCrossDebt)}</span>
                  </div>
                )}

                {crossLocalDebt && crossStoreBalance > 0 && remainingCrossDebt === 0 && appliedToCrossDebt > 0 && creditBalance === 0 && autoNewDebt === 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-green-400 font-medium">Deuda otro local saldada ✓</span>
                    <span className="text-green-300">✓</span>
                  </div>
                )}

                {creditBalance > 0 && creditBalance !== Math.abs(Math.min(0, finalBalance)) && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-emerald-300">Exceso de este pago</span>
                    <span className="font-bold text-emerald-300">+ {formatARS(creditBalance)}</span>
                  </div>
                )}

                {finalBalance < 0 && (
                  <div className="flex items-center justify-between text-sm pt-1 border-t border-white/10">
                    <span className="text-emerald-300 font-medium">Saldo de este local</span>
                    <span className="font-bold text-lg text-emerald-300">A favor {formatARS(-finalBalance)}</span>
                  </div>
                )}

                {finalBalance === 0 && creditBalance === 0 && displayedNewDebt === 0 && (!crossLocalDebt || remainingCrossDebt === 0) && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-green-400 font-medium">Este local queda sin deuda</span>
                    <span className="text-green-300">✓</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <label className="text-sm text-zinc-400">Monto ($)</label>
            <NumericInput
              value={amountRaw}
              onChange={v => { setAmountRaw(v); setError(null) }}
              placeholder="0"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
            />
          </div>
        )}

        {/* Aviso deuda anterior / saldo a favor */}
        {providerInput.trim() && hasProviderDebt && !loadingDebt && (
          <div className="rounded-xl px-4 py-3 border border-red-800/50 bg-red-950/30 space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">Deuda anterior</p>
              <span className="text-sm font-bold text-red-300">{formatARS(previousDebt)}</span>
            </div>
            <p className="text-[11px] text-red-400/70">
              El exceso sobre el total de la visita se aplicará automáticamente a esta deuda.
            </p>
            {isAdminAdjustNote(providerDebt?.lastEventNotes) && (
              <p className="text-[11px] text-violet-300/90" title={providerDebt?.lastEventNotes ?? undefined}>
                {providerDebt?.lastEventNotes}
              </p>
            )}
          </div>
        )}
        {providerInput.trim() && hasProviderCredit && !loadingDebt && (
          <div className="rounded-xl px-4 py-3 border border-emerald-800/50 bg-emerald-950/30 space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Saldo a favor</p>
              <span className="text-sm font-bold text-emerald-300">{formatARS(previousCredit)}</span>
            </div>
            <p className="text-[11px] text-emerald-400/70">
              Se descuenta solo de esta visita. No hace falta anotarlo de nuevo.
            </p>
            {isAdminAdjustNote(providerDebt?.lastEventNotes) && (
              <p className="text-[11px] text-violet-300/90" title={providerDebt?.lastEventNotes ?? undefined}>
                {providerDebt?.lastEventNotes}
              </p>
            )}
          </div>
        )}

        {/* Pago cross-local — solo cuando hay proveedor seleccionado y existe al menos otro local */}
        {providerInput.trim() && currentStoreId && stores.filter(s => s.id !== currentStoreId).length > 0 && (
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
                className="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
              />
              <span className="text-sm text-zinc-400">
                El pago corresponde a deuda de otro local
              </span>
            </label>
            {crossLocalDebt && (
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Local al que se imputa la deuda</label>
                <select
                  value={debtStoreId}
                  onChange={e => setDebtStoreId(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                >
                  {stores.filter(s => s.id !== currentStoreId).map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-500">
                  El dinero sale de esta caja, pero la deuda queda registrada en el local seleccionado.
                </p>
                {/* Deuda del otro local con este proveedor */}
                {matchedProviderId && (
                  <div className="mt-1">
                    {loadingCrossDebt ? (
                      <p className="text-xs text-zinc-500">Consultando deuda...</p>
                    ) : crossStoreDebt && crossStoreDebt.balance > 0 ? (
                      // Solo mostrar el cuadro si la deuda no queda cubierta por el pago actual.
                      // Si ya está saldada, el resumen de arriba lo indica y este cuadro sería ruido visual.
                      remainingCrossDebt > 0 ? (
                        <div className="rounded-lg px-3 py-2 bg-red-950/30 border border-red-800/50">
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-red-400">Deuda pendiente de ese local</span>
                            <span className="text-sm font-bold text-red-300">{formatARS(remainingCrossDebt)}</span>
                          </div>
                          <p className="text-[11px] text-red-400/60 mt-0.5">
                            El pago actual no alcanza para saldar esta deuda completamente.
                          </p>
                        </div>
                      ) : null
                    ) : crossStoreDebt && crossStoreDebt.balance < 0 ? (
                      <p className="text-[11px] text-emerald-400/70 mt-1">
                        Ese local tiene saldo a favor {formatARS(-crossStoreDebt.balance)}.
                      </p>
                    ) : crossStoreDebt && crossStoreDebt.balance <= 0 ? (
                      <p className="text-[11px] text-green-400/70 mt-1">Sin deuda pendiente en ese local.</p>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Notas */}
        <div className="space-y-1">
          <label className="text-sm text-zinc-400">Notas (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Detalle del gasto…"
            maxLength={300}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold transition-colors disabled:opacity-40 text-sm"
          >
            {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
