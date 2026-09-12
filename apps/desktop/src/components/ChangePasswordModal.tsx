/**
 * Cambio de contraseña de la cuenta en sesión (FEAT-AUTH-PASSWORD-01).
 * Cada usuario lo hace por su cuenta; el admin no lo hace por ellos.
 */
import { useState } from 'react'
import { newPasswordIssue, MAX_AUTH_PASSWORD_LENGTH } from '../lib/passwordRules'
import { PASSWORD_RESET_SENT_MESSAGE } from '../lib/passwordCopy'

interface Props {
  onClose: () => void
}

export default function ChangePasswordModal({ onClose }: Props) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingMail, setSendingMail] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [requiresMail, setRequiresMail] = useState(false)

  const isDev = import.meta.env['VITE_APP_ENV'] === 'dev'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    const issue = newPasswordIssue(newPassword, confirmPassword, currentPassword)
    if (issue) {
      setError(issue)
      return
    }
    setLoading(true)
    try {
      const result = await window.hw.changePassword({ currentPassword, newPassword })
      if (!result.ok) {
        setError(result.error)
        setRequiresMail(result.code === 'REQUIRES_REAUTH' || result.code === 'WRONG_PASSWORD')
        return
      }
      setNotice(isDev ? 'Modo pruebas: no se cambió nada en Firebase.' : 'Contraseña actualizada.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setRequiresMail(false)
    } finally {
      setLoading(false)
    }
  }

  async function handleSendMail() {
    setError('')
    setNotice('')
    setSendingMail(true)
    try {
      const result = await window.hw.sendPasswordReset({})
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNotice(
        isDev
          ? 'Modo pruebas: no se envía mail. En producción sí se mandaría a tu email.'
          : PASSWORD_RESET_SENT_MESSAGE,
      )
    } finally {
      setSendingMail(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-100">Cambiar contraseña</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Solo para tu cuenta. Nadie más ve ni cambia tu clave.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-sm text-zinc-500 hover:text-zinc-200"
          >
            Cerrar
          </button>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e) }} className="space-y-3">
          <div>
            <label htmlFor="change-password-current" className="mb-1 block text-xs font-medium text-zinc-400">Contraseña actual</label>
            <input
              id="change-password-current"
              type="password"
              autoComplete="current-password"
              maxLength={MAX_AUTH_PASSWORD_LENGTH}
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
              disabled={loading}
              required
            />
          </div>
          <div>
            <label htmlFor="change-password-new" className="mb-1 block text-xs font-medium text-zinc-400">Nueva contraseña</label>
            <input
              id="change-password-new"
              type="password"
              autoComplete="new-password"
              maxLength={MAX_AUTH_PASSWORD_LENGTH}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
              disabled={loading}
              required
            />
          </div>
          <div>
            <label htmlFor="change-password-confirm" className="mb-1 block text-xs font-medium text-zinc-400">Repetir nueva</label>
            <input
              id="change-password-confirm"
              type="password"
              autoComplete="new-password"
              maxLength={MAX_AUTH_PASSWORD_LENGTH}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
              disabled={loading}
              required
            />
          </div>

          {error && (
            <p className="rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</p>
          )}
          {notice && (
            <p className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">{notice}</p>
          )}

          <button
            type="submit"
            disabled={loading || !currentPassword || !newPassword || !confirmPassword}
            className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? 'Guardando…' : 'Guardar'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => { void handleSendMail() }}
          disabled={sendingMail || loading}
          className="mt-3 w-full text-center text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-40"
        >
          {sendingMail
            ? 'Enviando mail…'
            : requiresMail
              ? 'Enviar mail para restablecer'
              : '¿No recordás la actual? Enviar mail'}
        </button>
      </div>
    </div>
  )
}
