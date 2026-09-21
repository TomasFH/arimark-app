import type { ReactNode } from 'react'
import type { MerchVisitReceiptItem } from '@carniceria/shared'
import { Button, Modal, SectionLabel } from './ui'
import type { ModalSize } from './ui'

interface Props {
  businessName: string
  date: string
  providerName: string
  concept?: string
  /** Renglones de mercadería. Si hay, el modal se ensancha y la lista scrollea adentro. */
  items?: MerchVisitReceiptItem[]
  children: ReactNode
  resultClassName: string
  result: ReactNode
  onClose: () => void
}

const ITEM_SCROLL_AFTER = 6

/** Comprobante fotográfico de escritorio (Gastos y Saldar). No se comparte con el celu. */
export default function PaymentReceipt({
  businessName,
  date,
  providerName,
  concept,
  items,
  children,
  resultClassName,
  result,
  onClose,
}: Props) {
  const formattedDate = new Date(date).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
  const merch = items?.filter(item => item.name.trim()) ?? []
  const hasMerch = merch.length > 0
  const size: ModalSize = hasMerch ? 'lg' : 'md'
  const merchScrolls = merch.length > ITEM_SCROLL_AFTER

  return (
    <Modal
      open
      onClose={onClose}
      title="Comprobante de pago"
      size={size}
      footer={<Button variant="primary" onClick={onClose}>Cerrar comprobante</Button>}
    >
      <div className="space-y-4">
        <div className="text-center">
          <p className="truncate text-lg font-bold text-ink" title={businessName}>
            {businessName}
          </p>
          <p className="mt-0.5 text-xs text-muted">{formattedDate}</p>
        </div>

        <div className="border-b border-line pb-4 text-center">
          <p className="text-xs text-muted">Proveedor</p>
          <p className="mt-0.5 truncate text-xl font-bold text-ink" title={providerName}>
            {providerName}
          </p>
          {concept && (
            <p className="mt-0.5 truncate text-sm text-muted" title={concept}>
              {concept}
            </p>
          )}
        </div>

        {hasMerch ? (
          <div className="grid grid-cols-2 gap-x-8 min-w-0">
            <SectionLabel className="col-start-1">Mercadería</SectionLabel>
            <ul
              className={`col-start-1 row-start-2 min-w-0 ${
                merchScrolls
                  ? 'max-h-[11.5rem] overflow-y-auto [scrollbar-gutter:stable] divide-y divide-line pr-1'
                  : 'divide-y divide-line'
              }`}
              tabIndex={merchScrolls ? 0 : undefined}
              aria-label="Mercadería"
            >
              {merch.map((item, i) => (
                <li key={`${item.name}-${i}`} className="flex items-baseline justify-between gap-3 py-1.5 min-w-0">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink" title={item.name}>
                    {item.name}
                  </span>
                  {item.qty ? (
                    <span className="shrink-0 tabular-nums text-sm text-muted" title={item.qty}>
                      {item.qty}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="col-start-2 row-start-2 min-w-0 space-y-2 text-sm">
              {children}
            </div>
          </div>
        ) : (
          children
        )}

        <div className={`rounded-xl px-4 py-3 text-center ${resultClassName}`}>
          {result}
        </div>

        <p className="border-t border-dashed border-line pt-4 text-center text-[11px] leading-relaxed text-muted">
          Registrado digitalmente · Guardado en el sistema
        </p>
      </div>
    </Modal>
  )
}
