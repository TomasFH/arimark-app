import type { ReactNode } from 'react'
import { Button, Modal } from './ui'

interface Props {
  businessName: string
  date: string
  providerName: string
  concept?: string
  children: ReactNode
  resultClassName: string
  result: ReactNode
  onClose: () => void
}

/** Comprobante fotográfico compartido (Gastos y Saldar). */
export default function PaymentReceipt({
  businessName,
  date,
  providerName,
  concept,
  children,
  resultClassName,
  result,
  onClose,
}: Props) {
  const formattedDate = new Date(date).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <Modal
      open
      onClose={onClose}
      title="Comprobante de pago"
      size="md"
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

        {children}

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
