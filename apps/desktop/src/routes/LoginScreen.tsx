import { useState } from 'react'
import { PASSWORD_RESET_SENT_MESSAGE } from '../lib/passwordCopy'
import { BrandMark, Button } from '../components/ui'

const isDevMode = import.meta.env['VITE_APP_ENV'] === 'dev'

const DEV_EMAIL = 'cajera1@dev.local'
const DEV_PASSWORD = 'cajera1234'

const FIELD =
  'w-full rounded-xl border border-line bg-input px-4 py-3 text-sm text-ink placeholder-subtle focus:border-line-accent focus:outline-none transition-colors'

interface Props {
  onLogin: (email: string, password: string) => Promise<void>
  businessName: string
}

export default function LoginScreen({ onLogin, businessName }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resetNotice, setResetNotice] = useState('')
  const [resetSending, setResetSending] = useState(false)
  const [resetMode, setResetMode] = useState(false)
  const [errorKey, setErrorKey] = useState(0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (resetMode) {
      void handleForgotPassword()
      return
    }
    setError('')
    setResetNotice('')
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

  async function handleForgotPassword() {
    setError('')
    setResetNotice('')
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Ingresá tu email para enviarte el mail.')
      setErrorKey(k => k + 1)
      return
    }
    setResetSending(true)
    try {
      const result = await window.hw.sendPasswordReset({ email: trimmed })
      if (!result.ok) {
        setError(result.error)
        setErrorKey(k => k + 1)
        return
      }
      setResetNotice(
        isDevMode
          ? 'Modo pruebas: no se envía mail. En producción se mandaría a este email.'
          : PASSWORD_RESET_SENT_MESSAGE,
      )
    } finally {
      setResetSending(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-app p-6 gap-8">
      <div className="text-center space-y-3">
        <BrandMark size={64} className="mx-auto shadow-[0_12px_40px_rgba(28,28,30,0.16)]" />
        <div>
          <h1 className="text-2xl font-bold text-ink">{businessName}</h1>
          <p className="mt-1 text-sm text-muted">Sistema de gestión</p>
        </div>
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-7 shadow-[0_12px_40px_rgba(28,28,30,0.16)] space-y-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          {resetMode ? (
            <p className="text-sm text-muted">
              Ingresá el email de la cuenta. Te mandamos un mail para elegir una contraseña nueva.
            </p>
          ) : null}

          <div>
            <label htmlFor="login-email" className="block text-xs font-medium text-muted mb-1.5">Email</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={FIELD}
              autoComplete="email"
              disabled={loading || resetSending}
              required={!resetMode}
            />
          </div>

          {!resetMode && (
          <div>
            <label htmlFor="login-password" className="block text-xs font-medium text-muted mb-1.5">Contraseña</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={FIELD}
              autoComplete="current-password"
              disabled={loading || resetSending}
              required
            />
            <button
              type="button"
              onClick={() => {
                setError('')
                setResetNotice('')
                setResetMode(true)
              }}
              disabled={loading || resetSending}
              className="mt-2 text-xs text-muted hover:text-ink disabled:opacity-40"
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>
          )}

          {resetNotice && (
            <div className="rounded-xl border border-line bg-accent-soft px-3 py-2.5">
              <p className="text-sm text-success">{resetNotice}</p>
            </div>
          )}

          {error && (
            <div key={errorKey} className="animate-shake rounded-xl border border-danger bg-panel px-3 py-2.5">
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          <Button
            type="submit"
            fullWidth
            size="lg"
            loading={resetMode ? resetSending : loading}
            disabled={!resetMode && (!email || !password)}
            className="mt-1"
          >
            {resetMode
              ? (resetSending ? 'Enviando mail…' : 'Restablecer contraseña')
              : (loading ? 'Ingresando…' : 'Ingresar')}
          </Button>
          {resetMode && (
            <button
              type="button"
              onClick={() => {
                setResetMode(false)
                setError('')
                setResetNotice('')
              }}
              disabled={resetSending}
              className="w-full text-xs text-muted hover:text-ink disabled:opacity-40"
            >
              Volver al ingreso
            </button>
          )}
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
          className="w-full max-w-sm rounded-xl border-2 border-dashed border-amber-600 bg-hover px-4 py-3 text-sm font-semibold text-ink transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          ⚠ Saltar login — {DEV_EMAIL} (modo pruebas)
        </button>
      )}
    </div>
  )
}
