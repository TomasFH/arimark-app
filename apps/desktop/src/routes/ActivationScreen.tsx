import { useState } from 'react'

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
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-950 p-6 gap-8">
      {/* Brand / icon */}
      <div className="text-center space-y-3">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800 text-4xl shadow-xl">
          🔑
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Activación requerida</h1>
          <p className="mt-1 max-w-xs text-center text-sm text-zinc-500">
            Esta instalación necesita ser activada. Ingresá el código que viene con la licencia.
          </p>
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-7 shadow-2xl space-y-5">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 flex items-center gap-2">
          <span className="text-xs text-zinc-500">Licencia</span>
          <span className="font-mono text-sm font-semibold text-zinc-200 truncate">{licenseKey}</span>
        </div>

        <form onSubmit={handleActivate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Código de activación
            </label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="XXXX-XXXX"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-center font-mono text-lg tracking-widest text-zinc-100 placeholder-zinc-700 focus:border-zinc-600 focus:outline-none transition-colors"
              disabled={loading}
              required
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2.5">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="w-full rounded-xl bg-emerald-500 py-3 font-semibold text-white transition-all hover:bg-emerald-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30"
          >
            {loading ? 'Activando…' : 'Activar instalación'}
          </button>
        </form>

        <p className="text-center text-xs text-zinc-600">
          ¿Sin código? Contactar al soporte técnico del sistema.
        </p>
      </div>
    </div>
  )
}
