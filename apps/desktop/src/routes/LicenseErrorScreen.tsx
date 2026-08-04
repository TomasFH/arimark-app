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
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-950 p-6 gap-8">
      <div className="text-center space-y-3">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-950/40 text-4xl shadow-xl border border-red-900/30">
          🔒
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">{titles[reason]}</h1>
          <p className="mt-1 text-sm text-zinc-400">{message}</p>
        </div>
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-7 shadow-2xl space-y-5">
        <div className="rounded-xl border border-red-900/40 bg-red-950/25 px-4 py-3 text-sm text-red-300">
          Para resolver este problema, contactar al soporte técnico.
        </div>

        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noreferrer"
          className="flex h-12 w-full items-center justify-center rounded-xl bg-emerald-600 font-semibold text-white transition-all hover:bg-emerald-500 active:scale-[0.98]"
        >
          Contactar soporte técnico
        </a>

        <p className="text-center text-xs text-zinc-600">
          No cerrar la aplicación — tomar captura de pantalla de este mensaje.
        </p>
      </div>
    </div>
  )
}
