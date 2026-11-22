import {
  soldHourChartBars,
  type SoldDayBar,
  type SummaryHoursView,
  type SummaryPaymentBreakdown,
  type SummaryShiftCard,
} from '@carniceria/shared'
import { SoldDayBars, SaleSplitChart } from '../../components/SummaryCharts'
import { formatARS } from '../../lib/datetime'
import { MoneyRow } from './SummaryMoney'

function incompleteDayText(count: number): string | null {
  if (count <= 0) return null
  if (count === 1) return '1 día no se contó por estar incompleto'
  return `${count} días no se contaron por estar incompletos`
}

function HourChart({
  view,
  emptyLabel,
  showAverage,
}: {
  view: SummaryHoursView
  emptyLabel: string
  showAverage: boolean
}) {
  const bars = view.buckets ? soldHourChartBars(view.buckets) : []
  const showChart = !view.missing && bars.length > 0
  const showEmpty = !view.missing && !showChart && (view.buckets != null || view.openNotices.length === 0)
  const peak = showAverage && view.peak && view.peak.amount > 0
    ? `Pico: ${view.peak.hour}h · ${formatARS(view.peak.amount)}`
    : null
  const incomplete = showAverage ? incompleteDayText(view.incompleteDayCount) : null
  return (
    <div className="space-y-2">
      {view.missing && <p className="text-sm text-muted">sin dato</p>}
      {showEmpty && <p className="text-sm text-muted">{emptyLabel}</p>}
      {showChart && (
        <>
          {showAverage && (
            <p className="text-sm text-muted">Cada hora es la media de los días completos</p>
          )}
          <SoldDayBars bars={bars} caption="Vendido por hora" />
        </>
      )}
      {peak && <p className="text-sm text-muted">{peak}</p>}
      {incomplete && <p className="text-sm text-muted">{incomplete}</p>}
      {view.openNotices.map(notice => (
        <p key={notice.id} className="min-w-0 truncate text-sm text-muted" title={notice.text}>
          {notice.text}
        </p>
      ))}
    </div>
  )
}

export function SummarySalesPanel({
  showHours,
  hourView,
  soldDays,
  previewOn,
  efectivo,
  tarjeta,
  gastos,
  digital,
  payment,
  shifts,
  moneyReady,
}: {
  showHours: boolean
  hourView: SummaryHoursView
  soldDays: SoldDayBar[]
  previewOn: boolean
  efectivo: number | null
  tarjeta: number | null
  gastos: number | null
  digital: number | null
  payment: SummaryPaymentBreakdown
  shifts: Array<Pick<SummaryShiftCard, 'id' | 'cashierName'>>
  moneyReady: boolean
}) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(17rem,1fr)]">
      <section className="min-w-0 space-y-3 rounded-xl border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold text-ink">{showHours ? 'Ventas por hora' : 'Ventas por día'}</h2>
        {showHours ? (
          <HourChart view={hourView} emptyLabel="No hay ventas en este día" showAverage={false} />
        ) : (
          <>
            <SoldDayBars bars={soldDays} />
            {!previewOn && (
              <div className="space-y-2 border-t border-line pt-3">
                <h3 className="text-sm font-semibold text-ink">Ventas por hora</h3>
                <HourChart view={hourView} emptyLabel="No hay ventas en estos días" showAverage />
              </div>
            )}
          </>
        )}
      </section>
      <section className="min-w-0 space-y-4 rounded-xl border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold text-ink">Efectivo y tarjeta</h2>
        <div className="space-y-2">
          <MoneyRow label="Entró en efectivo" amount={efectivo} />
          <MoneyRow label="Tarjeta y billetera" amount={tarjeta} />
          <MoneyRow label="Gastos" amount={gastos} />
          <MoneyRow label="Efectivo por digital" amount={digital} />
          <MoneyRow label="Efectivo" amount={efectivo} />
          <MoneyRow label="Débito" amount={payment.debit} empty="sin dato" />
          <MoneyRow label="Billetera virtual" amount={payment.wallet} empty="sin dato" />
          <MoneyRow label="Crédito" amount={payment.credit} empty="sin dato" />
          {payment.totalOnlyCount > 0 && (
            <p className="text-sm text-muted">
              {payment.totalOnlyCount === 1
                ? '1 turno solo tiene el total'
                : `${payment.totalOnlyCount} turnos solo tienen el total`}
            </p>
          )}
          {payment.gaps.map(gap => {
            const who = shifts.find(shift => shift.id === gap.shiftId)?.cashierName ?? 'Un turno'
            const text = `${who}: diferencia ${formatARS(gap.difference)}. ${gap.cause}`
            return (
              <p key={gap.shiftId} className="min-w-0 truncate text-sm text-muted" title={text}>
                {text}
              </p>
            )
          })}
        </div>
        <SaleSplitChart pending={!moneyReady} cash={efectivo ?? 0} card={tarjeta ?? 0} />
      </section>
    </div>
  )
}
