import { formatARS } from '../lib/datetime'
import { formatBillDenomination, type BillLine, type CashHandoverAudit } from '@carniceria/shared'

function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function BillList({ bills }: { bills: BillLine[] }) {
  if (bills.length === 0) {
    return <p className="text-xs text-muted">Ningún billete</p>
  }
  return (
    <ul className="space-y-0.5">
      {bills.map(line => (
        <li key={line.denomination} className="flex justify-between gap-2 text-xs">
          <span className="text-muted">{formatBillDenomination(line.denomination)} × {line.quantity}</span>
          <span className="font-mono text-ink">{formatARS(line.denomination * line.quantity)}</span>
        </li>
      ))}
    </ul>
  )
}

export default function CashHandoverAuditCard({ audit }: { audit: CashHandoverAudit }) {
  if (!audit.left && !audit.found && !audit.expected) return null

  return (
    <div className="bg-raised rounded-xl border border-line p-4 space-y-3">
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Entrega del cambio</h3>

      {audit.found && (
        <div className="space-y-1">
          <p className="text-sm text-white min-w-0 truncate" title={`Encontró ${audit.found.cashierName}`}>
            Encontró {audit.found.cashierName}
            <span className="text-muted"> · {fmtWhen(audit.found.at)}</span>
          </p>
          <BillList bills={audit.found.bills} />
          <p className="text-sm font-semibold text-success">{formatARS(audit.found.total)}</p>
        </div>
      )}

      {audit.expected && (
        <div className="space-y-1 border-t border-line pt-2">
          <p className="text-sm text-white min-w-0 truncate" title={`Dejó ${audit.expected.cashierName}`}>
            Dejó {audit.expected.cashierName}
            <span className="text-muted"> · {fmtWhen(audit.expected.at)}</span>
          </p>
          <BillList bills={audit.expected.bills} />
          <p className="text-sm font-semibold text-ink">{formatARS(audit.expected.total)}</p>
        </div>
      )}

      {audit.left && (
        <div className="space-y-1 border-t border-line pt-2">
          <p className="text-sm text-white min-w-0 truncate" title={`Dejó al cerrar ${audit.left.cashierName}`}>
            Dejó al cerrar {audit.left.cashierName}
            <span className="text-muted"> · {fmtWhen(audit.left.at)}</span>
          </p>
          <BillList bills={audit.left.bills} />
          <p className="text-sm font-semibold text-ink">{formatARS(audit.left.total)}</p>
        </div>
      )}

      {audit.amountDiff != null && (
        <p className={`text-sm font-semibold ${
          audit.amountDiff === 0 ? 'text-success' : audit.amountDiff > 0 ? 'text-blue-300' : 'text-red-300'
        }`}
        >
          {audit.amountDiff === 0
            ? 'Coincide con lo dejado'
            : audit.amountDiff > 0
              ? `Diferencia: +${formatARS(audit.amountDiff)} (encontró de más)`
              : `Diferencia: −${formatARS(Math.abs(audit.amountDiff))} (encontró de menos)`}
        </p>
      )}
    </div>
  )
}
