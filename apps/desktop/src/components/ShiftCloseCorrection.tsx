/**
 * El cierre se lee. «Corregir cierre» queda a la vista: no es una acción del menú.
 */
import { useState } from 'react'
import { CollapseReveal } from './ui'
import ShiftCloseAmountsForm from './ShiftCloseAmountsForm'
import { formatARS } from '../lib/datetime'

interface Props {
  cashLeft: number | null
  withdrawn: number | null
  onSubmit: (patch: { cashLeft?: number; withdrawn?: number }) => Promise<void>
}

function amountText(value: number | null): string {
  return value == null ? 'sin anotar' : formatARS(value)
}

export default function ShiftCloseCorrection({ cashLeft, withdrawn, onSubmit }: Props) {
  const [editing, setEditing] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex min-w-0 items-start gap-2">
        <dl className="min-w-0 flex-1 space-y-1.5">
          <AmountFact label="Quedó en la caja" value={amountText(cashLeft)} />
          <AmountFact label="Se retiró" value={amountText(withdrawn)} />
        </dl>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:bg-hover"
        >
          Corregir cierre
        </button>
      </div>
      <CollapseReveal open={editing}>
        {editing && (
          <ShiftCloseAmountsForm
            mode="correct"
            initialCashLeft={cashLeft}
            initialWithdrawn={withdrawn}
            submitLabel="Guardar"
            onSubmit={async patch => {
              await onSubmit(patch)
              setEditing(false)
            }}
          />
        )}
      </CollapseReveal>
    </div>
  )
}

function AmountFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="min-w-0 flex-1 truncate text-sm text-muted" title={label}>{label}</dt>
      <dd className="shrink-0 text-sm font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  )
}
