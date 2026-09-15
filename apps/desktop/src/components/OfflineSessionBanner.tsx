/**
 * Banner visible cuando el login se validó contra el hash local (sin Firebase).
 * No se puede cerrar: la cajera tiene que saber que opera sin conexión.
 */
export function OfflineSessionBanner() {
  return (
    <div
      role="status"
      aria-label="Sesión sin conexión"
      className="flex shrink-0 items-center justify-center gap-2 bg-yellow-400 px-4 py-2 text-sm font-bold text-yellow-900 shadow-md"
    >
      <span aria-hidden="true">⚠</span>
      <span className="flex-1 text-center">
        Sin conexión — sesión guardada localmente
      </span>
      <span aria-hidden="true">⚠</span>
    </div>
  )
}
