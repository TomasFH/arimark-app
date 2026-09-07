import {
  SHIFT_HOURS_INVERTED_MESSAGE,
  SHIFT_HOURS_OVERLAP_MESSAGE,
  WEEKDAY_SHORT_LABELS,
  WEEKDAY_UI_ORDER,
  addHoursBlock,
  removeHoursBlock,
  toggleDayInSchedule,
  updateHoursBlock,
  validateShiftHours,
  type StoreHoursBlock,
  type Weekday,
} from '@carniceria/shared'

interface Props {
  schedule: StoreHoursBlock[]
  onChange: (next: StoreHoursBlock[]) => void
}

const timeInputClass =
  'min-w-0 flex-1 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none'

function dayOwnerIndex(schedule: StoreHoursBlock[], day: Weekday): number {
  return schedule.findIndex(block => block.days.includes(day))
}

function ShiftRange({
  label,
  start,
  end,
  onStart,
  onEnd,
}: {
  label: string
  start: string | null
  end: string | null
  onStart: (value: string) => void
  onEnd: (value: string) => void
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-zinc-400">{label}</label>
      <div className="flex items-center gap-2 min-w-0">
        <input type="time" value={start ?? ''} onChange={e => onStart(e.target.value)} className={timeInputClass} />
        <span className="shrink-0 text-xs text-zinc-500">hasta</span>
        <input type="time" value={end ?? ''} onChange={e => onEnd(e.target.value)} className={timeInputClass} />
      </div>
    </div>
  )
}

export function StoreHoursScheduleEditor({ schedule, onChange }: Props) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-zinc-300">Horarios de atención</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          Marcá los días que comparten el mismo horario. Sin marcar = cerrado. Si un día es distinto, agregá otro horario.
        </p>
      </div>

      {schedule.map((block, index) => {
        const hoursError = validateShiftHours(block)
        const liveError = hoursError === SHIFT_HOURS_OVERLAP_MESSAGE || hoursError === SHIFT_HOURS_INVERTED_MESSAGE
          ? hoursError
          : null
        return (
          <div key={index} className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-950/50 p-3">
            <div className="flex items-center gap-2 min-w-0">
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-400">
                Horario {schedule.length > 1 ? index + 1 : ''}
              </p>
              {schedule.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(removeHoursBlock(schedule, index))}
                  className="shrink-0 text-xs text-zinc-500"
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
                    title={WEEKDAY_SHORT_LABELS[day]}
                    onClick={() => onChange(toggleDayInSchedule(schedule, index, day))}
                    className={`shrink-0 min-w-[2.5rem] rounded-lg px-2 py-2 text-xs font-semibold ${
                      selectedHere
                        ? 'bg-emerald-600 text-white'
                        : selectedOther
                          ? 'border border-zinc-600 bg-zinc-800 text-zinc-500'
                          : 'border border-zinc-600 bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    {WEEKDAY_SHORT_LABELS[day]}
                  </button>
                )
              })}
            </div>

            <ShiftRange
              label="Turno mañana"
              start={block.morningStart}
              end={block.morningEnd}
              onStart={value => onChange(updateHoursBlock(schedule, index, { morningStart: value || null }))}
              onEnd={value => onChange(updateHoursBlock(schedule, index, { morningEnd: value || null }))}
            />
            <ShiftRange
              label="Turno tarde (opcional)"
              start={block.afternoonStart}
              end={block.afternoonEnd}
              onStart={value => onChange(updateHoursBlock(schedule, index, { afternoonStart: value || null }))}
              onEnd={value => onChange(updateHoursBlock(schedule, index, { afternoonEnd: value || null }))}
            />
            {liveError && <p className="text-xs text-red-400/90">{liveError}</p>}
          </div>
        )
      })}

      <button
        type="button"
        onClick={() => onChange(addHoursBlock(schedule))}
        className="w-full rounded-xl border border-dashed border-zinc-600 py-2 text-xs text-zinc-400"
      >
        + Otro horario
      </button>
    </div>
  )
}
