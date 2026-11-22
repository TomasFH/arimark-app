/**
 * Resumen del admin. Arranca en todos los locales y en esta semana.
 * Hoy filtra esa semana, sin otra consulta. El mes corta por el lunes.
 * El modo de prueba solo existe con VITE_APP_ENV=dev y no consulta ni escribe.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  chickenTotals,
  civilYmd,
  collectionNote,
  combineFiadoSlices,
  coverageAccount,
  filterMediaResProvider,
  formatSummaryRange,
  groupMediaResByDay,
  mediaResAverageKg,
  mediaResProviders,
  mediaResTotals,
  onCivilDay,
  paymentsInCivilRange,
  summaryMoneyView,
  summaryMonthStep,
  summaryNewDebt,
  summarizeExpenses,
  summaryPaymentBreakdown,
  summaryPeriodDates,
  summaryPeriodQuery,
  inclusiveCivilSpan,
  mondayWeekRange,
  mondayWeeksInRange,
  ymdInRange,
  summaryPreview,
  summaryPreviewSelection,
  summaryShownAmounts,
  summaryHoursView,
  summarySoldByDay,
  sumCollections,
  type ChickenVisit,
  type SummaryExpenseInput,
  type SummaryPurchaseIntake,
  type SummaryFiadoSlice,
  type PeriodFiadoAccount,
  type SummaryPeriod,
  type SummaryPreviewVisit,
  type SummaryShiftCard,
} from '@carniceria/shared'
import HistoryStoreSelect from '../components/HistoryStoreSelect'
import { AdminSectionHeader } from '../components/AdminSectionHeader'
import { Button } from '../components/ui'
import { formatARS } from '../lib/datetime'
import { SummaryExpensesPanel } from './summary/SummaryExpensesPanel'
import { SummaryFiadoPanel } from './summary/SummaryFiadoPanel'
import { SummaryGlance } from './summary/SummaryGlance'
import { SummaryMerchandisePanel } from './summary/SummaryMerchandisePanel'
import { SummaryNav, type SummarySectionId } from './summary/SummaryNav'
import { SummarySalesPanel } from './summary/SummarySalesPanel'
import type { AdminSummaryResult, StoreRow, StoreTransferRow } from '../types/hw-api'
import type { CustomerHistoryMove } from '@carniceria/shared'

/** Oculto hasta post 1.0. El bloque y la cuenta siguen en el código. Ver docs/POST_1.0.md. */
const SHOW_SUMMARY_BOXES = false

interface Props {
  onBack: () => void
  onLogout?: () => void
}

const PERIOD_OPTIONS: { id: SummaryPeriod; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Esta semana' },
  { id: 'month', label: 'Este mes' },
]

const EMPTY_FIADO: SummaryFiadoSlice = { debtNow: null, payments: null }

function devPreviewEnabled(): boolean {
  return import.meta.env.VITE_APP_ENV === 'dev'
}

export default function SummaryScreen({ onBack, onLogout }: Props) {
  const [stores, setStores] = useState<StoreRow[]>([])
  const [storesReady, setStoresReady] = useState(false)
  const [storesAttempt, setStoresAttempt] = useState(0)
  const [storeId, setStoreId] = useState('all')
  const [period, setPeriod] = useState<SummaryPeriod>('week')
  const [refreshToken, setRefreshToken] = useState(0)
  const [data, setData] = useState<AdminSummaryResult | null>(null)
  const [loadedExpenses, setLoadedExpenses] = useState<SummaryExpenseInput[] | null>(null)
  const [expenseLoading, setExpenseLoading] = useState(false)
  const [expenseError, setExpenseError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [storesError, setStoresError] = useState<string | null>(null)
  const [periodFiado, setPeriodFiado] = useState<PeriodFiadoAccount | null>(null)
  const [periodFiadoLoading, setPeriodFiadoLoading] = useState(false)
  const [periodFiadoError, setPeriodFiadoError] = useState<string | null>(null)
  const [summaryCustomers, setSummaryCustomers] = useState<Array<{ id: string; name: string; storeId: string }>>([])
  const [customersListed, setCustomersListed] = useState(false)
  const [customerListError, setCustomerListError] = useState<string | null>(null)
  const [openCustomerId, setOpenCustomerId] = useState<string | null>(null)
  const [customerHistories, setCustomerHistories] = useState<Record<string, {
    moves: CustomerHistoryMove[]
    hasMore: boolean
    loading: boolean
    error: string | null
  }>>({})
  const historyEpoch = useRef(0)
  const transferRefreshRef = useRef(false)
  const transferWeeksRef = useRef(new Set<string>())
  const transferRowsRef = useRef(new Map<string, StoreTransferRow[]>())
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [expenseView, setExpenseView] = useState<'fecha' | 'grupo'>('fecha')
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [provider, setProvider] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [section, setSection] = useState<SummarySectionId>('resumen')
  const [pending, setPending] = useState<{ rows: StoreTransferRow[]; incomplete: boolean } | null>(null)
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [transferDetail, setTransferDetail] = useState<StoreTransferRow[] | null>(null)
  const [transferDetailLoading, setTransferDetailLoading] = useState(false)
  const [transferDetailError, setTransferDetailError] = useState<string | null>(null)

  const allowPreview = devPreviewEnabled()
  const previewOn = allowPreview && preview
  const queried: SummaryPeriod = period === 'today' ? 'week' : period
  const previewPack = useMemo(() => (previewOn ? summaryPreview() : null), [previewOn])

  useEffect(() => {
    if (!previewPack) {
      if (storeId !== 'all' && storesReady && !stores.some(store => store.id === storeId)) setStoreId('all')
      return
    }
    if (storeId !== 'all' && !previewPack.stores.some(store => store.id === storeId)) setStoreId('all')
  }, [previewPack, storeId, stores, storesReady])

  useEffect(() => {
    let cancelled = false
    setStoresReady(false)
    setStoresError(null)
    setLoading(true)
    void window.hw.getStores().then(result => {
      if (cancelled) return
      if (!result.ok) {
        setStoresError(result.error ?? 'No se pudieron cargar los locales.')
        return
      }
      setStores(result.data.filter(store => !store.archivedAt))
    }).finally(() => {
      if (!cancelled) setStoresReady(true)
    })
    return () => { cancelled = true }
  }, [storesAttempt])

  useEffect(() => {
    if (previewOn) {
      setLoading(false)
      setError(null)
      return
    }
    if (!storesReady || storesError) {
      if (storesReady) setLoading(false)
      return
    }
    const targets = storeId === 'all' ? stores : stores.filter(store => store.id === storeId)
    if (targets.length === 0) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }
    const range = summaryPeriodQuery(queried)
    let cancelled = false
    setLoading(true)
    setLoadedExpenses(null)
    setExpenseError(null)
    setExpenseOpen(false)
    setError(null)
    void Promise.all(targets.map(async store => ({
      store,
      result: await window.hw.getAdminSummary({
        storeId: store.id,
        startIso: range.startIso,
        endIso: range.endIso,
      }),
    }))).then(loaded => {
      if (cancelled) return
      const failed = loaded.find(item => !item.result.ok)
      if (failed && !failed.result.ok) {
        setError(failed.result.error ?? 'No se pudo armar el resumen.')
        setData(null)
        setLoading(false)
        return
      }
      const shifts: Array<SummaryShiftCard & { storeId: string }> = []
      const visits: AdminSummaryResult['visits'] = []
      const chicken: ChickenVisit[] = []
      const purchases: SummaryPurchaseIntake[] = []
      const expenseLines: AdminSummaryResult['expenses'] = []
      const slices: SummaryFiadoSlice[] = []
      for (const item of loaded) {
        if (!item.result.ok) continue
        for (const shift of item.result.data.shifts) {
          shifts.push({ ...shift, storeName: item.store.name, storeId: item.store.id })
        }
        visits.push(...item.result.data.visits)
        purchases.push(...item.result.data.purchases ?? [])
        for (const visit of item.result.data.chicken ?? []) {
          chicken.push({ ...visit, storeName: item.store.name })
        }
        for (const expense of item.result.data.expenses ?? []) {
          expenseLines.push({ ...expense, storeName: item.store.name })
        }
        slices.push(item.result.data.fiado ?? EMPTY_FIADO)
      }
      setData({ shifts, visits, chicken, purchases, expenses: expenseLines, warning: null, fiado: combineFiadoSlices(slices) })
      setOpenDay(null)
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setError('No se pudo armar el resumen.')
      setData(null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [storesReady, storesError, stores, storeId, queried, refreshToken, previewOn])

  useEffect(() => {
    if (previewOn || !storesReady || storesError) return
    const listen = window.hw.onDebtSyncUpdated
    const readNow = window.hw.getAdminFiadoNow
    if (!listen || !readNow) return
    const targets = storeId === 'all' ? stores : stores.filter(store => store.id === storeId)
    if (targets.length === 0) return
    let cancelled = false
    const pull = (): void => {
      void Promise.all(targets.map(store => readNow({ storeId: store.id }))).then(results => {
        if (cancelled || results.some(result => !result.ok)) return
        const known = results.filter(result => result.ok && result.data.debtNow != null)
        const debtNow = known.length === 0
          ? null
          : known.reduce((sum, result) => sum + (result.ok ? result.data.debtNow ?? 0 : 0), 0)
        setData(prev => (prev ? { ...prev, fiado: { ...prev.fiado, debtNow } } : prev))
      })
    }
    return listen(pull)
  }, [previewOn, storesReady, storesError, stores, storeId])

  const previousMonth = summaryMonthStep(1)
  const dates = summaryPeriodDates(period)
  const caption = formatSummaryRange(dates.startYmd, dates.endYmd)

  useEffect(() => {
    setPeriodFiado(null)
    setPeriodFiadoError(null)
  }, [storeId, dates.startYmd, dates.endYmd])

  useEffect(() => {
    const read = window.hw.getPendingStoreTransfers
    if (previewOn || !storesReady || storesError || !read) {
      setPending(null)
      setPendingError(null)
      setPendingLoading(false)
      return
    }
    const span = inclusiveCivilSpan(dates.startYmd, dates.endYmd)
    let cancelled = false
    setPendingLoading(true)
    setPendingError(null)
    void read({ startIso: span.startIso, endIso: span.endIso }).then(result => {
      if (cancelled) return
      if (!result.ok) {
        setPending(null)
        setPendingError(result.error ?? 'No se pudo leer lo pendiente entre locales.')
        setPendingLoading(false)
        return
      }
      setPending(result.data)
      setPendingLoading(false)
    }).catch(() => {
      if (cancelled) return
      setPending(null)
      setPendingError('No se pudo leer lo pendiente entre locales.')
      setPendingLoading(false)
    })
    return () => { cancelled = true }
  }, [previewOn, storesReady, storesError, dates.startYmd, dates.endYmd, refreshToken])

  useEffect(() => {
    const read = window.hw.listStoreTransfers
    if (previewOn || !storesReady || storesError || !read) {
      setTransferDetail(null)
      setTransferDetailError(null)
      setTransferDetailLoading(false)
      return
    }
    const span = inclusiveCivilSpan(dates.startYmd, dates.endYmd)
    const weeks = mondayWeeksInRange(span.startIso, span.endIso)
    const currentWeekStart = mondayWeekRange(0).startIso
    const force = transferRefreshRef.current
    let cancelled = false
    setTransferDetailLoading(true)
    setTransferDetailError(null)
    void (async () => {
      const collected: StoreTransferRow[] = []
      for (const week of weeks) {
        const closed = week.startIso < currentWeekStart
        if (closed && !force && transferWeeksRef.current.has(week.startIso)) {
          collected.push(...(transferRowsRef.current.get(week.startIso) ?? []))
          continue
        }
        const result = await read({
          startIso: week.startIso,
          endIso: week.endIso,
          refresh: force || !closed,
        })
        if (cancelled) return
        if (!result.ok) {
          setTransferDetail(null)
          setTransferDetailError(result.error ?? 'No se pudo leer el detalle entre locales.')
          setTransferDetailLoading(false)
          return
        }
        transferRowsRef.current.set(week.startIso, result.data)
        if (closed) transferWeeksRef.current.add(week.startIso)
        collected.push(...result.data)
      }
      if (cancelled) return
      setTransferDetail(collected)
      setTransferDetailLoading(false)
    })().finally(() => {
      if (!cancelled) transferRefreshRef.current = false
    })
    return () => { cancelled = true }
  }, [previewOn, storesReady, storesError, dates.startYmd, dates.endYmd, refreshToken])

  useEffect(() => {
    historyEpoch.current += 1
    setCustomerHistories({})
    setOpenCustomerId(null)
    setCustomerListError(null)
    setCustomersListed(false)
    if (previewOn || !storesReady || storesError) {
      setSummaryCustomers([])
      return
    }
    const list = window.hw.getSummaryCustomers
    if (!list) return
    const ids = (storeId === 'all' ? stores : stores.filter(store => store.id === storeId)).map(store => store.id)
    if (ids.length === 0) {
      setSummaryCustomers([])
      setCustomersListed(true)
      return
    }
    let cancelled = false
    void list({ storeIds: ids }).then(result => {
      if (cancelled) return
      if (!result.ok) {
        setSummaryCustomers([])
        setCustomerListError(result.error ?? 'No se pudieron leer los clientes.')
        setCustomersListed(true)
        return
      }
      setSummaryCustomers(result.data)
      setCustomersListed(true)
    }).catch(() => {
      if (!cancelled) {
        setCustomerListError('No se pudieron leer los clientes.')
        setCustomersListed(true)
      }
    })
    return () => { cancelled = true }
  }, [previewOn, storesReady, storesError, stores, storeId])
  const storeOptions: StoreRow[] = previewPack
    ? previewPack.stores.map(store => ({ id: store.id, name: store.name }))
    : stores
  const selected = previewPack ? summaryPreviewSelection(previewPack, storeId) : null

  const shownShifts = useMemo(() => {
    const shifts = selected?.shifts ?? data?.shifts ?? []
    if (!selected) {
      return period === 'today' ? shifts.filter(shift => onCivilDay(shift.startedAt, civilYmd())) : shifts
    }
    return shifts.filter(shift => ymdInRange(civilYmd(new Date(shift.startedAt)), dates.startYmd, dates.endYmd))
  }, [selected, data, period, dates.startYmd, dates.endYmd])

  const shownVisits = useMemo(() => {
    const visits: SummaryPreviewVisit[] | AdminSummaryResult['visits'] = selected?.visits ?? data?.visits ?? []
    if (!selected) return period === 'today' ? visits.filter(visit => visit.ymd === civilYmd()) : visits
    return visits.filter(visit => ymdInRange(visit.ymd, dates.startYmd, dates.endYmd))
  }, [selected, data, period, dates.startYmd, dates.endYmd])

  const shownChicken = useMemo(() => {
    if (selected) return []
    const rows = data?.chicken ?? []
    if (period === 'today') return rows.filter(visit => visit.ymd === civilYmd())
    return rows
  }, [selected, data, period])
  const chicken = chickenTotals(shownChicken)

  const providers = useMemo(() => mediaResProviders(shownVisits), [shownVisits])
  const providerFilter = provider && providers.includes(provider) ? provider : null
  const visits = useMemo(
    () => filterMediaResProvider(shownVisits, providerFilter),
    [shownVisits, providerFilter],
  )
  const account = useMemo(() => {
    const today = civilYmd()
    const intakes = selected
      ? shownVisits.map(visit => ({
          createdAt: visit.createdAt,
          lines: [{
            costTotal: visit.cost ?? 0,
            moneyRole: visit.cost != null && visit.cost > 0 ? 'informed' as const : 'none' as const,
            mediaRes: true,
          }],
        }))
      : (data?.purchases ?? []).filter(row => period !== 'today' || onCivilDay(row.createdAt, today))
    return coverageAccount({
      fichas: shownShifts.map(shift => ({
        soldTotal: shift.soldTotal,
        expenseTotal: shift.expenseTotal,
        providerExpenseTotal: shift.providerExpenseTotal ?? null,
      })),
      intakes,
    })
  }, [selected, shownVisits, data, period, shownShifts])
  const money = useMemo(() => summaryMoneyView(shownShifts), [shownShifts])
  const payment = useMemo(() => summaryPaymentBreakdown(shownShifts), [shownShifts])
  const expenseDetail = useMemo(() => {
    if (selected) return summarizeExpenses([], [])
    const ids = new Set(shownShifts.map(shift => shift.id))
    const storeNameByShift = new Map(shownShifts.map(shift => [shift.id, shift.storeName?.trim() ?? '']))
    const byId = new Map<string, SummaryExpenseInput>()
    for (const line of data?.expenses ?? []) {
      if (ids.has(line.shiftId)) byId.set(line.id, line)
    }
    for (const line of loadedExpenses ?? []) {
      if (!ids.has(line.shiftId)) continue
      const storeName = line.storeName?.trim()
        || storeNameByShift.get(line.shiftId)
        || byId.get(line.id)?.storeName?.trim()
        || ''
      byId.set(line.id, { ...line, storeName: storeName || null })
    }
    return summarizeExpenses([...byId.values()], shownShifts)
  }, [selected, data, shownShifts, loadedExpenses])
  const expenseTally = expenseDetail.rowTotal == null
    ? null
    : `${expenseDetail.rows.length} ${expenseDetail.rows.length === 1 ? 'gasto' : 'gastos'} · ${formatARS(expenseDetail.rowTotal)}`

  function toggleExpenseDetail(): void {
    if (expenseOpen) {
      setExpenseOpen(false)
      return
    }
    setExpenseOpen(true)
    if (!previewOn) void loadExpenseDetail()
  }

  async function loadExpenseDetail(): Promise<void> {
    const shifts = shownShifts.flatMap(shift => {
      const storeId = (shift as SummaryShiftCard & { storeId?: string }).storeId ?? ''
      if (!storeId) return []
      return [{ id: shift.id, storeId, startedAt: shift.startedAt }]
    })
    setExpenseLoading(true)
    setExpenseError(null)
    try {
      const result = await window.hw.getSummaryExpenses({ shifts })
      if (!result.ok) {
        setExpenseError(result.error ?? 'No se pudieron leer los gastos.')
        return
      }
      setLoadedExpenses(result.data)
    } catch {
      setExpenseError('No se pudieron leer los gastos.')
    } finally {
      setExpenseLoading(false)
    }
  }

  async function loadPeriodFiado(): Promise<void> {
    if (previewOn) return
    const targets = storeId === 'all' ? stores : stores.filter(store => store.id === storeId)
    if (targets.length === 0) return
    const span = inclusiveCivilSpan(dates.startYmd, dates.endYmd)
    setPeriodFiadoLoading(true)
    setPeriodFiadoError(null)
    try {
      const results = await Promise.all(targets.map(store => window.hw.getPeriodFiado({
        storeId: store.id,
        startIso: span.startIso,
        endIso: span.endIso,
      })))
      const failed = results.find(result => !result.ok)
      if (failed && !failed.ok) {
        setPeriodFiadoError(failed.error ?? 'No se pudo leer el fiado del período.')
        return
      }
      const rows = results.flatMap(result => (result.ok ? [result.data] : []))
      if (rows.some(row => row.incomplete)) {
        setPeriodFiado({ newDebt: null, collections: null, unshifted: null, incomplete: true })
        return
      }
      setPeriodFiado({
        newDebt: rows.reduce((sum, row) => sum + (row.newDebt ?? 0), 0),
        collections: rows.reduce((sum, row) => sum + (row.collections ?? 0), 0),
        unshifted: rows.reduce((sum, row) => sum + (row.unshifted ?? 0), 0),
        incomplete: false,
      })
    } catch {
      setPeriodFiadoError('No se pudo leer el fiado del período.')
    } finally {
      setPeriodFiadoLoading(false)
    }
  }

  async function loadCustomerHistory(row: { id: string; storeId: string }, more: boolean): Promise<void> {
    const read = window.hw.getCustomerDebtHistory
    if (!read) return
    const epoch = historyEpoch.current
    setCustomerHistories(prev => ({
      ...prev,
      [row.id]: {
        moves: prev[row.id]?.moves ?? [],
        hasMore: prev[row.id]?.hasMore ?? false,
        loading: true,
        error: null,
      },
    }))
    try {
      const result = await read({ customerId: row.id, storeId: row.storeId, more })
      if (epoch !== historyEpoch.current) return
      if (!result.ok) {
        setCustomerHistories(prev => ({
          ...prev,
          [row.id]: {
            moves: prev[row.id]?.moves ?? [],
            hasMore: prev[row.id]?.hasMore ?? false,
            loading: false,
            error: result.error ?? 'No se pudo leer el historial.',
          },
        }))
        return
      }
      setCustomerHistories(prev => ({
        ...prev,
        [row.id]: {
          moves: more ? [...(prev[row.id]?.moves ?? []), ...result.data.moves] : result.data.moves,
          hasMore: result.data.hasMore,
          loading: false,
          error: null,
        },
      }))
    } catch {
      if (epoch !== historyEpoch.current) return
      setCustomerHistories(prev => ({
        ...prev,
        [row.id]: {
          moves: prev[row.id]?.moves ?? [],
          hasMore: prev[row.id]?.hasMore ?? false,
          loading: false,
          error: 'No se pudo leer el historial.',
        },
      }))
    }
  }

  function toggleCustomerHistory(row: { id: string; storeId: string }): void {
    if (openCustomerId === row.id) {
      setOpenCustomerId(null)
      return
    }
    setOpenCustomerId(row.id)
    if (customerHistories[row.id]) return
    void loadCustomerHistory(row, false)
  }
  const shown = summaryShownAmounts(money)
  const soldDays = useMemo(
    () => summarySoldByDay(shownShifts, dates.startYmd, dates.endYmd),
    [shownShifts, dates.startYmd, dates.endYmd],
  )
  const days = useMemo(() => groupMediaResByDay(visits), [visits])
  const totals = mediaResTotals(visits)
  const average = mediaResAverageKg(visits)
  const newDebt = summaryNewDebt(shownShifts)
  const fiado = selected?.fiado ?? data?.fiado ?? EMPTY_FIADO
  const collections = fiado.payments
    ? sumCollections(paymentsInCivilRange(fiado.payments, dates.startYmd, dates.endYmd))
    : null
  const periodAccount = previewOn ? null : periodFiado
  const periodIncomplete = periodAccount?.incomplete === true
  const shownNewDebt = periodAccount
    ? (periodAccount.incomplete ? null : periodAccount.newDebt)
    : newDebt
  const shownCollections = periodAccount
    ? (periodAccount.incomplete ? null : periodAccount.collections)
    : (collections ? collections.total : null)
  const note = periodIncomplete
    ? null
    : collectionNote(periodAccount ? (periodAccount.unshifted ?? 0) : (collections?.unshifted ?? 0))
  const moneyReady = shown.vendio != null
  const showStore = storeId === 'all'
  const ready = previewOn
    ? !loading
    : !loading && !storesError && !error && data != null
  const showHours = period === 'today' && !previewOn
  const pendingShown = (pending?.rows ?? []).filter(row =>
    storeId === 'all' || row.fromStoreId === storeId || row.toStoreId === storeId,
  )
  const transferSpan = inclusiveCivilSpan(dates.startYmd, dates.endYmd)
  const transferShown = (transferDetail ?? []).filter(row =>
    row.occurredAt >= transferSpan.startIso
    && row.occurredAt < transferSpan.endIso
    && (storeId === 'all' || row.fromStoreId === storeId || row.toStoreId === storeId),
  ).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  const showTransferSection = Boolean(
    pending || pendingLoading || pendingError
    || transferDetail || transferDetailLoading || transferDetailError,
  )
  const storeName = new Map(stores.map(store => [store.id, store.name]))
  const hourView = useMemo(
    () => summaryHoursView(shownShifts, showHours ? 'today' : 'average', showStore),
    [shownShifts, showHours, showStore],
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-app text-ink">
      <AdminSectionHeader
        title="Resumen"
        subtitle={caption}
        onBack={onBack}
        onLogout={onLogout}
        actions={(
          <Button variant="secondary" size="sm" onClick={() => {
            transferRefreshRef.current = true
            setRefreshToken(token => token + 1)
          }}>
            Actualizar
          </Button>
        )}
      />
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col self-center px-6 py-5">
        <div className="space-y-3">
            <p className="text-sm font-medium text-ink">Filtros</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label className="mb-1 block text-xs text-muted" htmlFor="summary-store">Local</label>
                <HistoryStoreSelect
                  id="summary-store"
                  stores={storeOptions}
                  value={storeId}
                  onChange={setStoreId}
                />
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-xs text-muted" htmlFor="summary-period">Período</label>
                <select
                  id="summary-period"
                  value={period}
                  onChange={event => {
                    const value = event.target.value
                    if (value === 'today' || value === 'week' || value === 'month' || value === 'previous') {
                      setPeriod(value)
                    }
                  }}
                  className="h-9 w-full min-w-0 truncate rounded-lg border border-line bg-input px-2 text-sm text-ink focus:border-line-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  {PERIOD_OPTIONS.map(option => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                  <option value="previous">{previousMonth.name}</option>
                </select>
                <p className="mt-1 truncate text-xs text-muted" title={caption}>{caption}</p>
              </div>
            </div>
            {allowPreview && (
              <label className="flex w-fit items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={preview}
                  onChange={event => setPreview(event.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                Datos de prueba
              </label>
            )}
          </div>

          <div className="mt-6 flex min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:items-start">
            <SummaryNav section={section} onChange={setSection} />
            <div
              role="tabpanel"
              id={`summary-panel-${section}`}
              aria-labelledby={`summary-tab-${section}`}
              className="min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
            >
          {!previewOn && storesReady && stores.length === 0 && !loading && !storesError && (
            <p className="text-sm text-ink">No hay locales.</p>
          )}
          {!previewOn && (storesError ?? error) && (
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 truncate text-sm text-danger" title={storesError ?? error ?? ''}>{storesError ?? error}</p>
              <button
                type="button"
                onClick={() => {
                  if (storesError) setStoresAttempt(attempt => attempt + 1)
                  else setRefreshToken(token => token + 1)
                }}
                className="shrink-0 text-sm text-ink underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                Reintentar
              </button>
            </div>
          )}
          {loading && !storesError && <p className="animate-pulse text-sm text-muted">Cargando…</p>}

          {ready && (
            <>
              {section === 'resumen' && (
                <SummaryGlance
                  vendio={shown.vendio}
                  gastos={shown.gastos}
                  tarjeta={shown.tarjeta}
                  mediaCount={totals.count}
                  mediaKg={totals.kg}
                  chickenCrates={chicken.crates}
                  chickenKg={chicken.grossKg}
                  account={account}
                  debtNow={fiado.debtNow}
                  pendingCount={pendingShown.length}
                  pendingIncomplete={pending?.incomplete === true}
                  pendingLoading={pendingLoading}
                  pendingError={pendingError}
                  pendingKnown={pending != null}
                  onOpenMerchandise={() => setSection('mercaderia')}
                />
              )}
              {section === 'ventas' && (
                <SummarySalesPanel
                  showHours={showHours}
                  hourView={hourView}
                  soldDays={soldDays}
                  previewOn={previewOn}
                  efectivo={shown.efectivo}
                  tarjeta={shown.tarjeta}
                  gastos={shown.gastos}
                  digital={shown.digital}
                  payment={payment}
                  shifts={shownShifts}
                  moneyReady={moneyReady}
                />
              )}
              {section === 'gastos' && (
                <SummaryExpensesPanel
                  tally={expenseTally}
                  open={expenseOpen}
                  view={expenseView}
                  onView={setExpenseView}
                  onToggle={toggleExpenseDetail}
                  loading={expenseLoading}
                  canOpen={previewOn || (!expenseLoading && shownShifts.length > 0)}
                  error={expenseError}
                  detail={expenseDetail}
                  showStore={showStore}
                />
              )}
              {section === 'mercaderia' && (
                <SummaryMerchandisePanel
                  providers={providers}
                  providerFilter={providerFilter}
                  onProvider={setProvider}
                  days={days}
                  openDay={openDay}
                  onOpenDay={setOpenDay}
                  totals={totals}
                  average={average}
                  chicken={chicken}
                  chickenRows={shownChicken}
                  showBoxes={SHOW_SUMMARY_BOXES}
                  money={money}
                  showStore={showStore}
                  showTransfers={!previewOn && showTransferSection}
                  pending={pending}
                  pendingShown={pendingShown}
                  pendingLoading={pendingLoading}
                  pendingError={pendingError}
                  transferShown={transferShown}
                  transferDetail={transferDetail}
                  transferDetailLoading={transferDetailLoading}
                  transferDetailError={transferDetailError}
                  storeName={storeName}
                />
              )}
              {section === 'fiados' && (
                <SummaryFiadoPanel
                  previewOn={previewOn}
                  periodLoading={periodFiadoLoading}
                  onLoadPeriod={() => { void loadPeriodFiado() }}
                  periodError={periodFiadoError}
                  newDebt={shownNewDebt}
                  collections={shownCollections}
                  periodIncomplete={periodIncomplete}
                  note={note}
                  debtNow={fiado.debtNow}
                  showCustomers={!previewOn}
                  customerError={customerListError}
                  customersListed={customersListed}
                  customers={summaryCustomers}
                  storeId={storeId}
                  storeName={id => stores.find(store => store.id === id)?.name ?? ''}
                  openCustomerId={openCustomerId}
                  histories={customerHistories}
                  onToggleCustomer={toggleCustomerHistory}
                  onLoadMore={row => { void loadCustomerHistory(row, true) }}
                />
              )}
            </>
          )}
            </div>
          </div>
        </div>
      </div>
  )
}
