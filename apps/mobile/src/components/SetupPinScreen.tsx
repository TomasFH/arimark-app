/**
 * Pantalla de configuración del PIN de emergencia.
 * Se muestra después del primer login online exitoso si el dispositivo no tiene PIN.
 */
import { useState } from 'react'
import { savePin } from '../lib/pin'

interface Props {
  uid: string
  onDone: () => void
}

export function SetupPinScreen({ uid, onDone }: Props) {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (pin.length < 4 || pin.length > 6) {
      setError('El PIN debe tener entre 4 y 6 dígitos.')
      return
    }
    if (pin !== confirm) {
      setError('Los PINs no coinciden.')
      return
    }

    setSaving(true)
    await savePin(uid, pin)
    setSaving(false)
    onDone()
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-orange-600 rounded-2xl mb-4">
            <span className="text-white text-2xl">🔐</span>
          </div>
          <h1 className="text-white text-xl font-bold">Configurá tu PIN de emergencia</h1>
          <p className="text-gray-400 text-sm mt-2">
            Este PIN te permite ingresar a la app sin internet. Solo funciona en este celular.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">PIN (4–6 dígitos)</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4,6}"
              maxLength={6}
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-xl tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="• • • • • •"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">Confirmá el PIN</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4,6}"
              maxLength={6}
              value={confirm}
              onChange={e => setConfirm(e.target.value.replace(/\D/g, ''))}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-xl tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="• • • • • •"
              required
            />
          </div>

          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <button
              type="submit"
              disabled={saving}
              className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 text-white font-semibold rounded-lg px-4 py-3 transition-colors"
            >
              {saving ? 'Guardando...' : 'Guardar PIN'}
            </button>
            <button
              type="button"
              onClick={onDone}
              className="w-full text-gray-500 hover:text-gray-300 text-sm py-2 transition-colors"
            >
              Saltar por ahora
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
