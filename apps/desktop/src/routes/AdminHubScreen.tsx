/**
 * Pantalla de entrada para el administrador.
 * Permite elegir entre el panel de administración y el modo cajera de emergencia.
 */
import type { SessionInfo, InitStatus } from '../types/hw-api'

interface Props {
  session: SessionInfo
  initStatus: InitStatus
  onGoToAdminPanel: () => void
  onGoToCashier: () => void
  onGoToCashierManagement: () => void
  onLogout: () => void
}

export default function AdminHubScreen({ initStatus, onGoToAdminPanel, onGoToCashier, onGoToCashierManagement, onLogout }: Props) {
  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Administrador</p>
          <h1 className="text-base font-semibold text-white">{initStatus.businessName}</h1>
        </div>
        <button
          onClick={onLogout}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Cerrar sesión
        </button>
      </header>

      {/* Opciones principales */}
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-xl space-y-4">
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
        </div>
      </div>
    </div>
  )
}
