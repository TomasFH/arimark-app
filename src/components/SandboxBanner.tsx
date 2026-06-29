/**
 * Banner permanente visible en modo dev.
 * Inamovible e inconfundible — no puede pasar desapercibido.
 */
export function DevBanner() {
  const env = import.meta.env['VITE_APP_ENV']

  if (env !== 'dev') return null

  return (
    <div
      role="status"
      aria-label="Modo de pruebas activo"
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-yellow-400 px-4 py-2 text-sm font-bold text-yellow-900 shadow-md"
    >
      <span>⚠</span>
      <span>MODO PRUEBAS — Sin licencias ni Firebase. Los datos no afectan producción.</span>
      <span>⚠</span>
    </div>
  )
}

/** @deprecated Usar DevBanner */
export const SandboxBanner = DevBanner
