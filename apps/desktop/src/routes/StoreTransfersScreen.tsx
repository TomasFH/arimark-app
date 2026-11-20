/**
 * Alta, lista y confirmación de transferencias entre locales.
 * Abrir la pantalla no vuelve a pedir Firestore si este rango ya se leyó
 * en la sesión. Actualizar sí.
 */
import { useEffect, useRef, useState } from 'react'
import {
  civilYmd,
  formatWeekRangeLabel,
  mondayWeekRange,
  storeTransferLabel,
  transferOccurredAt,
  type StoreTransferUnit,
} from '@carniceria/shared'
import { AdminSectionHeader } from '../components/AdminSectionHeader'
import DecimalInput from '../components/DecimalInput'
import NumericInput from '../components/NumericInput'
import { Button } from '../components/ui'
import { formatARS } from '../lib/datetime'
import { parseDecimalInput, parseNumericInput } from '../lib/numericInput'
import type { SessionInfo, StoreRow, StoreTransferRow } from '../types/hw-api'

const MIN_WEEK_OFFSET = -104

interface Props {
  session: Pick<SessionInfo, 'userId' | 'role' | 'storeId'>
  onBack: () => void
  onLogout: () => void
}

function quantityText(quantity: number, unit: StoreTransferUnit): string {
  if (unit === 'kg') return `${quantity} kg`
  if (unit === 'u') return quantity === 1 ? '1 unidad' : `${quantity} unidades`
  return quantity === 1 ? '1 cajón' : `${quantity} cajones`
}

function parseQuantity(raw: string, unit: StoreTransferUnit): number | null {
  return unit === 'kg' ? parseDecimalInput(raw) : parseNumericInput(raw)
}

export default function StoreTransfersScreen({ session, onBack, onLogout }: Props) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [reload, setReload] = useState(0)
  const refreshRef = useRef(false)
  const [stores, setStores] = useState<StoreRow[]>([])
  const [rows, setRows] = useState<StoreTransferRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const week = mondayWeekRange(weekOffset)
  const storeName = new Map(stores.map(store => [store.id, store.name]))

  useEffect(() => {
    let cancelled = false
    void window.hw.getStores().then(result => {
      if (cancelled || !result.ok) return
      setStores(result.data.filter(store => !store.archivedAt))
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const refresh = refreshRef.current
    setLoading(true)
    setError(null)
    void window.hw.listStoreTransfers({
      startIso: week.startIso,
      endIso: week.endIso,
      refresh,
    }).then(result => {
      if (cancelled) return
      if (!result.ok) {
        setError(result.error ?? 'No se pudieron leer las transferencias.')
        setLoading(false)
        return
      }
      setRows(result.data)
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setError('No se pudieron leer las transferencias.')
      setLoading(false)
    }).finally(() => {
      // StrictMode corre el efecto dos veces y descarta la primera.
      // La bandera se apaga recién cuando la lectura que queda termina.
      if (!cancelled) refreshRef.current = false
    })
    return () => { cancelled = true }
  }, [week.startIso, week.endIso, reload])

  function reloadList(refresh: boolean): void {
    refreshRef.current = refresh
    setReload(token => token + 1)
  }

  const caption = formatWeekRangeLabel(week.startYmd, week.endInclusiveYmd)

  return (
    <div className="flex h-full min-h-0 flex-col bg-app text-ink">
      <AdminSectionHeader
        title="Transferencias"
        subtitle={caption}
        onBack={onBack}
        onLogout={onLogout}
        actions={(
          <Button variant="secondary" size="sm" onClick={() => reloadList(true)}>
            Actualizar
          </Button>
        )}
      />
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <Button variant="secondary" size="sm" disabled={weekOffset <= MIN_WEEK_OFFSET} onClick={() => setWeekOffset(value => value - 1)}>
              Semana anterior
            </Button>
            <p className="min-w-0 truncate text-sm text-muted" title={caption}>{caption}</p>
            <Button variant="secondary" size="sm" disabled={weekOffset === 0} onClick={() => setWeekOffset(value => value + 1)}>
              Semana siguiente
            </Button>
          </div>

          <TransferForm
            stores={stores}
            defaultFromStoreId={session.storeId ?? ''}
            onCreated={() => reloadList(false)}
          />

          {error && <p className="truncate text-sm text-danger" title={error}>{error}</p>}
          {loading && <p className="text-sm text-muted">Cargando…</p>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-muted">No hay transferencias en esta semana.</p>
          )}
          <ul className="space-y-3">
            {rows.map(row => (
              <li key={row.id} className="rounded-xl border border-line bg-panel p-4">
                <TransferRow
                  row={row}
                  session={session}
                  fromName={storeName.get(row.fromStoreId) ?? row.fromStoreId}
                  toName={storeName.get(row.toStoreId) ?? row.toStoreId}
                  onChanged={() => reloadList(false)}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function TransferForm({
  stores,
  defaultFromStoreId,
  onCreated,
}: {
  stores: StoreRow[]
  defaultFromStoreId: string
  onCreated: () => void
}) {
  const [productName, setProductName] = useState('')
  const [unit, setUnit] = useState<StoreTransferUnit>('kg')
  const [quantityRaw, setQuantityRaw] = useState('')
  const [fromStoreId, setFromStoreId] = useState(defaultFromStoreId)
  const [toStoreId, setToStoreId] = useState('')
  const [date, setDate] = useState(civilYmd())
  const [notes, setNotes] = useState('')
  const [valueRaw, setValueRaw] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    const occurredAt = transferOccurredAt(date)
    const quantity = parseQuantity(quantityRaw, unit)
    if (!occurredAt || quantity == null) {
      setError('Revisá la fecha y la cantidad.')
      return
    }
    const estimatedValue = valueRaw.trim() === '' ? null : parseNumericInput(valueRaw)
    if (valueRaw.trim() !== '' && estimatedValue == null) {
      setError('El valor estimado no es válido.')
      return
    }
    setSaving(true)
    setError(null)
    const result = await window.hw.createStoreTransfer({
      productName,
      quantity,
      unit,
      fromStoreId,
      toStoreId,
      occurredAt,
      notes: notes.trim() === '' ? null : notes.trim(),
      estimatedValue,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error ?? 'No se pudo guardar la transferencia.')
      return
    }
    setProductName('')
    setQuantityRaw('')
    setNotes('')
    setValueRaw('')
    onCreated()
  }

  return (
    <form
      className="space-y-3 rounded-xl border border-line bg-panel p-4"
      onSubmit={event => {
        event.preventDefault()
        void save()
      }}
    >
      <h2 className="text-sm font-semibold text-ink">Nueva transferencia</h2>
      <label className="block space-y-1">
        <span className="text-xs text-muted">Producto</span>
        <input
          value={productName}
          onChange={event => setProductName(event.target.value)}
          maxLength={80}
          required
          className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs text-muted">Cantidad</span>
          {unit === 'kg' ? (
            <DecimalInput
              value={quantityRaw}
              onChange={setQuantityRaw}
              weightMode
              className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
            />
          ) : (
            <NumericInput
              value={quantityRaw}
              onChange={setQuantityRaw}
              className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
            />
          )}
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted">Unidad</span>
          <select
            aria-label="Unidad"
            value={unit}
            onChange={event => {
              setUnit(event.target.value as StoreTransferUnit)
              setQuantityRaw('')
            }}
            className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
          >
            <option value="kg">kg</option>
            <option value="u">unidades</option>
            <option value="cajon">cajones</option>
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs text-muted">Sale de</span>
          <select
            aria-label="Sale de"
            value={fromStoreId}
            onChange={event => setFromStoreId(event.target.value)}
            className="h-9 w-full min-w-0 truncate rounded-lg border border-line bg-input px-2 text-sm text-ink"
          >
            <option value="">Elegir local</option>
            {stores.map(store => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted">Llega a</span>
          <select
            aria-label="Llega a"
            value={toStoreId}
            onChange={event => setToStoreId(event.target.value)}
            className="h-9 w-full min-w-0 truncate rounded-lg border border-line bg-input px-2 text-sm text-ink"
          >
            <option value="">Elegir local</option>
            {stores.map(store => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-muted">Fecha</span>
        <input
          type="date"
          aria-label="Fecha"
          value={date}
          onChange={event => setDate(event.target.value)}
          className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted">Nota</span>
        <input
          value={notes}
          onChange={event => setNotes(event.target.value)}
          maxLength={300}
          className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted">Valor estimado</span>
        <NumericInput
          aria-label="Valor estimado"
          value={valueRaw}
          onChange={setValueRaw}
          className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
        />
        <span className="text-xs text-muted">Opcional. No es una compra ni un gasto.</span>
      </label>
      {error && <p className="truncate text-sm text-danger" title={error}>{error}</p>}
      <Button type="submit" disabled={saving}>Guardar</Button>
    </form>
  )
}

function TransferRow({
  row,
  session,
  fromName,
  toName,
  onChanged,
}: {
  row: StoreTransferRow
  session: Pick<SessionInfo, 'userId' | 'role'>
  fromName: string
  toName: string
  onChanged: () => void
}) {
  const [receivedRaw, setReceivedRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const route = `${fromName} → ${toName}`
  const canCancel = row.status === 'pending' && (session.role === 'admin' || session.userId === row.createdBy)
  const label = storeTransferLabel(row)

  async function confirm(): Promise<void> {
    const receivedQuantity = parseQuantity(receivedRaw, row.unit)
    if (receivedQuantity == null) {
      setError('La cantidad recibida no es válida.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await window.hw.confirmStoreTransfer({ id: row.id, receivedQuantity })
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? 'No se pudo confirmar.')
      return
    }
    onChanged()
  }

  async function cancel(): Promise<void> {
    setBusy(true)
    setError(null)
    const result = await window.hw.cancelStoreTransfer({ id: row.id })
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? 'No se pudo cancelar.')
      return
    }
    onChanged()
  }

  return (
    <div className="space-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={row.productName}>{row.productName}</p>
        <span className="shrink-0 text-xs text-muted">{label}</span>
      </div>
      <p className="truncate text-sm text-muted" title={route}>{`${quantityText(row.quantity, row.unit)} · ${route}`}</p>
      {row.estimatedValue != null && (
        <p className="text-sm text-ink">{`Valor estimado ${formatARS(row.estimatedValue)}`}</p>
      )}
      {row.notes && <p className="truncate text-sm text-muted" title={row.notes}>{row.notes}</p>}
      {row.status === 'pending' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1">
            <span className="text-xs text-muted">Cantidad recibida</span>
            {row.unit === 'kg' ? (
              <DecimalInput
                aria-label={`Cantidad recibida de ${row.productName}`}
                value={receivedRaw}
                onChange={setReceivedRaw}
                weightMode
                className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
              />
            ) : (
              <NumericInput
                aria-label={`Cantidad recibida de ${row.productName}`}
                value={receivedRaw}
                onChange={setReceivedRaw}
                className="h-9 w-full rounded-lg border border-line bg-input px-2 text-sm text-ink"
              />
            )}
          </label>
          <Button type="button" size="sm" disabled={busy} onClick={() => { void confirm() }}>Confirmar</Button>
          {canCancel && (
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => { void cancel() }}>
              Cancelar
            </Button>
          )}
        </div>
      )}
      {error && <p className="truncate text-sm text-danger" title={error}>{error}</p>}
    </div>
  )
}
