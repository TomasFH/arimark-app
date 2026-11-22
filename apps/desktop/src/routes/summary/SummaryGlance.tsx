import { formatKg3, type CoverageAccount } from '@carniceria/shared'
import { cx } from '../../components/ui'
import { formatARS } from '../../lib/datetime'
import { MoneyRow } from './SummaryMoney'

function amountText(amount: number | null): string {
  return amount == null ? 'todavía no llegó' : formatARS(amount)
}

function coverageTone(amount: number | null): string {
  if (amount == null || amount === 0) return 'text-ink'
  return amount > 0 ? 'text-success' : 'text-danger'
}

function shiftsLeftOutText(count: number): string {
  if (count === 1) {
    return '1 turno quedó afuera: la ficha no tiene el dato de gastos a proveedores.'
  }
  return `${count} turnos quedaron afuera: las fichas no tienen el dato de gastos a proveedores.`
}

function mediaResUnpricedText(count: number): string {
  return count === 1
    ? '1 ingreso de media res sin precio no suma'
    : `${count} ingresos de media res sin precio no suman`
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-full min-w-0 flex-col rounded-xl border border-line bg-panel px-4 py-4">
      <p className="truncate text-xs font-medium text-muted" title={label}>{label}</p>
      <p className="mt-3 truncate text-3xl font-semibold tabular-nums tracking-tight text-ink" title={value}>{value}</p>
    </div>
  )
}

export function SummaryGlance({
  vendio,
  gastos,
  tarjeta,
  mediaCount,
  mediaKg,
  chickenCrates,
  chickenKg,
  account,
  debtNow,
  pendingCount,
  pendingIncomplete,
  pendingLoading,
  pendingError,
  pendingKnown,
  onOpenMerchandise,
}: {
  vendio: number | null
  gastos: number | null
  tarjeta: number | null
  mediaCount: number
  mediaKg: number
  chickenCrates: number
  chickenKg: number
  account: CoverageAccount
  debtNow: number | null
  pendingCount: number
  pendingIncomplete: boolean
  pendingLoading: boolean
  pendingError: string | null
  pendingKnown: boolean
  onOpenMerchandise: () => void
}) {
  const differenceText = account.difference == null
    ? (account.shiftsLeftOut > 0 ? 'incompleta' : 'sin dato')
    : formatARS(account.difference)
  const kilos = [
    mediaCount > 0 ? formatKg3(mediaKg) : null,
    chickenCrates > 0 ? `${formatKg3(chickenKg)} brutos` : null,
  ].filter((line): line is string => line != null).join(' · ')
  const mediaLabel = `${mediaCount} ${mediaCount === 1 ? 'media' : 'medias'}`
  const chickenLabel = `${chickenCrates} ${chickenCrates === 1 ? 'cajón' : 'cajones'}`
  const debtText = debtNow == null ? 'pendiente' : formatARS(debtNow)
  const cardButton = 'flex h-full min-w-0 flex-col rounded-xl border border-line bg-panel px-4 py-4 text-left hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40'
  const pendingMarked = pendingKnown && !pendingLoading && !pendingError && pendingCount > 0

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
      <Figure label="Vendió" value={amountText(vendio)} />
      <Figure label="Gastos" value={amountText(gastos)} />
      <Figure label="Tarjeta y billetera" value={amountText(tarjeta)} />
      <button type="button" onClick={onOpenMerchandise} className={cardButton}>
        <p className="truncate text-xs font-medium text-muted">Medias y pollo</p>
        <p className="mt-3 truncate text-3xl font-semibold tabular-nums tracking-tight text-ink" title={mediaLabel}>{mediaLabel}</p>
        <p className="mt-1 truncate text-3xl font-semibold tabular-nums tracking-tight text-ink" title={chickenLabel}>{chickenLabel}</p>
        {kilos && <p className="mt-3 truncate text-xs text-muted" title={kilos}>{kilos}</p>}
      </button>
      <article className="col-span-2 flex min-w-0 flex-col rounded-xl border border-line bg-app px-5 py-5 max-lg:col-span-1">
        <h2 className="truncate text-sm font-medium text-ink" title="Ventas menos compras y gastos">Ventas menos compras y gastos</h2>
        <p className={cx('mt-2 truncate text-5xl font-semibold tabular-nums tracking-tight', coverageTone(account.difference))} title={differenceText}>
          {differenceText}
        </p>
        <div className="mt-5 space-y-2 border-t border-line pt-4">
          <MoneyRow label="Ventas" amount={account.sales} empty="sin dato" />
          <MoneyRow label="Compras" amount={account.purchases} />
          <MoneyRow label="Otros gastos" amount={account.otherExpenses} empty="sin dato" />
        </div>
        {account.shiftsLeftOut > 0 && (
          <p className="mt-3 text-sm text-muted">{shiftsLeftOutText(account.shiftsLeftOut)}</p>
        )}
        {account.mediaResWithoutPrice > 0 && (
          <p className="mt-3 text-sm text-muted">{mediaResUnpricedText(account.mediaResWithoutPrice)}</p>
        )}
      </article>
      <div className="flex h-full min-w-0 flex-col rounded-xl border border-line bg-panel px-4 py-4">
        <p className="truncate text-xs font-medium text-muted">Deuda de ahora</p>
        <p className="mt-3 truncate text-3xl font-semibold tabular-nums tracking-tight text-ink" title={debtText}>{debtText}</p>
      </div>
      <button
        type="button"
        onClick={onOpenMerchandise}
        className={cx(
          'flex h-full min-w-0 flex-col rounded-xl border border-line px-4 py-4 text-left hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          pendingMarked
            ? 'bg-[color-mix(in_srgb,var(--text)_8%,var(--bg-panel))]'
            : 'bg-panel',
        )}
      >
        <p className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted">
          {pendingMarked && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-ink" />}
          <span className="min-w-0 flex-1 truncate" title="Pendientes entre locales">Pendientes entre locales</span>
        </p>
        {pendingError && (
          <p className="mt-3 truncate text-sm text-danger" title={pendingError}>{pendingError}</p>
        )}
        {pendingLoading && !pendingError && <p className="mt-3 text-sm text-muted">Cargando…</p>}
        {pendingKnown && !pendingLoading && !pendingError && (
          <p className="mt-3 truncate text-3xl font-semibold tabular-nums tracking-tight text-ink">{pendingCount}</p>
        )}
        {!pendingKnown && !pendingLoading && !pendingError && (
          <p className="mt-3 text-3xl font-semibold tabular-nums text-muted">—</p>
        )}
        {pendingIncomplete && !pendingError && <p className="mt-2 text-sm text-muted">incompleta</p>}
      </button>
    </div>
  )
}
