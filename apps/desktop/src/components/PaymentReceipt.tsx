import type { ReactNode } from 'react'

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
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="bg-gray-900 px-6 py-4 text-center">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Comprobante de pago</p>
          <p className="text-lg font-bold text-white mt-0.5 truncate" title={businessName}>
            {businessName}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">{formattedDate}</p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="text-center border-b border-gray-200 pb-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">Proveedor</p>
            <p className="text-xl font-bold text-gray-900 mt-0.5 truncate" title={providerName}>
              {providerName}
            </p>
            {concept && (
              <p className="text-sm text-gray-500 mt-0.5 truncate" title={concept}>
                {concept}
              </p>
            )}
          </div>

          {children}

          <div className={`rounded-xl px-4 py-3 text-center ${resultClassName}`}>
            {result}
          </div>

          <div className="border-t border-dashed border-gray-300 pt-4 text-center">
            <p className="text-[11px] text-gray-400 leading-relaxed">
              Registrado digitalmente · Guardado en el sistema
            </p>
          </div>
        </div>

        <div className="px-6 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-gray-900 text-white font-semibold hover:bg-zinc-800 transition-colors"
          >
            Cerrar comprobante
          </button>
        </div>
      </div>
    </div>
  )
}
