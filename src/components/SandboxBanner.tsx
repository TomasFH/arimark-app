import { useState } from 'react'

/**
 * Banner visible en modo dev. Ocupa espacio en el layout (no flota sobre el contenido)
 * y puede cerrarse para liberar espacio en pantalla.
 */
export function DevBanner() {
  const env = import.meta.env['VITE_APP_ENV']
  const [visible, setVisible] = useState(true)

  if (env !== 'dev' || !visible) return null

  return (
    <div
      role="status"
      aria-label="Modo de pruebas activo"
      className="flex shrink-0 items-center justify-center gap-2 bg-yellow-400 px-4 py-2 text-sm font-bold text-yellow-900 shadow-md"
    >
      <span aria-hidden="true">⚠</span>
      <span className="flex-1 text-center">
        MODO PRUEBAS — Sin licencias ni Firebase. Los datos no afectan producción.
      </span>
      <span aria-hidden="true">⚠</span>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Cerrar aviso de modo pruebas"
        className="ml-1 rounded p-0.5 text-yellow-900 hover:bg-yellow-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-800"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </button>
    </div>
  )
}

/** @deprecated Usar DevBanner */
export const SandboxBanner = DevBanner
