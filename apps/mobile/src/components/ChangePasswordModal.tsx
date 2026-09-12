/**
 * Cambio de contraseña de la cuenta en sesión (FEAT-AUTH-PASSWORD-01).
 */
import { useState } from 'react'
import { useBackLayer } from '../lib/backStack'
import { useKeyboardInset } from '../lib/keyboardInset'
import { newPasswordIssue, MAX_AUTH_PASSWORD_LENGTH } from '../lib/passwordRules'
import {
  changePassword,
  sendPasswordReset,
  PASSWORD_RESET_SENT_MESSAGE,
} from '../lib/auth'

interface Props {
  onClose: () => void
}

export function ChangePasswordModal({ onClose }: Props) {
  useBackLayer(true, onClose)
  const keyboardInset = useKeyboardInset()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingMail, setSendingMail] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [requiresMail, setRequiresMail] = useState(false)

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
      const result = await changePassword(currentPassword, newPassword)
      if (!result.ok) {
        setError(result.error)
        setRequiresMail(result.code === 'REQUIRES_REAUTH' || result.code === 'WRONG_PASSWORD')
        return
      }
      setNotice('Contraseña actualizada.')
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
      const result = await sendPasswordReset()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNotice(PASSWORD_RESET_SENT_MESSAGE)
    } finally {
      setSendingMail(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end bg-black/80"
      style={{ paddingBottom: keyboardInset }}
    >
      <div className="max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-gray-900 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white">Cambiar contraseña</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Solo para tu cuenta.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-sm text-zinc-400"
          >
            Cerrar
          </button>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e) }} className="space-y-3">
          <div>
            <label htmlFor="mob-change-current" className="mb-1 block text-sm text-gray-300">Contraseña actual</label>
            <input
              id="mob-change-current"
              type="password"
              autoComplete="current-password"
              maxLength={MAX_AUTH_PASSWORD_LENGTH}
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-base text-white"
              disabled={loading}
              required
            />
          </div>
          <div>
            <label htmlFor="mob-change-new" className="mb-1 block text-sm text-gray-300">Nueva contraseña</label>
            <input
              id="mob-change-new"
              type="password"
              autoComplete="new-password"
              maxLength={MAX_AUTH_PASSWORD_LENGTH}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-base text-white"
              disabled={loading}
              required
            />
          </div>
          <div>
            <label htmlFor="mob-change-confirm" className="mb-1 block text-sm text-gray-300">Repetir nueva</label>
            <input
              id="mob-change-confirm"
              type="password"
              autoComplete="new-password"
              maxLength={MAX_AUTH_PASSWORD_LENGTH}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-base text-white"
              disabled={loading}
              required
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-700 bg-red-900/50 px-3 py-2 text-sm text-red-300">{error}</p>
          )}
          {notice && (
            <p className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{notice}</p>
          )}

          <button
            type="submit"
            disabled={loading || !currentPassword || !newPassword || !confirmPassword}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:bg-gray-700"
          >
            {loading ? 'Guardando…' : 'Guardar'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => { void handleSendMail() }}
          disabled={sendingMail || loading}
          className="w-full text-center text-sm text-zinc-500"
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
