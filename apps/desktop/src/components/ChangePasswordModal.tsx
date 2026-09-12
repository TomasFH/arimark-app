/**
 * Cambio de contraseña de la cuenta en sesión (FEAT-AUTH-PASSWORD-01).
 * Cada usuario lo hace por su cuenta; el admin no lo hace por ellos.
 */
import { useState } from 'react'
import { newPasswordIssue, MAX_AUTH_PASSWORD_LENGTH } from '../lib/passwordRules'
import { PASSWORD_RESET_SENT_MESSAGE } from '../lib/passwordCopy'
import { Button, Modal } from './ui'

interface Props {
  onClose: () => void
}

const fieldClass =
  'w-full rounded-xl border border-line bg-input px-4 py-2.5 text-sm text-ink focus:border-line-accent focus:outline-none'

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
    <Modal
      open
      onClose={onClose}
      title="Cambiar contraseña"
      size="sm"
      footer={(
        <>
          <Button variant="secondary" className="mr-auto" onClick={onClose} disabled={loading}>
            Cerrar
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="change-password-form"
            loading={loading}
            disabled={!currentPassword || !newPassword || !confirmPassword}
          >
            {loading ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      )}
    >
      <p className="mb-4 text-xs text-muted">Solo para tu cuenta. Nadie más ve ni cambia tu clave.</p>

      <form id="change-password-form" onSubmit={(e) => { void handleSubmit(e) }} className="space-y-3">
        <div>
          <label htmlFor="change-password-current" className="mb-1 block text-xs font-medium text-muted">Contraseña actual</label>
          <input
            id="change-password-current"
            type="password"
            autoComplete="current-password"
            maxLength={MAX_AUTH_PASSWORD_LENGTH}
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            className={fieldClass}
            disabled={loading}
            required
          />
        </div>
        <div>
          <label htmlFor="change-password-new" className="mb-1 block text-xs font-medium text-muted">Nueva contraseña</label>
          <input
            id="change-password-new"
            type="password"
            autoComplete="new-password"
            maxLength={MAX_AUTH_PASSWORD_LENGTH}
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className={fieldClass}
            disabled={loading}
            required
          />
        </div>
        <div>
          <label htmlFor="change-password-confirm" className="mb-1 block text-xs font-medium text-muted">Repetir nueva</label>
          <input
            id="change-password-confirm"
            type="password"
            autoComplete="new-password"
            maxLength={MAX_AUTH_PASSWORD_LENGTH}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className={fieldClass}
            disabled={loading}
            required
          />
        </div>

        {error && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}
        {notice && (
          <p className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{notice}</p>
        )}
      </form>

      <Button
        type="button"
        variant="ghost"
        fullWidth
        onClick={() => { void handleSendMail() }}
        disabled={sendingMail || loading}
        className="mt-3 text-xs text-muted"
      >
        {sendingMail
          ? 'Enviando mail…'
          : requiresMail
            ? 'Enviar mail para restablecer'
            : '¿No recordás la actual? Enviar mail'}
      </Button>
    </Modal>
  )
}
