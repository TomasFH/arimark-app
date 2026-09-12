import { useState, type FormEvent } from 'react'
import { Button, Modal } from './ui'

const fieldClass =
  'w-full rounded-xl border border-line bg-input px-3 py-2.5 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-line-accent'

export function GrantButcherAccessModal({
  employeeName,
  onCancel,
  onGrant,
}: {
  employeeName: string
  onCancel: () => void
  onGrant: (email: string) => Promise<string | null>
}) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed || !trimmed.includes('@')) {
      setFormError('Ingresá un email válido.')
      return
    }
    setBusy(true)
    setFormError(null)
    const err = await onGrant(trimmed)
    setBusy(false)
    if (err) setFormError(err)
  }

  return (
    <Modal
      open
      onClose={onCancel}
      closeOnOverlay={!busy}
      closeOnEscape={!busy}
      title="Dar acceso al celular"
      size="md"
      footer={(
        <>
          <Button variant="secondary" className="mr-auto" type="button" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="grant-butcher-access" loading={busy}>
            {busy ? 'Creando cuenta…' : 'Dar acceso'}
          </Button>
        </>
      )}
    >
      <form id="grant-butcher-access" onSubmit={e => void handleSubmit(e)} className="space-y-4">
        <p className="text-sm text-muted">
          Se crea una cuenta para{' '}
          <span className="truncate font-medium text-ink" title={employeeName}>{employeeName}</span>
          . Recibirá un email para configurar su contraseña.
        </p>

        <div>
          <label className="mb-1 block text-sm text-ink">Email</label>
          <input
            type="email"
            value={email}
            maxLength={150}
            onChange={e => setEmail(e.target.value)}
            className={fieldClass}
            placeholder="nombre@ejemplo.com"
            autoFocus
            required
          />
        </div>

        {formError && <p className="text-sm text-danger">{formError}</p>}
      </form>
    </Modal>
  )
}

export function RevokeButcherAccessModal({
  employeeName,
  onCancel,
  onConfirm,
}: {
  employeeName: string
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  return (
    <Modal
      open
      onClose={onCancel}
      closeOnOverlay={!busy}
      closeOnEscape={!busy}
      title="Revocar acceso al celular"
      size="sm"
      footer={(
        <>
          <Button variant="secondary" className="mr-auto" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() => {
              setBusy(true)
              void onConfirm().finally(() => setBusy(false))
            }}
          >
            {busy ? 'Revocando…' : 'Revocar acceso'}
          </Button>
        </>
      )}
    >
      <p className="text-sm text-muted">
        Se desactivará la cuenta de{' '}
        <span className="inline-block max-w-full truncate align-bottom font-medium text-ink" title={employeeName}>
          {employeeName}
        </span>
        . Ya no podrá ingresar a la app del celular.
      </p>
    </Modal>
  )
}
