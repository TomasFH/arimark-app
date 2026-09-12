/**
 * Configuración del descuento por pago en efectivo (regla del local).
 */
import { useEffect, useState } from 'react'
import { useBackLayer } from '../lib/backStack'
import { useKeyboardInset } from '../lib/keyboardInset'
import NumericInput from './NumericInput'
import { CashDiscountScheduleEditor } from './CashDiscountScheduleEditor'
import { parseNumericInput } from '../lib/numericInput'
import {
  fetchStoreCashDiscount,
  saveStoreCashDiscount,
  type CashDiscountAuditRemote,
} from '../lib/cashDiscountStore'
import type { CashDiscountBlock, CashDiscountRule } from '@carniceria/shared'

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n)
}

interface Props {
  storeId: string
  actorUserId: string
  actorName: string
  onSaved: (saved: { rule: CashDiscountRule; schedule: CashDiscountBlock[] }) => void
  onClose: () => void
}

export function CashDiscountModal({ storeId, actorUserId, actorName, onSaved, onClose }: Props) {
  useBackLayer(true, onClose)
  const keyboardInset = useKeyboardInset()
  const [minRaw, setMinRaw] = useState('')
  const [percentRaw, setPercentRaw] = useState('')
  const [schedule, setSchedule] = useState<CashDiscountBlock[]>([])
  const [audits, setAudits] = useState<CashDiscountAuditRemote[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetchStoreCashDiscount(storeId)
      .then(data => {
        setMinRaw(data.rule.minAmount > 0 ? String(data.rule.minAmount) : '')
        setPercentRaw(data.rule.percent > 0 ? String(data.rule.percent) : '')
        setSchedule(data.schedule)
        setAudits(data.audits)
      })
      .catch(() => setError('No se pudo leer la regla. Hace falta internet.'))
      .finally(() => setLoading(false))
  }, [storeId])

  async function handleSave() {
    const minAmount = parseNumericInput(minRaw) ?? 0
    const percent = parseNumericInput(percentRaw) ?? 0
    if (percent < 0 || percent > 100) {
      setError('El porcentaje va de 0 a 100 (0 apaga el descuento).')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await saveStoreCashDiscount({
        storeId,
        minAmount,
        percent,
        schedule,
        actorUserId,
        actorName,
      })
      onSaved({ rule: saved.rule, schedule: saved.schedule })
      onClose()
    } catch {
      setError('No se pudo guardar. Hace falta internet.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/80"
      style={{ paddingBottom: keyboardInset }}
    >
      <div className="max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-gray-900 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-white" title="Descuento efectivo">
            Descuento efectivo
          </h2>
          <button type="button" onClick={onClose} className="shrink-0 text-2xl leading-none text-gray-400 hover:text-white">
            ×
          </button>
        </div>

        <p className="text-sm text-gray-400">
          El % se aplica sobre el total de ítems si el saldo se cobra con efectivo. 0 % lo apaga.
        </p>

        {loading ? (
          <p className="text-sm text-gray-500">Cargando…</p>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Mínimo general ($)</label>
              <NumericInput
                value={minRaw}
                onChange={v => { setMinRaw(v); setError(null) }}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="0"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Porcentaje general (0–100)</label>
              <NumericInput
                value={percentRaw}
                onChange={v => { setPercentRaw(v); setError(null) }}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="0"
              />
            </div>
            <CashDiscountScheduleEditor schedule={schedule} onChange={setSchedule} />
          </>
        )}

        {error && <p className="text-center text-sm font-medium text-orange-400">{error}</p>}

        {audits.length > 0 && (
          <ul className="max-h-32 space-y-1 overflow-y-auto">
            {audits.map(a => {
              const line = `${a.actorName} · ${a.previousPercent}% / ${formatARS(a.previousMinAmount)} → ${a.nextPercent}% / ${formatARS(a.nextMinAmount)}`
              return (
                <li key={a.id} className="flex min-w-0 gap-2 text-xs text-gray-500">
                  <span className="min-w-0 flex-1 truncate" title={line}>{line}</span>
                </li>
              )
            })}
          </ul>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl bg-gray-800 py-4 font-semibold text-white transition-colors hover:bg-gray-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className="rounded-xl bg-emerald-700 py-4 font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-40"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
