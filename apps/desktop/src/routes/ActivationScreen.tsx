import { useState } from 'react'
import { Button } from '../components/ui'

interface Props {
  licenseKey: string
  onActivated: () => void
}

export default function ActivationScreen({ licenseKey, onActivated }: Props) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await window.hw.activateInstallation({ licenseKey, activationCode: code.trim() })
      if (result.ok) {
        onActivated()
      } else {
        setError(result.error ?? 'Código incorrecto. Verificar e intentar nuevamente.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-app p-6 gap-8">
      <div className="text-center space-y-3">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-raised text-4xl shadow-[0_12px_40px_rgba(28,28,30,0.16)]">
          🔑
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink">Activación requerida</h1>
          <p className="mt-1 max-w-xs text-center text-sm text-muted">
            Esta instalación necesita ser activada. Ingresá el código que viene con la licencia.
          </p>
        </div>
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-7 shadow-[0_12px_40px_rgba(28,28,30,0.16)] space-y-5">
        <div className="rounded-xl border border-line bg-input px-4 py-2.5 flex items-center gap-2 min-w-0">
          <span className="text-xs text-muted shrink-0">Licencia</span>
          <span className="font-mono text-sm font-semibold text-ink truncate" title={licenseKey}>{licenseKey}</span>
        </div>

        <form onSubmit={handleActivate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">
              Código de activación
            </label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="XXXX-XXXX"
              className="w-full rounded-xl border border-line bg-input px-4 py-3 text-center font-mono text-lg tracking-widest text-ink placeholder-subtle focus:border-line-accent focus:outline-none transition-colors"
              disabled={loading}
              required
            />
          </div>

          {error && (
            <div className="rounded-xl border border-danger bg-panel px-3 py-2.5">
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          <Button
            type="submit"
            fullWidth
            size="lg"
            loading={loading}
            disabled={!code.trim()}
          >
            {loading ? 'Activando…' : 'Activar instalación'}
          </Button>
        </form>

        <p className="text-center text-xs text-subtle">
          ¿Sin código? Contactar al soporte técnico del sistema.
        </p>
      </div>
    </div>
  )
}
