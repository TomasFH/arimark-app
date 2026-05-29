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
    <div className="flex min-h-screen items-center justify-center bg-gray-900 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl space-y-6">
        <div className="text-center">
          <span className="text-5xl">🔑</span>
          <h1 className="mt-3 text-2xl font-bold text-gray-900">Activación requerida</h1>
          <p className="mt-2 text-sm text-gray-600">
            Esta instalación necesita ser activada. Ingresar el código de activación
            provisto junto a la licencia.
          </p>
        </div>

        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm">
          <span className="text-gray-500">Licencia: </span>
          <span className="font-mono font-semibold text-gray-800">{licenseKey}</span>
        </div>

        <form onSubmit={handleActivate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Código de activación
            </label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="XXXX-XXXX"
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 font-mono text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Activando...' : 'Activar instalación'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center">
          ¿Sin código? Contactar al soporte técnico del sistema.
        </p>
      </div>
    </div>
  )
}
