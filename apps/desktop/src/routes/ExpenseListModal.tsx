/**
 * Modal de lista de gastos del turno activo.
 * Solo lectura — para registrar un gasto usar ExpenseModal.
 */
import { useEffect, useState } from 'react'
import type { ExpenseRow } from '../types/hw-api'
import { formatARS } from '../lib/datetime'

interface Props {
  onClose: () => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export default function ExpenseListModal({ onClose }: Props) {
  const [expenses, setExpenses] = useState<ExpenseRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.hw.getShiftExpenses().then(r => {
      if (r.ok) setExpenses(r.data)
      else setError(r.error)
    })
  }, [])

  const total = (expenses ?? []).reduce((acc, e) => acc + e.amount, 0)

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-lg font-semibold">Gastos del turno</h2>
            <p className="text-xs text-gray-500">
              {expenses ? `${expenses.length} gasto${expenses.length !== 1 ? 's' : ''} registrado${expenses.length !== 1 ? 's' : ''}` : 'Cargando…'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
          >
            Cerrar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error ? (
            <p className="text-red-400 text-sm">{error}</p>
          ) : !expenses ? (
            <p className="text-gray-500 text-sm animate-pulse">Cargando…</p>
          ) : expenses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-600 space-y-2">
              <p className="text-3xl">💸</p>
              <p className="text-sm">No hay gastos registrados en este turno</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 text-left">
                  <th className="pb-2 pr-3">Hora</th>
                  <th className="pb-2 pr-3">Categoría</th>
                  <th className="pb-2 pr-3">Notas</th>
                  <th className="pb-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(e => (
                  <tr key={e.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-2 pr-3 text-gray-500 text-xs">{formatTime(e.createdAt)}</td>
                    <td className="py-2 pr-3 text-white">{e.category}</td>
                    <td className="py-2 pr-3 text-gray-500 text-xs">{e.notes ?? '—'}</td>
                    <td className="py-2 text-right font-semibold text-amber-400">{formatARS(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {expenses && expenses.length > 0 && (
          <div className="border-t border-gray-800 px-6 py-3 flex justify-between items-center">
            <p className="text-xs text-gray-500">Total gastos</p>
            <p className="text-base font-bold text-amber-400">{formatARS(total)}</p>
          </div>
        )}
      </div>
    </div>
  )
}
