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
  'flex-1 bg-input border border-line-strong rounded-lg px-3 py-2 text-ink placeholder:text-muted focus:outline-none focus:border-line-accent text-sm'

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
      <label className="text-xs text-muted">{label}</label>
      <div className="flex items-center gap-2 min-w-0">
        <input
          type="time"
          value={start ?? ''}
          onChange={e => onStart(e.target.value)}
          className={timeInputClass}
        />
        <span className="text-muted shrink-0 text-xs">hasta</span>
        <input
          type="time"
          value={end ?? ''}
          onChange={e => onEnd(e.target.value)}
          className={timeInputClass}
        />
      </div>
    </div>
  )
}

export default function StoreHoursScheduleEditor({ schedule, onChange }: Props) {
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <div>
        <p className="text-sm font-medium text-ink">Horarios de atención (opcional)</p>
        <p className="text-xs text-muted mt-0.5">
          Marcá los días que comparten el mismo horario. Los días sin marcar quedan cerrados.
          Si un día es distinto, agregá otro horario.
        </p>
      </div>

      {schedule.map((block, index) => {
        const hoursError = validateShiftHours(block)
        const liveError = hoursError === SHIFT_HOURS_OVERLAP_MESSAGE || hoursError === SHIFT_HOURS_INVERTED_MESSAGE
          ? hoursError
          : null
        return (
          <div
            key={index}
            className="space-y-3 rounded-xl border border-line bg-panel/40 p-3"
          >
            <div className="flex items-center gap-2 min-w-0">
              <p className="min-w-0 flex-1 text-xs font-medium text-muted truncate">
                Horario {schedule.length > 1 ? index + 1 : ''}
              </p>
              {schedule.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(removeHoursBlock(schedule, index))}
                  className="shrink-0 text-xs text-muted hover:text-red-400/80 transition-colors"
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
                          ? 'Tocá para dejar este día cerrado'
                          : 'Cerrado. Tocá para asignarlo a este horario'
                    }
                    onClick={() => onChange(toggleDayInSchedule(schedule, index, day))}
                    className={`shrink-0 min-w-[2.5rem] rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                      selectedHere
                        ? 'bg-accent text-ink'
                        : selectedOther
                          ? 'border border-line-strong bg-raised text-muted'
                          : 'border border-line-strong bg-raised text-ink hover:border-line-strong'
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

            {liveError && (
              <p className="text-xs text-red-400/90">{liveError}</p>
            )}
          </div>
        )
      })}

      <button
        type="button"
        onClick={() => onChange(addHoursBlock(schedule))}
        className="w-full py-2 rounded-xl border border-dashed border-line-strong text-xs text-muted hover:border-line-strong hover:text-ink transition-colors"
      >
        + Otro horario
      </button>
    </div>
  )
}
