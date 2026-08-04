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
  /** Saldo final: positivo = el negocio le debe al proveedor; negativo = el proveedor le debe al negocio */
  finalBalance: number
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

  const hasProviderDebt = providerDebt && providerDebt.balance > 0

  // ── Cálculos automáticos ────────────────────────────────────────────────
  const hasProvider = providerInput.trim().length > 0
  const totalParsed = hasProvider ? (parseNumericInput(totalRaw) ?? 0) : null
  const entregadoParsed = parseNumericInput(amountRaw) ?? 0
  const previousBalance = providerDebt?.balance ?? 0

  // Deuda nueva generada por esta visita
  const autoNewDebt = totalParsed !== null
    ? Math.max(0, totalParsed - entregadoParsed)
    : 0

  // Exceso sobre el costo de la visita → va a saldar deuda vieja o genera saldo a favor
  const excessOverVisit = totalParsed !== null
    ? Math.max(0, entregadoParsed - totalParsed)
    : 0

  // Cuánto de ese exceso cancela deuda vieja del local actual (capped en la deuda existente)
  const autoPaysOldDebt = Math.min(excessOverVisit, previousBalance)

  // Lo que queda después de cancelar deuda del local actual
  const excessAfterLocalDebt = Math.max(0, excessOverVisit - previousBalance)

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
    if (entregadoParsed <= 0) { setError('Ingresá el total entregado al proveedor.'); return }

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
      newDebt: autoNewDebt,
      creditBalance,
      finalBalance,
    })
  }

  // ── COMPROBANTE ────────────────────────────────────────────────────────
  if (receipt) {
    const isCreditBalance = receipt.finalBalance < 0
    const isDebtBalance = receipt.finalBalance > 0
    const isSettled = receipt.finalBalance === 0

    const formattedDate = new Date(receipt.date).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-overlay-fade">
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
          {/* Header del comprobante */}
          <div className="bg-gray-900 px-6 py-4 text-center">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Comprobante de pago</p>
            <p className="text-lg font-bold text-white mt-0.5 truncate" title={receipt.businessName}>
              {receipt.businessName}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{formattedDate}</p>
          </div>

          {/* Cuerpo */}
          <div className="px-6 py-5 space-y-4">
            {/* Proveedor */}
            <div className="text-center border-b border-gray-200 pb-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Proveedor</p>
              <p className="text-xl font-bold text-gray-900 mt-0.5 truncate" title={receipt.providerName}>
                {receipt.providerName}
              </p>
              {receipt.concept && (
                <p className="text-sm text-gray-500 mt-0.5 truncate" title={receipt.concept}>
                  {receipt.concept}
                </p>
              )}
            </div>

            {/* Desglose de montos */}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Total de la visita</span>
                <span className="font-semibold text-gray-900">{formatARS(receipt.visitTotal)}</span>
              </div>

              {receipt.previousBalance > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Deuda anterior</span>
                  <span className="font-semibold">{formatARS(receipt.previousBalance)}</span>
                </div>
              )}

              <div className="flex justify-between border-t border-gray-100 pt-2">
                <span className="text-gray-600 font-medium">Total entregado</span>
                <span className="font-bold text-gray-900">{formatARS(receipt.totalDelivered)}</span>
              </div>
            </div>

            {/* Resultado */}
            <div className={`rounded-xl px-4 py-3 text-center ${
              isCreditBalance
                ? 'bg-blue-50 border border-blue-200'
                : isDebtBalance
                  ? 'bg-amber-50 border border-amber-200'
                  : 'bg-green-50 border border-green-200'
            }`}>
              {isSettled && (
                <>
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Saldado ✓</p>
                  <p className="text-2xl font-bold text-green-600 mt-1">Sin deuda</p>
                </>
              )}
              {isDebtBalance && (
                <>
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Queda adeudando</p>
                  <p className="text-2xl font-bold text-amber-600 mt-1">{formatARS(receipt.newDebt)}</p>
                  <p className="text-[11px] text-amber-600/80 mt-0.5">de esta visita</p>
                </>
              )}
              {isCreditBalance && (
                <>
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Saldo a favor del negocio</p>
                  <p className="text-2xl font-bold text-blue-600 mt-1">{formatARS(Math.abs(receipt.finalBalance))}</p>
                  <p className="text-[11px] text-blue-600/80 mt-0.5">el proveedor deberá descontar en próxima visita</p>
                </>
              )}
            </div>

            {/* Firma / nota */}
            <div className="border-t border-dashed border-gray-300 pt-4 text-center">
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Registrado digitalmente · Guardado en el sistema
              </p>
            </div>
          </div>

          {/* Botón cerrar */}
          <div className="px-6 pb-5">
            <button
              onClick={onRegistered}
              className="w-full py-3 rounded-xl bg-gray-900 text-white font-semibold hover:bg-gray-800 transition-colors"
            >
              Cerrar comprobante
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── FORMULARIO ────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm shadow-xl space-y-4 p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">{isEditing ? 'Editar gasto' : 'Registrar gasto'}</h2>

        {/* Proveedor */}
        <div className="space-y-1 relative">
          <label className="text-sm text-gray-400">Proveedor</label>
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
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          {showProviderSuggestions && filteredProviders.length > 0 && (
            <ul className="absolute z-10 w-full bg-gray-800 border border-gray-700 rounded-lg mt-1 max-h-40 overflow-y-auto shadow-lg">
              {filteredProviders.map(p => (
                <li
                  key={p.id}
                  onMouseDown={() => selectProviderFromList(p)}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-700 flex items-center gap-2"
                >
                  <span className="flex-1 min-w-0 truncate" title={p.name}>{p.name}</span>
                  {p.phone && <span className="shrink-0 text-xs text-gray-500">{p.phone}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Concepto */}
        <div className="space-y-1 relative">
          <label className="text-sm text-gray-400">
            Concepto
            {providerInput.trim()
              ? <span className="text-gray-600 ml-1">(opcional)</span>
              : <span className="text-gray-400 ml-1">*</span>}
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
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          {showConceptSuggestions && filteredConcepts.length > 0 && (
            <ul className="absolute z-10 w-full bg-gray-800 border border-gray-700 rounded-lg mt-1 max-h-40 overflow-y-auto shadow-lg">
              {filteredConcepts.map(s => (
                <li
                  key={s}
                  onMouseDown={() => { setConcept(s); setShowConceptSuggestions(false) }}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-700"
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
              <label className="text-sm text-gray-400">Total de la visita ($)</label>
              <NumericInput
                value={totalRaw}
                onChange={v => { setTotalRaw(v); setError(null) }}
                placeholder="0"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <p className="text-[11px] text-gray-500">Costo total de lo que trajo el proveedor.</p>
            </div>

            <div className="space-y-1">
              <label className="text-sm text-gray-400">Total entregado al proveedor ($)</label>
              <NumericInput
                value={amountRaw}
                onChange={v => { setAmountRaw(v); setError(null) }}
                placeholder="0"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <p className="text-[11px] text-gray-500">
                Podés entregar más para saldar deuda o si no tenés cambio exacto — el exceso queda como saldo a favor.
              </p>
            </div>

            {/* Resumen automático */}
            {totalParsed !== null && totalParsed > 0 && entregadoParsed > 0 && (
              <div className={`rounded-xl px-4 py-3 space-y-1.5 border ${
                creditBalance > 0
                  ? 'bg-blue-950/40 border-blue-700/50'
                  : autoNewDebt > 0 || remainingCrossDebt > 0
                    ? 'bg-amber-950/40 border-amber-700/50'
                    : 'bg-green-950/40 border-green-700/50'
              }`}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Esta visita</span>
                  <span className="text-white">{formatARS(totalParsed)}</span>
                </div>

                {autoPaysOldDebt > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-green-400">Deuda anterior saldada</span>
                    <span className="text-green-300">− {formatARS(autoPaysOldDebt)}</span>
                  </div>
                )}

                {autoNewDebt > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-amber-400">Queda adeudando</span>
                    <span className="font-bold text-amber-300">{formatARS(autoNewDebt)}</span>
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

                {creditBalance > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-blue-300">Saldo a favor del negocio</span>
                    <span className="font-bold text-blue-300">+ {formatARS(creditBalance)}</span>
                  </div>
                )}

                {autoNewDebt === 0 && creditBalance === 0 && (!crossLocalDebt || crossStoreBalance === 0) && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-green-400 font-medium">Pago completo</span>
                    <span className="text-green-300">✓</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <label className="text-sm text-gray-400">Monto ($)</label>
            <NumericInput
              value={amountRaw}
              onChange={v => { setAmountRaw(v); setError(null) }}
              placeholder="0"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        {/* Aviso deuda anterior */}
        {providerInput.trim() && hasProviderDebt && !loadingDebt && (
          <div className="rounded-xl px-4 py-3 border border-red-800/50 bg-red-950/30 space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">Deuda anterior</p>
              <span className="text-sm font-bold text-red-300">{formatARS(providerDebt!.balance)}</span>
            </div>
            <p className="text-[11px] text-red-400/70">
              El exceso sobre el total de la visita se aplicará automáticamente a esta deuda.
            </p>
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
                className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
              />
              <span className="text-sm text-gray-400">
                El pago corresponde a deuda de otro local
              </span>
            </label>
            {crossLocalDebt && (
              <div className="space-y-1">
                <label className="text-xs text-gray-500">Local al que se imputa la deuda</label>
                <select
                  value={debtStoreId}
                  onChange={e => setDebtStoreId(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  {stores.filter(s => s.id !== currentStoreId).map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-500">
                  El dinero sale de esta caja, pero la deuda queda registrada en el local seleccionado.
                </p>
                {/* Deuda del otro local con este proveedor */}
                {matchedProviderId && (
                  <div className="mt-1">
                    {loadingCrossDebt ? (
                      <p className="text-xs text-gray-500">Consultando deuda...</p>
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
          <label className="text-sm text-gray-400">Notas (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Detalle del gasto…"
            maxLength={300}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40 text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold transition-colors disabled:opacity-40 text-sm"
          >
            {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
