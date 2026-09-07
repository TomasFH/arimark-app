import { useState, type FormEvent } from 'react'

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 animate-overlay-fade">
      <form
        onSubmit={e => void handleSubmit(e)}
        className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-700 bg-zinc-900 p-5"
      >
        <div>
          <h2 className="text-lg font-semibold">Dar acceso al celular</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Se crea una cuenta para{' '}
            <span className="truncate font-medium text-white" title={employeeName}>{employeeName}</span>
            . Recibirá un email para configurar su contraseña.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm text-zinc-300">Email</label>
          <input
            type="email"
            value={email}
            maxLength={150}
            onChange={e => setEmail(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            placeholder="nombre@ejemplo.com"
            autoFocus
            required
          />
        </div>

        {formError && <p className="text-sm text-red-400/80">{formError}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:bg-zinc-700"
          >
            {busy ? 'Creando cuenta…' : 'Dar acceso'}
          </button>
        </div>
      </form>
    </div>
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 animate-overlay-fade">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-base font-semibold text-white">Revocar acceso al celular</h2>
        <p className="text-sm text-zinc-400">
          Se desactivará la cuenta de{' '}
          <span className="inline-block max-w-full truncate align-bottom font-medium text-white" title={employeeName}>
            {employeeName}
          </span>
          . Ya no podrá ingresar a la app del celular.
        </p>
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl border border-zinc-700 py-2 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void onConfirm().finally(() => setBusy(false))
            }}
            className="flex-1 rounded-xl border border-amber-900/50 bg-amber-900/60 py-2 font-semibold text-amber-400/90 hover:bg-amber-900/80 disabled:opacity-40"
          >
            {busy ? 'Revocando…' : 'Revocar acceso'}
          </button>
        </div>
      </div>
    </div>
  )
}
