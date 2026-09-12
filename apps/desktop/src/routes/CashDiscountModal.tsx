/**
 * Configuración del descuento por pago en efectivo (regla del local).
 */
import { useEffect, useState } from 'react'
import NumericInput from '../components/NumericInput'
import CashDiscountScheduleEditor from '../components/CashDiscountScheduleEditor'
import { parseNumericInput } from '../lib/numericInput'
import { formatARS, toLocalDateTime } from '../lib/datetime'
import type { CashDiscountBlock } from '@carniceria/shared'
import { Button, Modal } from '../components/ui'

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

const fieldClass =
  'w-full rounded-xl border border-line bg-input px-3 py-2 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-line-accent'

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
    <Modal
      open
      onClose={onClose}
      closeOnOverlay={!saving}
      closeOnEscape={!saving}
      title="Descuento efectivo"
      size="md"
      footer={(
        <>
          <Button variant="secondary" className="mr-auto" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={saving} disabled={loading}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      )}
    >
      <p className="mb-4 text-sm text-muted">
        El % se aplica sobre el total de ítems si el saldo se cobra con efectivo. 0 % lo apaga.
      </p>

      {loading ? (
        <p className="text-sm text-muted">Cargando…</p>
      ) : (
        <>
          <div className="mb-3 space-y-1">
            <label className="text-sm text-muted">Mínimo general del ticket ($)</label>
            <NumericInput
              value={minRaw}
              onChange={v => { setMinRaw(v); setError(null) }}
              placeholder="0"
              className={fieldClass}
            />
          </div>
          <div className="mb-3 space-y-1">
            <label className="text-sm text-muted">Porcentaje general (0–100)</label>
            <NumericInput
              value={percentRaw}
              onChange={v => { setPercentRaw(v); setError(null) }}
              placeholder="0"
              className={fieldClass}
            />
          </div>
          <p className="mb-3 text-xs text-muted">
            Vale para los días que no marques abajo. Podés subir el % el fin de semana o un turno.
          </p>
          <CashDiscountScheduleEditor schedule={schedule} onChange={setSchedule} />
        </>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {audits.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold text-muted">Últimos cambios</p>
          <ul className="max-h-40 space-y-1.5 overflow-y-auto">
            {audits.map(a => {
              const line = `${a.actorName} · ${a.previousPercent}% / ${formatARS(a.previousMinAmount)} → ${a.nextPercent}% / ${formatARS(a.nextMinAmount)}`
              return (
                <li key={a.id} className="flex min-w-0 items-start gap-2 text-xs text-muted">
                  <span className="shrink-0 text-subtle">{toLocalDateTime(a.createdAt)}</span>
                  <span className="min-w-0 flex-1 truncate" title={line}>{line}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Modal>
  )
}
