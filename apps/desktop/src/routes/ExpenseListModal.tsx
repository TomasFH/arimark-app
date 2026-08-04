/**
 * Modal de lista de gastos del turno activo.
 * Las filas son clicables: al tocar una se expande mostrando el detalle completo.
 * Desde el detalle se puede editar o eliminar el gasto (solo si el turno está abierto).
 */
import { useEffect, useState } from 'react'
import type { ExpenseRow, ProviderDebtRow } from '../types/hw-api'
import { formatARS } from '../lib/datetime'
import ExpenseModal from './ExpenseModal'

interface Props {
  onClose: () => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function ExpenseListModal({ onClose }: Props) {
  const [expenses, setExpenses] = useState<ExpenseRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Balance actual por proveedor: undefined = no consultado aún, null = sin historial de deuda
  const [providerStatuses, setProviderStatuses] = useState<Record<string, ProviderDebtRow | null>>({})
  const [refreshing, setRefreshing] = useState(false)

  async function loadExpenses() {
    const r = await window.hw.getShiftExpenses()
    if (!r.ok) { setError(r.error); return }
    setExpenses(r.data)
    // Consultar balance actual de proveedores con deuda pendiente
    const withDebt = r.data.filter(e => e.newDebtAmount && e.newDebtAmount > 0 && e.providerId)
    const uniqueProviderIds = [...new Set(withDebt.map(e => e.providerId!))]
    if (uniqueProviderIds.length === 0) return
    const results: Record<string, ProviderDebtRow | null> = {}
    await Promise.all(uniqueProviderIds.map(async pid => {
      const dr = await window.hw.getProviderDebt({ providerId: pid })
      results[pid] = dr.ok ? (dr.data ?? null) : null
    }))
    setProviderStatuses(results)
  }

  async function handleRefresh() {
    setRefreshing(true)
    await loadExpenses()
    setRefreshing(false)
  }

  useEffect(() => { void loadExpenses() }, [])

  const total = (expenses ?? []).reduce((acc, e) => acc + e.amount, 0)

  function toggleExpand(id: string) {
    setExpandedId(prev => prev === id ? null : id)
  }

  async function handleDelete(id: string) {
    setDeleting(true)
    const r = await window.hw.deleteExpense(id)
    setDeleting(false)
    if (!r.ok) { setError(r.error); return }
    setConfirmDeleteId(null)
    setExpandedId(null)
    void loadExpenses()
  }

  // Cuando hay un gasto en edición, mostrar solo el modal de edición.
  // Al cerrar (guardar o cancelar), vuelve la lista con datos frescos.
  if (editingExpense) {
    return (
      <ExpenseModal
        editingExpense={editingExpense}
        onRegistered={() => { setEditingExpense(null); void loadExpenses() }}
        onCancel={() => setEditingExpense(null)}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-gray-900 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-lg font-semibold">Gastos del turno</h2>
            <p className="text-xs text-gray-500">
              {expenses
                ? `${expenses.length} gasto${expenses.length !== 1 ? 's' : ''} · tocá uno para ver el detalle`
                : 'Cargando…'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              title="Actualizar estado de deudas"
              className="rounded-md bg-gray-800 px-2.5 py-1.5 text-xs text-gray-400 hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              {refreshing ? '…' : '↻'}
            </button>
            <button
              onClick={onClose}
              className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
            >
              Cerrar
            </button>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {error ? (
            <p className="text-red-400 text-sm px-6 py-4">{error}</p>
          ) : !expenses ? (
            <p className="text-gray-500 text-sm animate-pulse px-6 py-4">Cargando…</p>
          ) : expenses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-600 space-y-2">
              <p className="text-3xl">💸</p>
              <p className="text-sm">No hay gastos registrados en este turno</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-800/60">
              {expenses.map(e => {
                const isExpanded = expandedId === e.id
                const label = e.provider ?? e.concept ?? '—'
                const hasDebtDetail = e.newDebtAmount || e.paysOldDebt
                const totalVisit = e.newDebtAmount ? e.amount + e.newDebtAmount : null

                // Estado actual de la deuda (puede haber sido saldada después de este turno)
                const debtStatus = e.providerId ? providerStatuses[e.providerId] : undefined
                const currentBalance = debtStatus?.balance
                const debtWasPaid = e.newDebtAmount && e.newDebtAmount > 0
                  && currentBalance !== undefined && currentBalance !== null
                  && currentBalance <= 0
                const paidByLabel = debtStatus?.lastPaymentBy
                  ? debtStatus.lastPaymentStoreName
                    ? `${debtStatus.lastPaymentBy} (${debtStatus.lastPaymentStoreName})`
                    : debtStatus.lastPaymentBy
                  : null

                return (
                  <li key={e.id}>
                    {/* Fila principal — siempre visible */}
                    <button
                      onClick={() => toggleExpand(e.id)}
                      className={`w-full text-left px-5 py-3 flex items-center gap-3 transition-colors ${
                        isExpanded ? 'bg-gray-800/60' : 'hover:bg-gray-800/30'
                      }`}
                    >
                      {/* Chevron */}
                      <span className={`shrink-0 text-gray-500 text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                        ▶
                      </span>

                      {/* Hora */}
                      <span className="shrink-0 text-xs text-gray-500 w-10">{formatTime(e.createdAt)}</span>

                      {/* Proveedor / concepto */}
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm text-white font-medium" title={label}>{label}</p>
                        {e.provider && e.concept && (
                          <p className="truncate text-xs text-gray-500" title={e.concept}>{e.concept}</p>
                        )}
                      </div>

                      {/* Indicador deuda — verde si ya fue saldada, ámbar si sigue pendiente */}
                      {hasDebtDetail && (
                        debtWasPaid ? (
                          <span className="shrink-0 text-[10px] text-green-400 bg-green-950/50 border border-green-800/40 rounded px-1.5 py-0.5">
                            pagada
                          </span>
                        ) : (
                          <span className="shrink-0 text-[10px] text-amber-400 bg-amber-950/50 border border-amber-800/40 rounded px-1.5 py-0.5">
                            deuda
                          </span>
                        )
                      )}

                      {/* Monto */}
                      <span className="shrink-0 text-sm font-semibold text-amber-400">{formatARS(e.amount)}</span>
                    </button>

                    {/* Panel de detalle — se expande al hacer clic */}
                    {isExpanded && (
                      <div className="bg-gray-800/40 border-t border-gray-700/40 px-5 py-4 space-y-3 text-sm">

                        {/* Proveedor y concepto */}
                        {e.provider && (
                          <DetailRow label="Proveedor" value={e.provider} />
                        )}
                        {e.concept && (
                          <DetailRow label="Concepto" value={e.concept} />
                        )}

                        {/* Montos */}
                        <div className="rounded-xl overflow-hidden border border-gray-700/50">
                          {totalVisit !== null && (
                            <div className="flex justify-between px-3 py-2 bg-gray-700/30 border-b border-gray-700/40">
                              <span className="text-gray-400 text-xs">Total de la visita</span>
                              <span className="text-white font-semibold">{formatARS(totalVisit)}</span>
                            </div>
                          )}
                          <div className={`flex justify-between px-3 py-2 ${totalVisit !== null ? '' : 'bg-gray-700/30'}`}>
                            <span className="text-gray-400 text-xs">
                              {totalVisit !== null ? 'Pagado en esta visita' : 'Monto pagado'}
                            </span>
                            <span className="text-white font-semibold">{formatARS(e.amount)}</span>
                          </div>
                          {e.newDebtAmount && (
                            debtWasPaid ? (
                              // La deuda fue generada pero luego saldada
                              <div className="px-3 py-2 border-t border-green-800/30 bg-green-950/20 space-y-0.5">
                                <div className="flex justify-between">
                                  <span className="text-green-400 text-xs">Deuda generada (ya saldada ✓)</span>
                                  <span className="text-green-300 font-semibold">{formatARS(e.newDebtAmount)}</span>
                                </div>
                                {paidByLabel && (
                                  <p className="text-[11px] text-green-400/60">Pagada por {paidByLabel}</p>
                                )}
                              </div>
                            ) : (
                              <div className="flex justify-between px-3 py-2 border-t border-amber-800/30 bg-amber-950/20">
                                <span className="text-amber-400 text-xs">Deuda generada</span>
                                <span className="text-amber-300 font-semibold">{formatARS(e.newDebtAmount)}</span>
                              </div>
                            )
                          )}
                          {e.paysOldDebt && (
                            <div className="flex justify-between px-3 py-2 border-t border-green-800/30 bg-green-950/20">
                              <span className="text-green-400 text-xs">Deuda anterior pagada</span>
                              <span className="text-green-300 font-semibold">{formatARS(e.paysOldDebt)}</span>
                            </div>
                          )}
                        </div>

                        {/* Notas */}
                        {e.notes && (
                          <DetailRow label="Notas" value={e.notes} />
                        )}

                        {/* Botones de acción */}
                        <div className="flex gap-2 pt-2 border-t border-gray-700/40">
                          <button
                            onClick={() => setEditingExpense(e)}
                            className="flex-1 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs text-gray-200 transition-colors"
                          >
                            Editar
                          </button>
                          {confirmDeleteId === e.id ? (
                            <div className="flex-1 flex gap-1">
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="flex-1 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs text-gray-400 transition-colors"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={() => void handleDelete(e.id)}
                                disabled={deleting}
                                className="flex-1 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-xs text-white font-semibold transition-colors disabled:opacity-40"
                              >
                                {deleting ? '…' : 'Confirmar'}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(e.id)}
                              className="flex-1 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/60 border border-red-800/40 text-xs text-red-400 transition-colors"
                            >
                              Eliminar
                            </button>
                          )}
                        </div>

                        {/* Metadatos */}
                        <div className="flex items-center justify-between text-xs text-gray-600 pt-1">
                          <span>Registrado por <span className="text-gray-400">{e.createdBy}</span></span>
                          <span>{formatDate(e.createdAt)} {formatTime(e.createdAt)}</span>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer total */}
        {expenses && expenses.length > 0 && (
          <div className="border-t border-gray-800 px-6 py-3 flex justify-between items-center shrink-0">
            <p className="text-xs text-gray-500">Total pagado en el turno</p>
            <p className="text-base font-bold text-amber-400">{formatARS(total)}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="shrink-0 text-xs text-gray-500 w-24">{label}</span>
      <span className="flex-1 min-w-0 text-xs text-white break-words">{value}</span>
    </div>
  )
}
