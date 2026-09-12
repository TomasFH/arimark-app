/**
 * Excepciones de descuento efectivo por grupos de días y turno.
 * Misma idea que los horarios del local: un día no puede estar en dos bloques.
 */
import NumericInput from './NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import {
  WEEKDAY_SHORT_LABELS,
  WEEKDAY_UI_ORDER,
  addDiscountBlock,
  removeDiscountBlock,
  toggleDayInDiscountSchedule,
  updateDiscountBlockSlot,
  type CashDiscountBlock,
  type CashDiscountRule,
  type Weekday,
} from '@carniceria/shared'

interface Props {
  schedule: CashDiscountBlock[]
  onChange: (next: CashDiscountBlock[]) => void
}

const inputClass =
  'w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 text-sm'

function dayOwnerIndex(schedule: CashDiscountBlock[], day: Weekday): number {
  return schedule.findIndex(block => block.days.includes(day))
}

function SlotFields({
  label,
  rule,
  onChange,
}: {
  label: string
  rule: CashDiscountRule
  onChange: (next: CashDiscountRule) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-400">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1 min-w-0">
          <label className="text-[11px] text-zinc-500">Mínimo $</label>
          <NumericInput
            value={rule.minAmount > 0 ? String(rule.minAmount) : ''}
            onChange={v => onChange({ ...rule, minAmount: parseNumericInput(v) ?? 0 })}
            placeholder="0"
            className={inputClass}
          />
        </div>
        <div className="space-y-1 min-w-0">
          <label className="text-[11px] text-zinc-500">% (0 apaga)</label>
          <NumericInput
            value={rule.percent > 0 ? String(rule.percent) : ''}
            onChange={v => onChange({ ...rule, percent: parseNumericInput(v) ?? 0 })}
            placeholder="0"
            className={inputClass}
          />
        </div>
      </div>
    </div>
  )
}

export default function CashDiscountScheduleEditor({ schedule, onChange }: Props) {
  const blocks = schedule.length > 0 ? schedule : []

  return (
    <div className="space-y-3 border-t border-zinc-700 pt-3">
      <div>
        <p className="text-sm font-medium text-zinc-300">Días o turnos distintos (opcional)</p>
        <p className="text-xs text-zinc-500 mt-0.5">
          Marcá los días que no usan la regla general. 0 % en un turno lo apaga ese día.
        </p>
      </div>

      {blocks.map((block, index) => (
        <div
          key={index}
          className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-900/40 p-3"
        >
          <div className="flex items-center gap-2 min-w-0">
            <p className="min-w-0 flex-1 text-xs font-medium text-zinc-400 truncate">
              Horario especial {blocks.length > 1 ? index + 1 : ''}
            </p>
            {blocks.length > 0 && (
              <button
                type="button"
                onClick={() => onChange(removeDiscountBlock(schedule, index))}
                className="shrink-0 text-xs text-zinc-500 hover:text-red-400/80 transition-colors"
              >
                Quitar
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_UI_ORDER.map(day => {
              const owner = dayOwnerIndex(schedule, day)
              const selectedHere = owner === index
              const selectedOther = owner >= 0 && owner !== index
              return (
                <button
                  key={day}
                  type="button"
                  title={
                    selectedOther
                      ? `Está en el horario ${owner + 1}. Tocá para pasarlo a este.`
                      : selectedHere
                        ? 'Tocá para volver a la regla general'
                        : 'Regla general. Tocá para asignarlo a este horario'
                  }
                  onClick={() => onChange(toggleDayInDiscountSchedule(schedule, index, day))}
                  className={`shrink-0 min-w-[2.5rem] rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                    selectedHere
                      ? 'bg-emerald-600 text-white'
                      : selectedOther
                        ? 'border border-zinc-600 bg-zinc-800 text-zinc-500'
                        : 'border border-zinc-600 bg-zinc-800 text-zinc-300 hover:border-zinc-500'
                  }`}
                >
                  {WEEKDAY_SHORT_LABELS[day]}
                </button>
              )
            })}
          </div>

          <SlotFields
            label="Turno mañana"
            rule={block.morning}
            onChange={next => onChange(updateDiscountBlockSlot(schedule, index, 'morning', next))}
          />
          <SlotFields
            label="Turno tarde"
            rule={block.afternoon}
            onChange={next => onChange(updateDiscountBlockSlot(schedule, index, 'afternoon', next))}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange(addDiscountBlock(schedule.length > 0 ? schedule : []))}
        className="w-full rounded-lg border border-dashed border-zinc-600 py-2 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
      >
        Agregar horario especial
      </button>
    </div>
  )
}
