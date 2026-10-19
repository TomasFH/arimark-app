import { useState } from 'react'
import { CollapseReveal } from './ui'
import { formatARS } from '../lib/datetime'
import { formatBillDenomination, type BillLine, type CashHandoverAudit, type CashHandoverParty } from '@carniceria/shared'

function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function diffHint(diff: number | null): { text: string; className: string } | null {
  if (diff == null || diff === 0) return null
  if (diff > 0) return { text: `Encontró de más ${formatARS(diff)}`, className: 'text-ink' }
  return { text: `Encontró de menos ${formatARS(Math.abs(diff))}`, className: 'text-danger' }
}

function BillChips({ bills }: { bills: BillLine[] }) {
  if (bills.length === 0) {
    return <p className="mt-1.5 text-xs text-muted">Ningún billete</p>
  }
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {bills.map(line => {
        const count = `${formatBillDenomination(line.denomination)} × ${line.quantity}`
        const subtotal = formatARS(line.denomination * line.quantity)
        const full = `${count} · ${subtotal}`
        return (
          <li key={line.denomination} className="rounded-md bg-app px-2 py-1 text-xs text-ink" title={full}>
            {count}
            <span className="text-muted"> · {subtotal}</span>
          </li>
        )
      })}
    </ul>
  )
}

function PartyBlock({ verb, party }: { verb: string; party: CashHandoverParty }) {
  const who = `${verb} ${party.cashierName}`
  return (
    <div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="min-w-0 max-w-full truncate text-sm text-ink" title={who}>{who}</p>
        <span className="text-xs text-muted">{fmtWhen(party.at)}</span>
        <span className="text-sm font-semibold tabular-nums text-ink">{formatARS(party.total)}</span>
      </div>
      <BillChips bills={party.bills} />
    </div>
  )
}

export default function CashHandoverAuditCard({ audit }: { audit: CashHandoverAudit }) {
  const [open, setOpen] = useState(false)
  if (!audit.left && !audit.found && !audit.expected) return null

  const hint = diffHint(audit.amountDiff)
  const match = audit.amountDiff === 0

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="shrink-0 text-sm font-medium text-ink">Entrega del cambio</span>
        {hint && (
          <span className={`min-w-0 flex-1 truncate text-sm ${hint.className}`} title={hint.text}>
            {hint.text}
          </span>
        )}
        {!hint && <span className="flex-1" />}
        <svg
          className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden
        >
          <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <CollapseReveal open={open}>
        <div className="space-y-4 border-t border-line px-4 py-3">
          {audit.found && <PartyBlock verb="Encontró" party={audit.found} />}
          {audit.expected && <PartyBlock verb="Dejó" party={audit.expected} />}
          {audit.left && <PartyBlock verb="Dejó al cerrar" party={audit.left} />}
          {match && <p className="text-sm text-muted">Coincide con lo dejado</p>}
          {hint && <p className={`text-sm font-medium ${hint.className}`}>{hint.text}</p>}
        </div>
      </CollapseReveal>
    </div>
  )
}
