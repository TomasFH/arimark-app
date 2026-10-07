/**
 * Registro de sebo del turno: kilos, nota e importe opcional.
 * Sin importe no mueve caja. Con importe queda una venta.
 */
import { useEffect, useState } from 'react'
import DecimalInput from '../components/DecimalInput'
import NumericInput from '../components/NumericInput'
import { parseDecimalInput, parseNumericInput } from '../lib/numericInput'
import { formatARS, formatKg, toLocalTime } from '../lib/datetime'
import { PAYMENT_LABELS, type PaymentMethod } from '../lib/paymentMethod'
import { formatWeekRangeLabel, mondayWeekRange } from '@carniceria/shared'
import { Button, Modal } from '../components/ui'

const NOTES_MAX = 300
const AMOUNT_MAX = 999_999_999
const METHODS: PaymentMethod[] = ['cash', 'debit', 'wallet', 'credit']

interface CeboRow {
  id: string
  quantityKg: number
  notes: string | null
  createdByName: string
  createdAt: string
  updatedByName: string | null
  updatedAt: string | null
  canEdit: boolean
  amount: number | null
  paymentMethod: PaymentMethod | null
}

interface Props {
  onClose: () => void
}

const fieldClass =
  'w-full rounded-xl border border-line bg-input px-3 py-2 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-line-accent'

export default function CeboModal({ onClose }: Props) {
  const [rows, setRows] = useState<CeboRow[]>([])
  const [kgRaw, setKgRaw] = useState('')
  const [notes, setNotes] = useState('')
  const [amountRaw, setAmountRaw] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [listLoading, setListLoading] = useState(true)
  const week = mondayWeekRange(weekOffset)
  const canRegister = weekOffset === 0
  const editingRow = editingId ? rows.find(row => row.id === editingId) : undefined
  const editingPaid = editingRow?.amount != null && editingRow.paymentMethod != null

  function changeWeek(next: number) {
    setWeekOffset(next)
    setRows([])
    setListLoading(true)
    setEditingId(null)
    setKgRaw('')
    setNotes('')
    setAmountRaw('')
    setPaymentMethod(null)
    setError(null)
  }

  useEffect(() => {
    let cancelled = false
    void window.hw.listShiftCebo({ weekOffset }).then(r => {
      if (cancelled) return
      setListLoading(false)
      if (!r.ok) {
        setError(r.error)
        setRows([])
        return
      }
      setRows([...r.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    })
    return () => { cancelled = true }
  }, [weekOffset])

  function startEdit(row: CeboRow) {
    setEditingId(row.id)
    setKgRaw(String(row.quantityKg).replace('.', ','))
    setNotes(row.notes ?? '')
    setAmountRaw('')
    setPaymentMethod(null)
    setError(null)
  }

  function resetForm() {
    setEditingId(null)
    setKgRaw('')
    setNotes('')
    setAmountRaw('')
    setPaymentMethod(null)
  }

  async function handleSubmit() {
    const kg = parseDecimalInput(kgRaw)
    if (kg === null || kg <= 0) {
      setError('Ingresá los kilos (mayor a 0).')
      return
    }

    let amount: number | undefined
    let method: PaymentMethod | undefined
    if (!editingPaid) {
      if (amountRaw.trim() !== '') {
        const parsedAmount = parseNumericInput(amountRaw)
        if (parsedAmount === null || parsedAmount <= 0) {
          setError('Ingresá un importe válido.')
          return
        }
        if (parsedAmount > AMOUNT_MAX) {
          setError('El importe es demasiado grande.')
          return
        }
        if (!paymentMethod) {
          setError('Elegí el medio de pago.')
          return
        }
        amount = parsedAmount
        method = paymentMethod
      }
    }

    setSaving(true)
    setError(null)
    const payload = {
      quantityKg: kg,
      notes: notes.trim() || undefined,
      ...(amount != null && method ? { amount, paymentMethod: method } : {}),
    }
    const r = editingId
      ? await window.hw.updateCebo({ id: editingId, ...payload })
      : await window.hw.registerCebo(payload)
    setSaving(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    resetForm()
    setListLoading(true)
    const listed = await window.hw.listShiftCebo({ weekOffset })
    setListLoading(false)
    if (listed.ok) {
      setRows([...listed.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    }
  }

  const weekTitle = formatWeekRangeLabel(week.startYmd, week.endInclusiveYmd)
  const paidLabel = editingPaid && editingRow?.amount != null && editingRow.paymentMethod
    ? `Cobrado ${formatARS(editingRow.amount)} · ${PAYMENT_LABELS[editingRow.paymentMethod]}`
    : null

  return (
    <Modal
      open
      onClose={onClose}
      closeOnOverlay={!saving}
      closeOnEscape={!saving}
      title="Sebo"
      size="md"
      footer={(
        <>
          {editingId ? (
            <Button variant="secondary" className="mr-auto" onClick={resetForm} disabled={saving}>
              Cancelar edición
            </Button>
          ) : (
            <Button variant="secondary" className="mr-auto" onClick={onClose} disabled={saving}>
              Cerrar
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            loading={saving}
            disabled={!canRegister && !editingId}
          >
            {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Registrar'}
          </Button>
        </>
      )}
    >
      <p className="mb-4 text-sm text-muted">
        Anotá los kilos y, si hace falta, una nota. No mueve stock. El importe es opcional: sin importe queda solo la entrega y no entra plata a la caja. Con importe queda como venta: el efectivo suma a la caja y un medio digital no.
      </p>

      <div className="mb-4 flex min-w-0 items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => changeWeek(weekOffset - 1)}>
          ← Anterior
        </Button>
        <p className="min-w-0 flex-1 truncate text-center text-xs text-muted" title={weekTitle}>
          {weekTitle}
          {weekOffset === 0 ? ' (actual)' : ''}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => changeWeek(Math.min(0, weekOffset + 1))}
          disabled={weekOffset === 0}
        >
          Siguiente →
        </Button>
      </div>

      <ul className="mb-4 max-h-48 space-y-2 overflow-y-auto">
        {!listLoading && rows.length === 0 && (
          <li className="py-2 text-center text-sm text-muted">Sin sebo esta semana.</li>
        )}
        {rows.map(row => {
          const loaded = `Cargó ${row.createdByName} · ${toLocalTime(row.createdAt)}`
          const edited = row.updatedAt && row.updatedByName
            ? `Editó ${row.updatedByName} · ${toLocalTime(row.updatedAt)}`
            : null
          const charged = row.amount != null && row.paymentMethod
            ? `${formatARS(row.amount)} · ${PAYMENT_LABELS[row.paymentMethod]}`
            : null
          return (
            <li key={row.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" title={formatKg(row.quantityKg)}>
                  {formatKg(row.quantityKg)}
                </p>
                {charged && (
                  <p className="truncate text-xs text-ink" title={charged}>{charged}</p>
                )}
                {row.notes && (
                  <p className="truncate text-xs text-muted" title={row.notes}>{row.notes}</p>
                )}
                <p className="truncate text-[11px] text-subtle" title={loaded}>{loaded}</p>
                {edited && (
                  <p className="truncate text-[11px] text-subtle" title={edited}>{edited}</p>
                )}
              </div>
              {row.canEdit && (
                <Button variant="secondary" size="sm" className="shrink-0" onClick={() => startEdit(row)}>
                  Editar
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      {canRegister || editingId ? (
        <>
          <div className="mb-3 space-y-1">
            <label className="text-sm text-muted">{editingId ? 'Kilos (edición)' : 'Kilos'}</label>
            <DecimalInput
              value={kgRaw}
              onChange={v => { setKgRaw(v); setError(null) }}
              maxDecimals={3}
              weightMode
              placeholder="0,000"
              className={fieldClass}
            />
          </div>
          <div className="mb-3 space-y-1">
            <label className="text-sm text-muted">Nota (opcional)</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              maxLength={NOTES_MAX}
              placeholder="Observaciones…"
              className={fieldClass}
            />
          </div>
          {paidLabel ? (
            <p className="truncate text-sm text-ink" title={paidLabel}>{paidLabel}</p>
          ) : canRegister ? (
            <>
              <div className="mb-3 space-y-1">
                <label className="text-sm text-muted" htmlFor="sebo-importe">Importe (opcional)</label>
                <NumericInput
                  id="sebo-importe"
                  value={amountRaw}
                  onChange={v => {
                    setAmountRaw(v)
                    if (v.trim() === '') setPaymentMethod(null)
                    setError(null)
                  }}
                  aria-label="Importe"
                  className={fieldClass}
                />
              </div>
              {amountRaw.trim() !== '' && (
                <div className="space-y-1">
                  <p className="text-sm text-muted">Medio de pago</p>
                  <div className="flex flex-wrap gap-2">
                    {METHODS.map(method => (
                      <Button
                        key={method}
                        size="sm"
                        variant={paymentMethod === method ? 'primary' : 'secondary'}
                        aria-pressed={paymentMethod === method}
                        onClick={() => { setPaymentMethod(method); setError(null) }}
                      >
                        {PAYMENT_LABELS[method]}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-muted">Para anotar sebo, volvé a la semana actual.</p>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Modal>
  )
}
