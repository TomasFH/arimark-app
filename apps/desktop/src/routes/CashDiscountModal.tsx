/**
 * Configuración del descuento por pago en efectivo (regla del local).
 */
import { useEffect, useState } from 'react'
import NumericInput from '../components/NumericInput'
import CashDiscountScheduleEditor from '../components/CashDiscountScheduleEditor'
import { parseNumericInput } from '../lib/numericInput'
import { formatARS, toLocalDateTime } from '../lib/datetime'
import type { CashDiscountBlock } from '@carniceria/shared'

interface AuditRow {
  id: string
  createdAt: string
  actorName: string
  previousMinAmount: number
  previousPercent: number
  nextMinAmount: number
  nextPercent: number
}

interface Props {
  onClose: () => void
}

export default function CashDiscountModal({ onClose }: Props) {
  const [minRaw, setMinRaw] = useState('')
  const [percentRaw, setPercentRaw] = useState('')
  const [schedule, setSchedule] = useState<CashDiscountBlock[]>([])
  const [audits, setAudits] = useState<AuditRow[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.hw.getCashDiscountRule().then(r => {
      setLoading(false)
      if (!r.ok) {
        setError(r.error)
        return
      }
      setMinRaw(r.data.minAmount > 0 ? String(r.data.minAmount) : '')
      setPercentRaw(r.data.percent > 0 ? String(r.data.percent) : '')
      setSchedule(r.data.schedule)
      setAudits(r.data.audits)
    })
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onClose])

  async function handleSave() {
    const minAmount = parseNumericInput(minRaw) ?? 0
    const percent = parseNumericInput(percentRaw) ?? 0
    if (percent < 0 || percent > 100) {
      setError('El porcentaje va de 0 a 100 (0 apaga el descuento).')
      return
    }
    for (const block of schedule) {
      if (block.morning.percent > 100 || block.afternoon.percent > 100) {
        setError('El porcentaje de cada turno va de 0 a 100.')
        return
      }
    }
    setSaving(true)
    setError(null)
    const r = await window.hw.setCashDiscountRule({ minAmount, percent, schedule })
    setSaving(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setAudits(r.data.audits)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-zinc-800 rounded-2xl w-full max-w-md shadow-xl space-y-4 p-6 border border-zinc-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold min-w-0 truncate" title="Descuento efectivo">
            Descuento efectivo
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="shrink-0 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 p-1"
            aria-label="Cerrar"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-zinc-400">
          El % se aplica sobre el total de ítems si el saldo se cobra con efectivo. 0 % lo apaga.
        </p>

        {loading ? (
          <p className="text-sm text-zinc-500">Cargando…</p>
        ) : (
          <>
            <div className="space-y-1">
              <label className="text-sm text-zinc-400">Mínimo general del ticket ($)</label>
              <NumericInput
                value={minRaw}
                onChange={v => { setMinRaw(v); setError(null) }}
                placeholder="0"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-zinc-400">Porcentaje general (0–100)</label>
              <NumericInput
                value={percentRaw}
                onChange={v => { setPercentRaw(v); setError(null) }}
                placeholder="0"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <p className="text-xs text-zinc-500">
              Vale para los días que no marques abajo. Podés subir el % el fin de semana o un turno.
            </p>
            <CashDiscountScheduleEditor schedule={schedule} onChange={setSchedule} />
          </>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {audits.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Últimos cambios</p>
            <ul className="space-y-1.5 max-h-40 overflow-y-auto">
              {audits.map(a => {
                const line = `${a.actorName} · ${a.previousPercent}% / ${formatARS(a.previousMinAmount)} → ${a.nextPercent}% / ${formatARS(a.nextMinAmount)}`
                return (
                  <li key={a.id} className="flex items-start gap-2 min-w-0 text-xs text-zinc-400">
                    <span className="shrink-0 text-zinc-600">{toLocalDateTime(a.createdAt)}</span>
                    <span className="min-w-0 flex-1 truncate" title={line}>{line}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 text-sm"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold transition-colors disabled:opacity-40 text-sm"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
