/**
 * Banner permanente visible en modo sandbox.
 * Inamovible e inconfundible — no puede pasar desapercibido.
 */
export function SandboxBanner() {
  const isSandbox = import.meta.env['VITE_APP_ENV'] === 'sandbox'

  if (!isSandbox) return null

  return (
    <div
      role="status"
      aria-label="Modo sandbox activo"
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-yellow-400 px-4 py-2 text-sm font-bold text-yellow-900 shadow-md"
    >
      <span>⚠</span>
      <span>MODO SANDBOX — Los datos de esta sesión son ficticios y no afectan producción</span>
      <span>⚠</span>
    </div>
  )
}
