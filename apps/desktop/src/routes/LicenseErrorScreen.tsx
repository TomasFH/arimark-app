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
    <div className="flex flex-1 flex-col items-center justify-center bg-app p-6 gap-8">
      <div className="text-center space-y-3">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-panel text-4xl shadow-[0_12px_40px_rgba(28,28,30,0.16)] border border-danger">
          🔒
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink">{titles[reason]}</h1>
          <p className="mt-1 text-sm text-muted">{message}</p>
        </div>
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-7 shadow-[0_12px_40px_rgba(28,28,30,0.16)] space-y-5">
        <div className="rounded-xl border border-danger bg-panel px-4 py-3 text-sm text-danger">
          Para resolver este problema, contactar al soporte técnico.
        </div>

        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noreferrer"
          className="flex h-12 w-full items-center justify-center rounded-xl bg-accent font-semibold text-accent-fg transition-all hover:bg-[color-mix(in_srgb,var(--accent)_86%,black)] active:scale-[0.98]"
        >
          Contactar soporte técnico
        </a>

        <p className="text-center text-xs text-subtle">
          No cerrar la aplicación — tomar captura de pantalla de este mensaje.
        </p>
      </div>
    </div>
  )
}
