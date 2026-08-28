/**
 * Bloques UI compartidos por todas las pantallas del panel admin.
 * Siguen el design system del proyecto: zinc + emerald, sin blue/amber.
 */
import type { ReactNode } from 'react'
import { backStackDepth, requestBack, useBackLayer } from '../../lib/backStack'
import NumericInput from '../NumericInput'
import { parseNumericInput } from '../../lib/numericInput'

// ---------------------------------------------------------------------------
// ScreenHeader
// ---------------------------------------------------------------------------

interface ScreenHeaderProps {
  title: string
  subtitle?: string
  onBack: () => void
  action?: ReactNode
}

export function ScreenHeader({ title, subtitle, onBack, action }: ScreenHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-700 bg-zinc-800/95 px-4 py-3 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => {
          // Misma pila que el atrás del sistema. Si no hay capa (pantalla mal registrada), cae al handler.
          if (backStackDepth() > 0) requestBack()
          else onBack()
        }}
        aria-label="Volver"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
      >
        ←
      </button>
      <div className="min-w-0 flex-1">
        <h1
          className="truncate text-base font-semibold text-zinc-100"
          title={title}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="truncate text-xs text-zinc-500" title={subtitle}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </header>
  )
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

export function OfflineBanner() {
  return (
    <div className="border-b border-amber-900/40 bg-amber-950/50 px-4 py-2 text-sm text-amber-400/80">
      Sin conexión — los datos del admin requieren internet.
    </div>
  )
}

interface ErrorBannerProps {
  message: string
  onRetry?: () => void
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400/80">
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 underline text-red-400">
          Reintentar
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading & Empty
// ---------------------------------------------------------------------------

export function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200" />
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-zinc-500">{message}</p>
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
}

export function Modal({ title, onClose, children }: ModalProps) {
  useBackLayer(true, onClose)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={() => requestBack()}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-sm flex-col rounded-t-2xl border border-zinc-700 bg-zinc-800 shadow-2xl sm:rounded-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-700 px-5 py-4">
          <h2 className="min-w-0 flex-1 truncate font-semibold text-zinc-100" title={title}>
            {title}
          </h2>
          <button
            type="button"
            onClick={() => requestBack()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confirmación in-app (nunca window.confirm / diálogo nativo del browser)
// ---------------------------------------------------------------------------

interface ConfirmModalProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-zinc-300">{message}</p>
      <div className="mt-4 flex gap-2">
        <Btn variant="ghost" className="flex-1" onClick={() => requestBack()}>
          {cancelLabel}
        </Btn>
        <Btn
          variant={danger ? 'danger' : 'primary'}
          className="flex-1"
          onClick={async () => {
            await onConfirm()
            onClose()
          }}
        >
          {confirmLabel}
        </Btn>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

interface LabeledInputProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  inputMode?: 'text' | 'numeric' | 'email' | 'tel'
  maxLength?: number
}

export function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  required,
  inputMode = 'text',
  maxLength,
}: LabeledInputProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-zinc-400">{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
    </label>
  )
}

interface LabeledNumericInputProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
}

export function LabeledNumericInput({
  label,
  value,
  onChange,
  placeholder,
  required,
}: LabeledNumericInputProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-zinc-400">{label}</span>
      <NumericInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
    </label>
  )
}

interface LabeledTextareaProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  maxLength?: number
}

export function LabeledTextarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  maxLength,
}: LabeledTextareaProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-zinc-400">{label}</span>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none resize-none"
      />
    </label>
  )
}

// ---------------------------------------------------------------------------
// Botón primario / secundario
// ---------------------------------------------------------------------------

interface BtnProps {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  loading?: boolean
  variant?: 'primary' | 'danger' | 'ghost'
  className?: string
}

export function Btn({
  children,
  onClick,
  type = 'button',
  disabled,
  loading,
  variant = 'primary',
  className = '',
}: BtnProps) {
  const base =
    'rounded-lg px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-40'
  const variants = {
    primary: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    danger: 'bg-red-950/40 border border-red-900/50 text-red-400/80 hover:bg-red-900/40',
    ghost: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled ?? loading}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {loading ? 'Guardando...' : children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Store selector (reutilizable entre pantallas)
// ---------------------------------------------------------------------------

interface StoreSelectorProps {
  stores: Array<{ id: string; name: string }>
  value: string
  onChange: (id: string) => void
  allowAll?: boolean
}

export function StoreSelector({ stores, value, onChange, allowAll }: StoreSelectorProps) {
  if (stores.length <= 1 && !allowAll) return null
  return (
    <div className="border-b border-zinc-700 bg-zinc-800 px-4 py-2">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none"
      >
        {allowAll && <option value="">Todos los locales</option>}
        {stores.map(s => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Numeric input helper
// ---------------------------------------------------------------------------

/** Filtra caracteres no numéricos y devuelve solo dígitos. */
export function filterDigits(value: string): string {
  return value.replace(/\D/g, '')
}

/** Parsea un string de dígitos a número entero (0 si vacío). */
export function parseDigits(value: string): number {
  return parseNumericInput(value) ?? 0
}
