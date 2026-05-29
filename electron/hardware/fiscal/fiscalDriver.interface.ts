export type PaymentMethod = 'debit' | 'wallet' | 'credit'

export interface FiscalPaymentRequest {
  amount: number
  paymentMethod: PaymentMethod
  referenceId: string
}

export interface FiscalPaymentResult {
  ok: boolean
  receiptNumber?: string
  error?: string
}

export interface FiscalDriver {
  /** Abre sesión HTTP con la caja (login) */
  connect(): Promise<void>
  /** Cierra la sesión */
  disconnect(): Promise<void>
  /** Estado de conexión */
  isConnected(): boolean
  /** Procesa un pago en la caja registradora */
  processPayment(req: FiscalPaymentRequest): Promise<FiscalPaymentResult>
  /** Emite comprobante en efectivo (solo cuando el cliente lo exige) */
  issueCashReceipt(amount: number, referenceId: string): Promise<FiscalPaymentResult>
}
