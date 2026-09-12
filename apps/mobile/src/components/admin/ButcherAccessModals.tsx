import { useState, type FormEvent } from 'react'
import { Btn, LabeledInput, Modal } from './shared'

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
    <Modal title="Dar acceso al celular" onClose={onCancel}>
      <form onSubmit={e => void handleSubmit(e)} className="space-y-3">
        <p className="text-sm text-zinc-400">
          Se crea una cuenta para{' '}
          <span className="truncate font-medium text-white" title={employeeName}>{employeeName}</span>
          . Recibirá un email para configurar su contraseña. Hace falta internet.
        </p>
        <LabeledInput
          label="Email"
          value={email}
          onChange={setEmail}
          placeholder="nombre@ejemplo.com"
          inputMode="email"
          maxLength={120}
          required
        />
        {formError && (
          <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400/80">
            {formError}
          </p>
        )}
        <div className="flex gap-2">
          <Btn variant="ghost" className="flex-1" onClick={onCancel} disabled={busy}>
            Cancelar
          </Btn>
          <Btn type="submit" className="flex-1" disabled={busy}>
            {busy ? 'Creando cuenta…' : 'Dar acceso'}
          </Btn>
        </div>
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
  onConfirm: () => Promise<string | null>
}) {
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  return (
    <Modal title="Revocar acceso al celular" onClose={onCancel}>
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">
          Se desactivará la cuenta de{' '}
          <span className="inline-block max-w-full truncate align-bottom font-medium text-white" title={employeeName}>
            {employeeName}
          </span>
          . Ya no podrá ingresar a la app del celular.
        </p>
        {formError && (
          <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400/80">
            {formError}
          </p>
        )}
        <div className="flex gap-2">
          <Btn variant="ghost" className="flex-1" onClick={onCancel} disabled={busy}>
            Cancelar
          </Btn>
          <Btn
            variant="danger"
            className="flex-1"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setFormError(null)
              void onConfirm().then(err => {
                setBusy(false)
                if (err) setFormError(err)
              })
            }}
          >
            {busy ? 'Revocando…' : 'Revocar acceso'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
