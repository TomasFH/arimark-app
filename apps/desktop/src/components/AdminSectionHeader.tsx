import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import ChangePasswordModal from './ChangePasswordModal'
import { BrandMark, Button, Modal } from './ui'
import { applyColorScheme } from '../lib/theme'
import type { ColorScheme, UiSettings } from '../types/hw-api'

export function GearIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
      />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/**
 * La punta de la flecha y la última letra quedan a la misma distancia del borde.
 * El glifo nace en el borde izquierdo del viewBox; si no, el hueco del ícono
 * se suma al padding y el lado izquierdo queda más ancho.
 */
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg pl-2.5 pr-2.5 text-sm font-medium text-muted hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 10 16" fill="none" aria-hidden>
        <path d="M8.25 1.25 1.25 8l7 6.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Volver
    </button>
  )
}

export function AdminAccountMenu({ onLogout }: { onLogout: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelPos, setPanelPos] = useState({ top: 0, right: 8 })
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [logoutConfirm, setLogoutConfirm] = useState<{ openShift: boolean } | null>(null)
  const [uiSettings, setUiSettings] = useState<UiSettings>({ zoomFactor: 1.0, colorScheme: 'light' })

  useEffect(() => {
    void window.hw.getUiSettings().then(result => {
      if (result.ok) {
        setUiSettings(result.data)
        applyColorScheme(result.data.colorScheme)
      }
    })
    return window.hw.onUiSettingsChanged(settings => {
      setUiSettings(settings)
      applyColorScheme(settings.colorScheme)
    })
  }, [])

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setPanelPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) })
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
    }
    function onPointer(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  async function persistUi(patch: Partial<UiSettings>): Promise<void> {
    const result = await window.hw.setUiSettings({ ...uiSettings, ...patch })
    if (result.ok) {
      setUiSettings(result.data)
      applyColorScheme(result.data.colorScheme)
    }
  }

  async function handleSetZoom(factor: number): Promise<void> {
    const clamped = Math.max(0.6, Math.min(2.0, Math.round(factor * 100) / 100))
    await persistUi({ zoomFactor: clamped })
  }

  async function handleSetScheme(scheme: ColorScheme): Promise<void> {
    await persistUi({ colorScheme: scheme })
  }

  async function handleRefreshRemote(): Promise<void> {
    if (refreshing) return
    setRefreshing(true)
    try {
      await window.hw.refreshRemoteData()
    } finally {
      setRefreshing(false)
    }
  }

  async function requestLogout(): Promise<void> {
    try {
      const result = await window.hw.getUserOpenShift()
      setLogoutConfirm({ openShift: result.ok && result.data != null })
    } catch (err) {
      console.error('[AdminAccountMenu] no se pudo consultar el turno abierto', err)
      setLogoutConfirm({ openShift: false })
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Configuración"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
          open ? 'bg-hover text-ink' : 'text-muted hover:text-ink'
        }`}
      >
        <GearIcon className="h-5 w-5" />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Configuración"
          className="fixed z-50 w-80 overflow-hidden rounded-2xl bg-panel shadow-[0_12px_40px_rgba(28,28,30,0.16)] ring-1 ring-line"
          style={{ top: panelPos.top, right: panelPos.right }}
        >
          <div className="space-y-3 px-3 py-3">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-ink">Tamaño de pantalla</p>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                  {Math.round(uiSettings.zoomFactor * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSetZoom(uiSettings.zoomFactor - 0.1)}
                  disabled={uiSettings.zoomFactor <= 0.6}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-30"
                  title="Reducir tamaño"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M3 8h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                </button>
                <div className="relative h-1.5 flex-1 rounded-full bg-raised">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-accent"
                    style={{ width: `${((uiSettings.zoomFactor - 0.6) / 1.4) * 100}%` }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleSetZoom(uiSettings.zoomFactor + 0.1)}
                  disabled={uiSettings.zoomFactor >= 2.0}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-30"
                  title="Aumentar tamaño"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-ink">Apariencia</p>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-raised p-1">
                {([
                  { id: 'light' as const, label: 'Claro' },
                  { id: 'dark' as const, label: 'Oscuro' },
                ]).map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => void handleSetScheme(opt.id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      uiSettings.colorScheme === opt.id
                        ? 'bg-panel text-ink shadow-[0_1px_2px_rgba(28,28,30,0.12)]'
                        : 'text-muted hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="border-t border-line py-1">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => { void handleRefreshRemote() }}
              className="flex w-full px-3 py-2.5 text-left text-sm text-ink hover:bg-hover disabled:opacity-40"
            >
              {refreshing ? 'Actualizando…' : 'Actualizar datos'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setShowChangePassword(true) }}
              className="flex w-full px-3 py-2.5 text-left text-sm text-ink hover:bg-hover"
            >
              Cambiar contraseña
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); void requestLogout() }}
              className="flex w-full px-3 py-2.5 text-left text-sm text-danger hover:bg-hover"
            >
              Cerrar sesión
            </button>
          </div>
        </div>,
        document.body,
      )}
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
      <Modal
        open={logoutConfirm != null}
        onClose={() => setLogoutConfirm(null)}
        size="sm"
        title="Cerrar sesión"
        footer={
          <>
            <Button variant="secondary" onClick={() => setLogoutConfirm(null)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                setLogoutConfirm(null)
                onLogout()
              }}
            >
              {logoutConfirm?.openShift ? 'Cerrar sesión igual' : 'Cerrar sesión'}
            </Button>
          </>
        }
      >
        {logoutConfirm?.openShift ? (
          <p className="text-sm text-ink">
            La caja sigue abierta. La próxima cajera no va a poder abrir la suya hasta que esta se cierre.
          </p>
        ) : (
          <p className="text-sm text-ink">¿Seguro que querés cerrar sesión?</p>
        )}
      </Modal>
    </>
  )
}

export function AdminSectionHeader({
  title,
  subtitle,
  onBack,
  onLogout,
  actions,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  onLogout?: () => void
  actions?: ReactNode
}) {
  return (
    <header className="grid min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] items-center gap-3 border-b border-line bg-raised px-5 py-3.5">
      <div className="flex min-w-0 justify-self-start">
        {onBack && <BackButton onClick={onBack} />}
      </div>
      <div className="flex min-w-0 max-w-[28rem] items-center justify-center gap-3 justify-self-center">
        <BrandMark size={40} />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight text-ink" title={title}>{title}</h1>
          {subtitle != null && subtitle !== '' && (
            <p className="truncate text-xs text-muted" title={subtitle}>{subtitle}</p>
          )}
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2 justify-self-end">
        {actions}
        {onLogout && <AdminAccountMenu onLogout={onLogout} />}
      </div>
    </header>
  )
}
