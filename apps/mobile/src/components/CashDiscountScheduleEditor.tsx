/**
 * Excepciones de descuento efectivo por grupos de días y turno.
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
  'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500'

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
      <p className="text-xs text-gray-400">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <label className="mb-1 block text-[11px] text-gray-500">Mínimo $</label>
          <NumericInput
            value={rule.minAmount > 0 ? String(rule.minAmount) : ''}
            onChange={v => onChange({ ...rule, minAmount: parseNumericInput(v) ?? 0 })}
            placeholder="0"
            className={inputClass}
          />
        </div>
        <div className="min-w-0">
          <label className="mb-1 block text-[11px] text-gray-500">% (0 apaga)</label>
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

export function CashDiscountScheduleEditor({ schedule, onChange }: Props) {
  const blocks = schedule.length > 0 ? schedule : []

  return (
    <div className="space-y-3 border-t border-gray-800 pt-3">
      <div>
        <p className="text-sm font-medium text-gray-200">Días o turnos distintos</p>
        <p className="mt-0.5 text-xs text-gray-500">
          Marcá los días que no usan la regla general. 0 % apaga ese turno.
        </p>
      </div>

      {blocks.map((block, index) => (
        <div key={index} className="space-y-3 rounded-xl border border-gray-700 bg-gray-800/40 p-3">
          <div className="flex items-center gap-2 min-w-0">
            <p className="min-w-0 flex-1 truncate text-xs font-medium text-gray-400">
              Horario especial {blocks.length > 1 ? index + 1 : ''}
            </p>
            <button
              type="button"
              onClick={() => onChange(removeDiscountBlock(schedule, index))}
              className="shrink-0 text-xs text-gray-500"
            >
              Quitar horario
            </button>
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
                  onClick={() => onChange(toggleDayInDiscountSchedule(schedule, index, day))}
                  className={`shrink-0 min-w-[2.5rem] rounded-lg px-2 py-1.5 text-xs font-semibold ${
                    selectedHere
                      ? 'bg-emerald-600 text-white'
                      : selectedOther
                        ? 'border border-gray-600 bg-gray-800 text-gray-500'
                        : 'border border-gray-600 bg-gray-800 text-gray-300'
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
        className="w-full rounded-lg border border-dashed border-gray-600 py-2 text-xs text-gray-400"
      >
        Agregar horario especial
      </button>
    </div>
  )
}
