/**
 * Pantalla de entrada para el administrador.
 * Permite elegir entre el panel de administración y el modo cajera de emergencia.
 */
import { useState } from 'react'
import type { SessionInfo, InitStatus } from '../types/hw-api'
import AttendanceModal from './AttendanceModal'
import StockCountModal from './StockCountModal'

interface Props {
  session: SessionInfo
  initStatus: InitStatus
  onGoToAdminPanel: () => void
  onGoToCashier: () => void
  onGoToCashierManagement: () => void
  onGoToStoreManagement: () => void
  onGoToDebts: () => void
  onGoToSpecialCustomers: () => void
  onGoToOrders: () => void
  onGoToHistory: () => void
  onGoToProviders: () => void
  onGoToEmployees: () => void
  onGoToStockCounts: () => void
  onLogout: () => void
}

export default function AdminHubScreen({ initStatus, onGoToAdminPanel, onGoToCashier, onGoToCashierManagement, onGoToStoreManagement, onGoToDebts, onGoToSpecialCustomers, onGoToOrders, onGoToHistory, onGoToProviders, onGoToEmployees, onGoToStockCounts, onLogout }: Props) {
  const [showAttendance, setShowAttendance] = useState(false)
  const [showStockCount, setShowStockCount] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefreshRemote(): Promise<void> {
    if (refreshing) return
    setRefreshing(true)
    try {
      await window.hw.refreshRemoteData()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Administrador</p>
          <h1 className="text-base font-semibold text-white">{initStatus.businessName}</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleRefreshRemote()}
            disabled={refreshing}
            title="Actualizar datos remotos"
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
          >
            {refreshing ? 'Actualizando…' : '↺ Actualizar'}
          </button>
          <button
            onClick={onLogout}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      {/* Opciones principales */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-center min-h-full px-6">
          <div className="w-full max-w-xl space-y-4 py-8">
          <p className="text-center text-gray-400 text-sm mb-8">¿Qué querés hacer?</p>

          {/* Panel de administración */}
          <button
            onClick={onGoToAdminPanel}
            className="w-full group flex items-center gap-5 rounded-2xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 p-6 transition-all text-left"
          >
            <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-red-600/20 flex items-center justify-center text-3xl">
              ⚙️
            </div>
            <div>
              <p className="text-base font-semibold text-white">Panel de administración</p>
              <p className="text-sm text-gray-400 mt-0.5">
                Gestionar productos, precios y disponibilidad por local
              </p>
            </div>
            <div className="ml-auto text-gray-600 group-hover:text-gray-400 text-xl">›</div>
          </button>

          {/* Modo cajera de emergencia */}
          <button
            onClick={onGoToCashier}
            className="w-full group flex items-center gap-5 rounded-2xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 p-6 transition-all text-left"
          >
            <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-amber-600/20 flex items-center justify-center text-3xl">
              🛒
            </div>
            <div>
              <p className="text-base font-semibold text-white">Operar como cajera</p>
              <p className="text-sm text-gray-400 mt-0.5">
                Acceder al punto de venta en caso de emergencia
              </p>
            </div>
            <div className="ml-auto text-gray-600 group-hover:text-gray-400 text-xl">›</div>
          </button>

          {/* Gestión de cajeras */}
          <button
            onClick={onGoToCashierManagement}
            className="w-full group flex items-center gap-5 rounded-2xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 p-6 transition-all text-left"
          >
            <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-blue-600/20 flex items-center justify-center text-3xl">
              👥
            </div>
            <div>
              <p className="text-base font-semibold text-white">Gestión de cajeras</p>
              <p className="text-sm text-gray-400 mt-0.5">
                Crear, activar y desactivar cuentas de cajeras
              </p>
            </div>
            <div className="ml-auto text-gray-600 group-hover:text-gray-400 text-xl">›</div>
          </button>

          {/* Gestión de locales */}
          <button
            onClick={onGoToStoreManagement}
            className="w-full group flex items-center gap-5 rounded-2xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 p-6 transition-all text-left"
          >
            <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-teal-600/20 flex items-center justify-center text-3xl">
              🏪
            </div>
            <div>
              <p className="text-base font-semibold text-white">Gestión de locales</p>
              <p className="text-sm text-gray-400 mt-0.5">
                Ver locales registrados y agregar nuevos
              </p>
            </div>
            <div className="ml-auto text-gray-600 group-hover:text-gray-400 text-xl">›</div>
          </button>

          {/* Fiados y deudas */}
          <button
            onClick={onGoToDebts}
            className="w-full group flex items-center gap-5 rounded-2xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 p-6 transition-all text-left"
          >
            <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-amber-600/20 flex items-center justify-center text-3xl">
              📒
            </div>
            <div>
              <p className="text-base font-semibold text-white">Fiados / Cuentas corrientes</p>
              <p className="text-sm text-gray-400 mt-0.5">
                Ver deudas pendientes, registrar pagos y cancelar deudas
              </p>
            </div>
            <div className="ml-auto text-gray-600 group-hover:text-gray-400 text-xl">›</div>
          </button>

          {/* Clientes especiales */}
          <button
            onClick={onGoToSpecialCustomers}
            className="w-full group flex items-center gap-5 rounded-2xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 p-6 transition-all text-left"
          >
            <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-purple-600/20 flex items-center justify-center text-3xl">
              👤
            </div>
            <div>
              <p className="text-base font-semibold text-white">Clientes especiales</p>
              <p className="text-sm text-gray-400 mt-0.5">
                Ver y anotar precios acordados por cliente
              </p>
            </div>
            <div className="ml-auto text-gray-600 group-hover:text-gray-400 text-xl">›</div>
          </button>

          {/* Pedidos */}
          <button
            onClick={onGoToOrders}
            className="w-full group flex items-center gap-5 rounded-2xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 p-6 transition-all text-left"
          >
            <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-emerald-600/20 flex items-center justify-center text-3xl">
              📦
            </div>
            <div>
              <p className="text-base font-semibold text-white">Pedidos</p>
              <p className="text-sm text-gray-400 mt-0.5">
                Ver y gestionar todos los pedidos del local
              </p>
            </div>
            <div className="ml-auto text-gray-600 group-hover:text-gray-400 text-xl">›</div>
          </button>

          {/* Historial */}
          <button
            onClick={onGoToHistory}
            className="w-full group flex items-center gap-5 rounded-2xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 p-6 transition-all text-left"
          >
            <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-sky-600/20 flex items-center justify-center text-3xl">
              📊
            </div>
            <div>
              <p className="text-base font-semibold text-white">Historial completo</p>
              <p className="text-sm text-gray-400 mt-0.5">
                Ventas, gastos, fiados y señas de todos los turnos
              </p>
            </div>
            <div className="ml-auto text-gray-600 group-hover:text-gray-400 text-xl">›</div>
          </button>

          {/* Proveedores */}
          <button
            onClick={onGoToProviders}
            className="w-full group flex items-center gap-5 rounded-2xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 p-6 transition-all text-left"
          >
            <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-orange-600/20 flex items-center justify-center text-3xl">
              🚚
            </div>
            <div>
              <p className="text-base font-semibold text-white">Proveedores</p>
              <p className="text-sm text-gray-400 mt-0.5">
                Deuda combinada entre locales, ABM de proveedores
              </p>
            </div>
            <div className="ml-auto text-gray-600 group-hover:text-gray-400 text-xl">›</div>
          </button>

          {/* Empleados */}
          <button
            onClick={onGoToEmployees}
            className="w-full group flex items-center gap-5 rounded-2xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 p-6 transition-all text-left"
          >
            <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-lime-600/20 flex items-center justify-center text-3xl">
              👷
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-white">Empleados</p>
              <p className="text-sm text-gray-400 mt-0.5 truncate">
                Alta, sueldo, archivo y liquidación semanal
              </p>
            </div>
            <div className="ml-auto text-gray-600 group-hover:text-gray-400 text-xl shrink-0">›</div>
          </button>

          {/* Asistencia — pausada (posible retiro futuro) */}
          <button
            type="button"
            onClick={() => setShowAttendance(true)}
            className="w-full group flex items-center gap-5 rounded-2xl bg-gray-800/60 hover:bg-gray-700 border border-gray-800 hover:border-gray-600 p-6 transition-all text-left opacity-70"
          >
            <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-teal-600/20 flex items-center justify-center text-3xl">
              ✓
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-white">Asistencia <span className="text-xs font-normal text-gray-500">(pausado)</span></p>
              <p className="text-sm text-gray-500 mt-0.5 truncate">
                Disponible pero no prioritario en operación
              </p>
            </div>
            <div className="ml-auto text-gray-600 group-hover:text-gray-400 text-xl shrink-0">›</div>
          </button>

          {/* Conteo de stock */}
          <button
            type="button"
            onClick={() => setShowStockCount(true)}
            className="w-full group flex items-center gap-5 rounded-2xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 p-6 transition-all text-left"
          >
            <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-cyan-600/20 flex items-center justify-center text-3xl">
              ⚖️
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-white">Nuevo conteo de stock</p>
              <p className="text-sm text-gray-400 mt-0.5 truncate">
                Registrar inventario del día (dominical u ocasional)
              </p>
            </div>
            <div className="ml-auto text-gray-600 group-hover:text-gray-400 text-xl shrink-0">›</div>
          </button>

          {/* Historial conteos */}
          <button
            type="button"
            onClick={onGoToStockCounts}
            className="w-full group flex items-center gap-5 rounded-2xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 p-6 transition-all text-left"
          >
            <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-slate-600/20 flex items-center justify-center text-3xl">
              📦
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-white">Historial de conteos</p>
              <p className="text-sm text-gray-400 mt-0.5 truncate">
                Ver conteos pasados por local y fecha
              </p>
            </div>
            <div className="ml-auto text-gray-600 group-hover:text-gray-400 text-xl shrink-0">›</div>
          </button>
        </div>
        </div>
      </div>

      {showAttendance && (
        <AttendanceModal onClose={() => setShowAttendance(false)} />
      )}
      {showStockCount && (
        <StockCountModal onClose={() => setShowStockCount(false)} />
      )}
    </div>
  )
}
