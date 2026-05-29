interface Props {
  reason: 'inactive' | 'expired' | 'offline_timeout' | 'not_found' | 'error'
  message: string
}

const SUPPORT_URL = 'https://wa.me/5491100000000'

export default function LicenseErrorScreen({ reason, message }: Props) {
  const titles: Record<Props['reason'], string> = {
    inactive: 'Licencia desactivada',
    expired: 'Licencia vencida',
    offline_timeout: 'Sin conexión a internet',
    not_found: 'Licencia no encontrada',
    error: 'Error de verificación',
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl text-center space-y-6">
        <div className="flex justify-center">
          <span className="text-6xl">🔒</span>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-gray-900">{titles[reason]}</h1>
          <p className="mt-2 text-gray-600">{message}</p>
        </div>

        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-800">
          Para resolver este problema, contactar al soporte técnico.
        </div>

        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noreferrer"
          className="block w-full rounded-lg bg-green-600 px-4 py-3 text-center font-semibold text-white hover:bg-green-700 transition-colors"
        >
          Contactar soporte técnico
        </a>

        <p className="text-xs text-gray-400">
          No cerrar la aplicación — tomar captura de pantalla de este mensaje.
        </p>
      </div>
    </div>
  )
}
