/**
 * El cierre se lee. Los campos aparecen recién al elegir «Corregir cierre».
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatMoney } from '../../lib/adminFirestore'
import ShiftCloseAmountsForm from './ShiftCloseAmountsForm'

interface Props {
  cashLeft: number | null
  withdrawn: number | null
  onSubmit: (patch: { cashLeft?: number; withdrawn?: number }) => Promise<void>
}

function amountText(value: number | null): string {
  return value == null ? 'sin anotar' : formatMoney(value)
}

export default function ShiftCloseCorrection({ cashLeft, withdrawn, onSubmit }: Props) {
  const [editing, setEditing] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex min-w-0 items-start gap-2">
        <dl className="min-w-0 flex-1 space-y-1.5">
          <AmountFact label="Quedó en la caja" value={amountText(cashLeft)} />
          <AmountFact label="Se retiró" value={amountText(withdrawn)} />
        </dl>
        <CloseActionMenu onCorrect={() => setEditing(true)} />
      </div>
      {editing && (
        <ShiftCloseAmountsForm
          mode="correct"
          initialCashLeft={cashLeft}
          initialWithdrawn={withdrawn}
          submitLabel="Guardar"
          onSubmit={async patch => {
            await onSubmit(patch)
            setEditing(false)
          }}
        />
      )}
    </div>
  )
}

function AmountFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="min-w-0 flex-1 truncate text-sm text-zinc-400" title={label}>{label}</dt>
      <dd className="shrink-0 text-sm font-semibold tabular-nums text-zinc-100">{value}</dd>
    </div>
  )
}

function CloseActionMenu({ onCorrect }: { onCorrect: () => void }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const width = 224
    setPos({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)),
    })
  }, [open])

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Acciones del cierre"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
      >
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <circle cx="3.5" cy="8" r="1.3" />
          <circle cx="8" cy="8" r="1.3" />
          <circle cx="12.5" cy="8" r="1.3" />
        </svg>
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="Acciones del cierre"
            style={{ top: pos.top, left: pos.left, width: 224 }}
            className="fixed z-[51] overflow-hidden rounded-xl bg-zinc-800 shadow-[0_8px_28px_rgba(0,0,0,0.35)] ring-1 ring-zinc-700"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onCorrect()
              }}
              className="flex w-full min-w-0 items-center px-3 py-3 text-left text-sm text-zinc-100 hover:bg-zinc-700"
            >
              <span className="min-w-0 flex-1 truncate" title="Corregir cierre">Corregir cierre</span>
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
