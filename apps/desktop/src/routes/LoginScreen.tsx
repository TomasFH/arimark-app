import { useState } from 'react'

const isDevMode = import.meta.env['VITE_APP_ENV'] === 'dev'

const DEV_EMAIL = 'cajera1@dev.local'
const DEV_PASSWORD = 'cajera1234'

interface Props {
  onLogin: (email: string, password: string) => Promise<void>
  businessName: string
}

export default function LoginScreen({ onLogin, businessName }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Contador que cambia con cada error para re-disparar la animación shake
  const [errorKey, setErrorKey] = useState(0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await onLogin(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión.')
      setErrorKey(k => k + 1)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-950 p-6 gap-8">
      {/* Brand */}
      <div className="text-center space-y-3">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800 text-4xl shadow-xl">
          🥩
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">{businessName}</h1>
          <p className="mt-1 text-sm text-zinc-500">Sistema de gestión</p>
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-7 shadow-2xl space-y-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none transition-colors"
              autoComplete="email"
              disabled={loading}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none transition-colors"
              autoComplete="current-password"
              disabled={loading}
              required
            />
          </div>

          {/* Error con shake — key cambia para re-disparar la animación en cada intento */}
          {error && (
            <div key={errorKey} className="animate-shake rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2.5">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="mt-1 w-full rounded-xl bg-emerald-500 py-3 font-semibold text-white transition-all hover:bg-emerald-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <span>Ingresando…</span>
              </>
            ) : (
              'Ingresar'
            )}
          </button>
        </form>
      </div>

      {isDevMode && (
        <button
          onClick={async () => {
            setLoading(true)
            setError('')
            try {
              await onLogin(DEV_EMAIL, DEV_PASSWORD)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Error al saltar login.')
              setErrorKey(k => k + 1)
            } finally {
              setLoading(false)
            }
          }}
          disabled={loading}
          className="w-full max-w-sm rounded-xl border-2 border-dashed border-yellow-600/40 bg-yellow-950/20 px-4 py-3 text-sm font-semibold text-yellow-400 transition-colors hover:border-yellow-500/60 hover:text-yellow-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ⚠ Saltar login — {DEV_EMAIL} (modo pruebas)
        </button>
      )}
    </div>
  )
}
