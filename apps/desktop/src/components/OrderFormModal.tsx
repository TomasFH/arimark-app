/**
 * Alta y edición de pedido. Lo abren el POS (Tomar pedido) y Pedidos.
 * El alta comparte un borrador en memoria; editar un pedido guardado no lo pisa.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import NumericInput from './NumericInput'
import DecimalInput from './DecimalInput'
import { Button, CollapseReveal, Modal, SuggestPopover } from './ui'
import { showAppToast } from './ui/AppToast'
import { formatNumericInputValue, parseNumericInput } from '../lib/numericInput'
import { formatARS, formatYmd, todayLocalYmd } from '../lib/datetime'
import { formatPhoneInput } from '../lib/phoneInput'
import {
  blankOrderForm,
  clearOrderCreateDraft,
  depositTotal,
  DEPOSIT_METHOD_LABELS,
  estimatedBudgetTotal,
  getOrderCreateDraft,
  kgLineMissingWeight,
  orderCreateDraftHasContent,
  orderFormFromOrder,
  resetOrderCreateDraft,
  resolvedBudgetLines,
  seedOrderCreateDraft,
  TIME_SLOT_LABELS,
  updateOrderCreateDraft,
  useOrderCreateDraft,
  type OrderFormState,
} from '../lib/orderCreateDraft'
import {
  searchProductsByQuery,
  summarizeBudgetItems,
  pickupHoursLiveErrorOnDate,
  pickupSlotAvailability,
  pickupSlotRegistrationError,
  PICKUP_SPECIFIC_HINT,
  storeHoursSourceFromRecord,
  type StoreHoursSource,
} from '@carniceria/shared'
import type {
  CreateOrderPayload,
  DepositMethod,
  OrderRow,
  OrderTimeSlot,
  ProductRow,
  StoreRow,
  UpdateOrderPayload,
} from '../types/hw-api'

export interface OrderFormModalProps {
  open: boolean
  mode: 'create' | 'edit'
  editingOrder?: OrderRow | null
  onClose: () => void
  onSaved: (order: OrderRow, mode: 'create' | 'edit') => void
  /** Admin en el hub, sin turno: elige el local del pedido. */
  showStoreFilter: boolean
  /** Local cuyos horarios validan el retiro cuando no hay selector. */
  hoursStoreId?: string
  /** Local que se preselecciona al sembrar un alta vacía. */
  defaultStoreId?: string
  /** Si el padre ya los tiene, no se vuelven a pedir. */
  stores?: StoreRow[]
}

export default function OrderFormModal({
  open,
  mode,
  editingOrder = null,
  onClose,
  onSaved,
  showStoreFilter,
  hoursStoreId = '',
  defaultStoreId = '',
  stores: storesProp,
}: OrderFormModalProps) {
  const draft = useOrderCreateDraft()
  const [editForm, setEditForm] = useState<OrderFormState>(() =>
    editingOrder ? orderFormFromOrder(editingOrder) : blankOrderForm(),
  )
  const form = mode === 'edit' ? editForm : draft
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showDepositConfirm, setShowDepositConfirm] = useState(false)
  const [catalog, setCatalog] = useState<ProductRow[]>([])
  const [fetchedStores, setFetchedStores] = useState<StoreRow[]>([])
  const [budgetSearch, setBudgetSearch] = useState('')
  const [budgetSuggestions, setBudgetSuggestions] = useState<ProductRow[]>([])
  const budgetSearchRef = useRef<HTMLInputElement>(null)
  const lastQtyRef = useRef<HTMLInputElement>(null)
  const prevCartLen = useRef(mode === 'edit'
    ? (editingOrder?.budgetItems?.length ?? 0)
    : getOrderCreateDraft().budgetCart.length)
  const alive = useRef(true)

  const stores = storesProp ?? fetchedStores
  const title = mode === 'edit' ? 'Editar pedido' : 'Nuevo pedido'

  function patchForm(updater: (prev: OrderFormState) => OrderFormState): void {
    if (mode === 'edit') setEditForm(updater)
    else updateOrderCreateDraft(updater)
  }

  const hoursSourceFor = useCallback((storeId: string): StoreHoursSource | null => {
    const id = showStoreFilter
      ? storeId
      : (hoursStoreId || stores[0]?.id || '')
    const store = stores.find(item => item.id === id)
    return store ? storeHoursSourceFromRecord(store) : null
  }, [showStoreFilter, hoursStoreId, stores])

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    if (!open || mode !== 'create') return
    seedOrderCreateDraft(defaultStoreId)
  }, [open, mode, defaultStoreId])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    window.hw.getProducts()
      .then(result => {
        if (cancelled) return
        if (!result.ok) {
          setFormError(result.error)
          return
        }
        setCatalog(result.data)
      })
      .catch(err => {
        if (cancelled) return
        console.error('[OrderFormModal] getProducts falló', err)
        setFormError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo.')
      })
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (!open || storesProp != null) return
    let cancelled = false
    window.hw.getStores()
      .then(result => {
        if (cancelled) return
        if (!result.ok) {
          setFormError(result.error)
          return
        }
        setFetchedStores(result.data)
      })
      .catch(err => {
        if (cancelled) return
        console.error('[OrderFormModal] getStores falló', err)
        setFormError(err instanceof Error ? err.message : 'No se pudieron cargar los locales.')
      })
    return () => { cancelled = true }
  }, [open, storesProp])

  useEffect(() => {
    const query = budgetSearch.trim()
    if (!query) {
      setBudgetSuggestions([])
      return
    }
    const results = searchProductsByQuery(catalog, query, {
      nameOf: product => product.name,
      pluOf: product => product.pluNumber ?? 0,
    })
    setBudgetSuggestions(results.slice(0, 8))
  }, [budgetSearch, catalog])

  useEffect(() => {
    if (form.budgetCart.length > prevCartLen.current) {
      requestAnimationFrame(() => lastQtyRef.current?.focus())
    }
    prevCartLen.current = form.budgetCart.length
  }, [form.budgetCart.length])

  useEffect(() => {
    if (!open) return
    const current = mode === 'edit' ? editForm : getOrderCreateDraft()
    const available = pickupSlotAvailability(hoursSourceFor(current.storeId), current.pickupDate)
    const slotClosed = (current.timeSlot === 'afternoon' && !available.afternoon)
      || (current.timeSlot === 'morning' && !available.morning)
    if (!slotClosed) return
    if (mode === 'edit') {
      setEditForm(prev => (prev.timeSlot === '' ? prev : { ...prev, timeSlot: '' }))
    } else {
      updateOrderCreateDraft(prev => (prev.timeSlot === '' ? prev : { ...prev, timeSlot: '' }))
    }
  }, [open, mode, editForm, draft, hoursSourceFor])

  function requestClose(): void {
    if (saving) return
    setShowDepositConfirm(false)
    onClose()
  }

  function clearDraft(): void {
    clearOrderCreateDraft(defaultStoreId)
    setFormError(null)
    setBudgetSearch('')
    setBudgetSuggestions([])
    setShowDepositConfirm(false)
    prevCartLen.current = 0
  }

  const source = hoursSourceFor(form.storeId)
  const liveBudget = resolvedBudgetLines(form.budgetCart)
  const liveEstimate = estimatedBudgetTotal(liveBudget)
  const livePickupHoursError = pickupHoursLiveErrorOnDate(form.timeSlot, form.pickupTime, source, form.pickupDate)
  const slotAvailability = pickupSlotAvailability(source, form.pickupDate)
  const pickupSlotOptions = (['morning', 'afternoon', 'specific'] as OrderTimeSlot[]).filter(slot => {
    if (slot === 'morning') return slotAvailability.morning
    if (slot === 'afternoon') return slotAvailability.afternoon
    return true
  })
  const formIsValid = Boolean(
    form.customerName.trim() && liveBudget.length > 0 && form.pickupDate && !livePickupHoursError,
  )
  const totalDeposit = depositTotal(form.depositPayments)
  const contentBaseline = showStoreFilter ? defaultStoreId : form.storeId
  const hasDraftContent = mode === 'create' && orderCreateDraftHasContent(form, contentBaseline)

  function setDepositForMethod(method: DepositMethod, rawValue: string): void {
    const amount = parseNumericInput(rawValue) ?? 0
    patchForm(prev => {
      const existing = prev.depositPayments.filter(payment => payment.method !== method)
      if (amount > 0) return { ...prev, depositPayments: [...existing, { method, amount }] }
      return { ...prev, depositPayments: existing }
    })
  }

  function getDepositRaw(method: DepositMethod): string {
    const payment = form.depositPayments.find(item => item.method === method)
    return payment ? formatNumericInputValue(String(payment.amount)) : ''
  }

  async function handleSave(): Promise<void> {
    setFormError(null)
    const customerName = form.customerName.trim()
    const pickupDate = form.pickupDate.trim()
    const total = depositTotal(form.depositPayments)

    if (!customerName) { setFormError('El nombre del cliente es obligatorio.'); return }
    if (resolvedBudgetLines(form.budgetCart).length === 0) {
      setFormError('Agregá al menos un producto con cantidad.'); return
    }
    if (!pickupDate) { setFormError('La fecha de retiro es obligatoria.'); return }
    if (showStoreFilter && !form.storeId) { setFormError('Seleccioná un local para el pedido.'); return }
    if (pickupDate < todayLocalYmd()) { setFormError('La fecha de retiro no puede ser anterior a hoy.'); return }
    if (form.timeSlot === 'specific' && !form.pickupTime) {
      setFormError('Ingresá el horario específico de retiro.'); return
    }
    if (form.timeSlot === 'specific' && form.pickupTime) {
      const closed = pickupHoursLiveErrorOnDate(form.timeSlot, form.pickupTime, hoursSourceFor(form.storeId), form.pickupDate)
      if (closed) { setFormError(closed); return }
    }
    const slotClosed = pickupSlotRegistrationError(form.timeSlot, hoursSourceFor(form.storeId), form.pickupDate)
    if (slotClosed) { setFormError(slotClosed); return }
    if (total > 0 && form.depositPayments.length === 0) {
      setFormError('Seleccioná el medio de pago de la seña.'); return
    }

    if (total > 0) {
      setShowDepositConfirm(true)
      return
    }

    await doSave()
  }

  async function doSave(): Promise<void> {
    setShowDepositConfirm(false)
    const customerName = form.customerName.trim()
    const pickupDate = form.pickupDate.trim()
    const total = depositTotal(form.depositPayments)
    const budgetItems = resolvedBudgetLines(form.budgetCart)
    const items = summarizeBudgetItems(budgetItems)

    setSaving(true)
    try {
      if (mode === 'edit') {
        if (!editingOrder) {
          setFormError('No se encontró el pedido a editar.')
          return
        }
        const payload: UpdateOrderPayload = {
          id: editingOrder.id,
          customerName,
          phone: form.phone.replace(/\s/g, '') || undefined,
          items,
          pickupDate,
          timeSlot: (form.timeSlot || null) as OrderTimeSlot | null,
          pickupTime: form.timeSlot === 'specific' ? form.pickupTime || null : null,
          priority: form.priority,
          notes: form.notes.trim() || null,
          depositAmount: total,
          depositPayments: form.depositPayments.length > 0 ? form.depositPayments : null,
          budgetItems,
        }
        const result = await window.hw.updateOrder(payload)
        if (!result.ok) {
          if (alive.current) setFormError(result.error)
          return
        }
        onSaved(result.data, 'edit')
      } else {
        const payload: CreateOrderPayload = {
          customerName,
          phone: form.phone.replace(/\s/g, '') || undefined,
          items,
          pickupDate,
          timeSlot: (form.timeSlot || undefined) as OrderTimeSlot | undefined,
          pickupTime: form.timeSlot === 'specific' ? form.pickupTime || undefined : undefined,
          priority: form.priority,
          notes: form.notes.trim() || undefined,
          depositAmount: total > 0 ? total : undefined,
          depositPayments: total > 0 ? form.depositPayments : undefined,
          storeId: showStoreFilter && form.storeId ? form.storeId : undefined,
          budgetItems,
        }
        const result = await window.hw.createOrder(payload)
        if (!result.ok) {
          if (alive.current) setFormError(result.error)
          return
        }
        resetOrderCreateDraft()
        showAppToast('Pedido creado')
        onSaved(result.data, 'create')
      }
      onClose()
    } catch (err) {
      console.error('[OrderFormModal] guardar pedido falló', err)
      if (alive.current) {
        setFormError(err instanceof Error ? err.message : 'No se pudo guardar el pedido.')
      }
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  function addBudgetProduct(product: ProductRow): void {
    patchForm(prev => ({
      ...prev,
      budgetCart: [...prev.budgetCart, {
        productId: product.id,
        name: product.name,
        unit: product.unit,
        pluNumber: product.pluNumber ?? null,
        estimatedQty: 1,
        unitPrice: product.price ?? 0,
        qtyRaw: '',
        requestedUnitsRaw: '',
      }],
    }))
    setBudgetSearch('')
    setBudgetSuggestions([])
  }

  return (
    <>
      <Modal
        open={open}
        onClose={requestClose}
        title={title}
        size="md"
        closeOnOverlay={!saving && !showDepositConfirm}
        closeOnEscape={!saving && !showDepositConfirm}
        header={(
          <>
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-ink">
              {title}
            </h2>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              className="shrink-0 rounded-md p-1.5 text-muted hover:bg-hover hover:text-ink transition-colors disabled:opacity-40"
              aria-label="Cerrar"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </>
        )}
        footer={(
          <>
            {hasDraftContent && (
              <Button
                variant="ghost"
                className="mr-auto"
                onClick={clearDraft}
                disabled={saving}
              >
                Borrar borrador
              </Button>
            )}
            <Button variant="secondary" onClick={requestClose} disabled={saving}>
              Cancelar
            </Button>
            <Button
              loading={saving}
              disabled={!formIsValid}
              onClick={() => { void handleSave() }}
            >
              {saving ? 'Guardando…' : mode === 'edit' ? 'Guardar cambios' : 'Crear pedido'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          {showStoreFilter && mode === 'create' && stores.length > 0 && (
            <Field label="Local *">
              <select
                value={form.storeId}
                onChange={event => {
                  const storeId = event.target.value
                  patchForm(prev => {
                    const store = stores.find(item => item.id === storeId)
                    const available = pickupSlotAvailability(
                      store ? storeHoursSourceFromRecord(store) : null,
                      prev.pickupDate,
                    )
                    const timeSlot = (prev.timeSlot === 'afternoon' && !available.afternoon)
                      || (prev.timeSlot === 'morning' && !available.morning)
                      ? ''
                      : prev.timeSlot
                    return { ...prev, storeId, timeSlot }
                  })
                }}
                className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-ink focus:outline-none focus:border-line-accent text-sm"
              >
                <option value="">— Seleccioná un local —</option>
                {stores.map(store => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            </Field>
          )}

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.priority}
              onChange={event => patchForm(prev => ({ ...prev, priority: event.target.checked }))}
              className="w-4 h-4 accent-orange-500"
            />
            <span className="text-sm font-medium text-muted">⚡ Pedido prioritario / importante</span>
          </label>

          <Field label="Nombre del cliente *">
            <input
              type="text"
              value={form.customerName}
              onChange={event => patchForm(prev => ({ ...prev, customerName: event.target.value }))}
              placeholder="Ej: Restaurante El Sol"
              maxLength={100}
              className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-ink placeholder:text-muted focus:outline-none focus:border-line-accent"
            />
          </Field>

          <Field label="Teléfono (opcional)">
            <input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={event => patchForm(prev => ({ ...prev, phone: formatPhoneInput(event.target.value) }))}
              placeholder="+54 9 11 1234-5678"
              maxLength={30}
              className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-ink placeholder:text-muted focus:outline-none focus:border-line-accent"
            />
          </Field>

          <div className="space-y-3 bg-raised rounded-xl p-4 border border-line">
            <p className="text-sm font-medium text-ink">Productos *</p>
            <CollapseReveal open={mode === 'edit' && form.budgetCart.length === 0 && Boolean(form.items)}>
              {form.items ? (
                <p className="text-[11px] text-muted break-words" title={form.items}>
                  Texto anterior: {form.items}
                </p>
              ) : null}
            </CollapseReveal>

            <CollapseReveal open={form.budgetCart.length > 0}>
              <div className="space-y-1.5">
                {form.budgetCart.map((line, idx) => {
                  const isLast = idx === form.budgetCart.length - 1
                  const missingWeight = kgLineMissingWeight(line)
                  return (
                    <div key={`${line.productId}-${idx}`} className="space-y-1">
                      <div className="flex items-center gap-2 bg-hover rounded-lg px-3 py-1.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-ink truncate" title={line.name}>{line.name}</p>
                          <p className="text-[10px] text-muted">{formatARS(line.unitPrice)} / {line.unit === 'kg' ? 'kg' : 'u'}</p>
                        </div>
                        <div className="shrink-0 w-20">
                          {line.unit === 'kg' ? (
                            <DecimalInput
                              ref={isLast ? lastQtyRef : undefined}
                              value={line.qtyRaw}
                              onChange={value => patchForm(prev => ({
                                ...prev,
                                budgetCart: prev.budgetCart.map((item, i) => i === idx ? { ...item, qtyRaw: value } : item),
                              }))}
                              placeholder="kg"
                              maxDecimals={3}
                              weightMode
                              title="Peso estimado"
                              className={`w-full bg-panel rounded px-2 py-1 text-xs text-ink text-right ${
                                missingWeight
                                  ? 'border border-orange-600/80'
                                  : 'border border-line-strong'
                              }`}
                            />
                          ) : (
                            <NumericInput
                              ref={isLast ? lastQtyRef : undefined}
                              value={line.qtyRaw}
                              onChange={value => patchForm(prev => ({
                                ...prev,
                                budgetCart: prev.budgetCart.map((item, i) => i === idx ? { ...item, qtyRaw: value } : item),
                              }))}
                              placeholder="0"
                              title="Cantidad"
                              className="w-full bg-panel border border-line-strong rounded px-2 py-1 text-xs text-ink text-right"
                            />
                          )}
                        </div>
                        <span className="text-[10px] text-muted shrink-0 w-6">{line.unit === 'kg' ? 'kg' : 'u'}</span>
                        {line.unit === 'kg' && (
                          <>
                            <div className="shrink-0 w-12">
                              <NumericInput
                                value={line.requestedUnitsRaw}
                                onChange={value => patchForm(prev => ({
                                  ...prev,
                                  budgetCart: prev.budgetCart.map((item, i) => i === idx ? { ...item, requestedUnitsRaw: value } : item),
                                }))}
                                placeholder=""
                                title="Unidades pedidas (opcional). Vacío = pidió kilos."
                                className="w-full bg-panel border border-line-strong rounded px-2 py-1 text-xs text-ink text-right"
                              />
                            </div>
                            <span className="text-[10px] text-muted shrink-0" title="Unidades pedidas">u</span>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => patchForm(prev => ({
                            ...prev,
                            budgetCart: prev.budgetCart.filter((_, i) => i !== idx),
                          }))}
                          className="shrink-0 text-muted hover:text-danger text-sm"
                          title="Quitar"
                        >
                          ×
                        </button>
                      </div>
                      {missingWeight && (
                        <p className="text-[11px] text-orange-500/85 px-1">
                          Sin kilos no hay precio estimado. Preguntá cuánto pueden pesar y cargalo en kg.
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </CollapseReveal>

            <div>
              <input
                ref={budgetSearchRef}
                type="text"
                value={budgetSearch}
                onChange={event => setBudgetSearch(event.target.value)}
                placeholder="Buscar producto…"
                className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-line-accent"
              />
              <SuggestPopover anchorRef={budgetSearchRef} open={budgetSuggestions.length > 0}>
                <ul>
                  {budgetSuggestions.map(product => (
                    <li key={product.id}>
                      <button
                        type="button"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => addBudgetProduct(product)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink hover:bg-hover"
                      >
                        <span className="min-w-0 flex-1 truncate" title={product.name}>{product.name}</span>
                        <span className="shrink-0 text-muted">{formatARS(product.price ?? 0)}/{product.unit === 'kg' ? 'kg' : 'u'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </SuggestPopover>
            </div>

            <CollapseReveal open={liveEstimate > 0}>
              <div className="flex items-center justify-between pt-1 border-t border-line">
                <span className="text-xs text-muted">Total estimado</span>
                <span className="text-sm font-semibold text-ink tabular-nums">{formatARS(liveEstimate)}</span>
              </div>
            </CollapseReveal>
          </div>

          <Field label="Notas">
            <textarea
              value={form.notes}
              onChange={event => patchForm(prev => ({ ...prev, notes: event.target.value }))}
              placeholder="Observaciones del pedido…"
              rows={2}
              maxLength={300}
              className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-ink placeholder:text-muted focus:outline-none focus:border-line-accent resize-none"
            />
          </Field>

          <Field label="Fecha de retiro *">
            <input
              type="date"
              value={form.pickupDate}
              min={todayLocalYmd()}
              onChange={event => {
                const pickupDate = event.target.value
                patchForm(prev => {
                  const available = pickupSlotAvailability(hoursSourceFor(prev.storeId), pickupDate)
                  const timeSlot = (prev.timeSlot === 'afternoon' && !available.afternoon)
                    || (prev.timeSlot === 'morning' && !available.morning)
                    ? ''
                    : prev.timeSlot
                  return { ...prev, pickupDate, timeSlot }
                })
              }}
              className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-ink focus:outline-none focus:border-line-accent"
            />
          </Field>

          <div className="space-y-2">
            <label className="text-xs text-muted">Horario de retiro (opcional)</label>
            <div className={`grid gap-2 ${pickupSlotOptions.length === 3 ? 'grid-cols-3' : pickupSlotOptions.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {pickupSlotOptions.map(slot => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => patchForm(prev => ({ ...prev, timeSlot: prev.timeSlot === slot ? '' : slot }))}
                  className={`py-2 rounded-lg text-xs font-medium transition-colors border ${
                    form.timeSlot === slot
                      ? 'bg-accent border-line-accent text-ink'
                      : 'bg-panel border-line text-ink hover:bg-hover'
                  }`}
                >
                  {TIME_SLOT_LABELS[slot]}
                </button>
              ))}
            </div>
            <CollapseReveal open={form.timeSlot === 'specific'}>
              <div className="space-y-2">
                <p className="text-xs text-amber-400/90 leading-snug">{PICKUP_SPECIFIC_HINT}</p>
                <input
                  type="time"
                  value={form.pickupTime}
                  onChange={event => {
                    setFormError(null)
                    patchForm(prev => ({ ...prev, pickupTime: event.target.value }))
                  }}
                  className={`w-full bg-panel border rounded-lg px-3 py-2 text-ink focus:outline-none ${
                    livePickupHoursError
                      ? 'border-red-500 focus:border-red-400'
                      : 'border-line focus:border-line-accent'
                  }`}
                />
                {livePickupHoursError && (
                  <p className="text-sm text-danger">{livePickupHoursError}</p>
                )}
              </div>
            </CollapseReveal>
          </div>

          <div className="space-y-3 bg-raised rounded-xl p-4 border border-line">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <p className="text-sm font-medium text-ink">Seña (opcional)</p>
              {totalDeposit > 0 && (
                <span className="shrink-0 text-sm font-semibold text-blue-300">{formatARS(totalDeposit)} total</span>
              )}
            </div>
            <div className="space-y-2">
              {(['cash', 'debit', 'wallet', 'credit'] as DepositMethod[]).map(method => (
                <div key={method} className="flex items-center gap-2">
                  <span className="text-xs text-muted w-28 shrink-0">{DEPOSIT_METHOD_LABELS[method]}</span>
                  <NumericInput
                    value={getDepositRaw(method)}
                    onChange={value => setDepositForMethod(method, value)}
                    placeholder="0"
                    className="flex-1 bg-panel border border-line rounded-lg px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-line-accent"
                  />
                </div>
              ))}
            </div>
          </div>

          <CollapseReveal open={formError != null}>
            {formError ? <p className="text-danger text-sm">{formError}</p> : null}
          </CollapseReveal>
        </div>
      </Modal>

      <Modal
        open={open && showDepositConfirm}
        onClose={() => setShowDepositConfirm(false)}
        title={mode === 'edit' ? 'Confirmar cambios en el pedido' : 'Confirmar pedido con seña'}
        size="sm"
        closeOnOverlay={false}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setShowDepositConfirm(false)} disabled={saving}>
              Volver
            </Button>
            <Button loading={saving} onClick={() => { void doSave() }}>
              {saving ? 'Guardando…' : 'Confirmar'}
            </Button>
          </>
        )}
      >
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="shrink-0 text-muted">Cliente</span>
            <span className="min-w-0 truncate text-ink font-medium" title={form.customerName.trim()}>
              {form.customerName.trim()}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted">Retiro</span>
            <span className="text-ink">{formatYmd(form.pickupDate)}</span>
          </div>
          <div className="border-t border-line pt-2 space-y-1">
            <p className="text-xs text-muted font-semibold uppercase tracking-wider">Seña</p>
            {form.depositPayments.map(payment => (
              <div key={payment.method} className="flex justify-between">
                <span className="text-muted">{DEPOSIT_METHOD_LABELS[payment.method]}</span>
                <span className="text-blue-300 font-semibold">{formatARS(payment.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-1">
              <span className="text-ink font-semibold">Total seña</span>
              <span className="text-blue-300 font-bold">{formatARS(totalDeposit)}</span>
            </div>
          </div>
        </div>
      </Modal>
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted">{label}</label>
      {children}
    </div>
  )
}
