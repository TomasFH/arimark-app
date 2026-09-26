/**
 * Aviso corto, arriba al centro. Vive fuera de los modales: el modal puede cerrarse
 * y el cartel sigue hasta desaparecer. Colores del tema (claro y oscuro).
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const TOAST_MS = 3200

type Listener = (message: string) => void
let listener: Listener | null = null

export function showAppToast(message: string): void {
  listener?.(message)
}

export function AppToastHost() {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    listener = setMessage
    return () => {
      if (listener === setMessage) listener = null
    }
  }, [])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [message])

  if (!message) return null

  return createPortal(
    <div
      role="status"
      className="pointer-events-none fixed left-1/2 top-6 z-[80] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2"
    >
      <div className="flex animate-toast-in items-center gap-3 rounded-2xl border border-success/30 bg-panel px-4 py-3 text-ink shadow-[0_12px_32px_rgba(28,28,30,0.18)]">
        <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={message}>{message}</p>
      </div>
    </div>,
    document.body,
  )
}
