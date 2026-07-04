import { useState } from 'react'

type LoginMode = 'cashier' | 'admin'

const isDevMode = import.meta.env['VITE_APP_ENV'] === 'dev'

const DEV_EMAIL = 'cajera1@dev.local'
const DEV_PASSWORD = 'cajera1234'

interface Props {
  onCashierLogin: (email: string, password: string) => Promise<void>
  onAdminLogin: (email: string, password: string) => Promise<void>
  businessName: string
}

export default function LoginScreen({ onCashierLogin, onAdminLogin, businessName }: Props) {
  const [mode, setMode] = useState<LoginMode>('cashier')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (mode === 'cashier') {
        await onCashierLogin(email, password)
      } else {
        await onAdminLogin(email, password)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-gray-900 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">{businessName}</h1>
          <p className="mt-1 text-sm text-gray-500">Sistema de gestión</p>
        </div>

        <div className="flex rounded-lg bg-gray-100 p-1">
          {(['cashier', 'admin'] as LoginMode[]).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(''); setEmail(''); setPassword('') }}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                mode === m
                  ? 'bg-white shadow text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {m === 'cashier' ? 'Cajera' : 'Administrador'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="email"
              disabled={loading}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="current-password"
              disabled={loading}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>

        {isDevMode && (
          <div className="border-t border-gray-200 pt-4">
            <button
              onClick={async () => {
                setLoading(true)
                setError('')
                try {
                  await onCashierLogin(DEV_EMAIL, DEV_PASSWORD)
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Error al saltar login.')
                } finally {
                  setLoading(false)
                }
              }}
              disabled={loading}
              className="w-full rounded-lg border-2 border-dashed border-yellow-400 px-4 py-2.5 text-sm font-semibold text-yellow-700 bg-yellow-50 hover:bg-yellow-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ⚠ Saltar login — {DEV_EMAIL} (modo pruebas)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
