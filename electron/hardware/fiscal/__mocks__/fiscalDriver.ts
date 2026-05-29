/**
 * Mock del driver SAM4S NR-330F para sandbox y tests.
 * NUNCA se incluye en el bundle de producción.
 *
 * Modos inyectables via FISCAL_MOCK_MODE:
 *   normal            — procesa pagos con éxito simulado
 *   timeout           — no responde (simula caja sin red)
 *   http_error        — responde con 5xx
 *   malformed_response — responde con datos que no parsean
 *   disconnect        — simula que la caja se desconecta
 */

import type {
  FiscalDriver,
  FiscalPaymentRequest,
  FiscalPaymentResult,
} from '../fiscalDriver.interface'

let receiptCounter = 1000

export class FiscalMockDriver implements FiscalDriver {
  private _connected = false

  private get mode(): string {
    return process.env['FISCAL_MOCK_MODE'] ?? 'normal'
  }

  async connect(): Promise<void> {
    if (this.mode === 'timeout') {
      await new Promise(resolve => setTimeout(resolve, 30000))
      throw new Error('Timeout al conectar con la caja registradora')
    }
    // En modo disconnect, conecta normalmente — la desconexión ocurre durante el pago
    this._connected = true
  }

  async disconnect(): Promise<void> {
    this._connected = false
  }

  isConnected(): boolean {
    return this._connected
  }

  async processPayment(req: FiscalPaymentRequest): Promise<FiscalPaymentResult> {
    if (!this._connected) {
      return { ok: false, error: 'Caja no conectada' }
    }

    switch (this.mode) {
      case 'timeout':
        await new Promise(resolve => setTimeout(resolve, 30000))
        throw new Error('Timeout al procesar pago')

      case 'http_error':
        return { ok: false, error: 'Error HTTP 500 de la caja registradora' }

      case 'malformed_response':
        return { ok: false, error: 'Respuesta malformada de la caja (no parseable)' }

      case 'disconnect':
        this._connected = false
        return { ok: false, error: 'La caja se desconectó durante el pago' }

      default:
        receiptCounter++
        return {
          ok: true,
          receiptNumber: `${req.paymentMethod.toUpperCase()}-${receiptCounter}`,
        }
    }
  }

  async issueCashReceipt(_amount: number, referenceId: string): Promise<FiscalPaymentResult> {
    if (!this._connected) {
      return { ok: false, error: 'Caja no conectada' }
    }
    if (this.mode !== 'normal') {
      return { ok: false, error: `Mock en modo ${this.mode} — receipt no emitido` }
    }
    receiptCounter++
    return {
      ok: true,
      receiptNumber: `CASH-${receiptCounter}-${referenceId.slice(0, 6)}`,
    }
  }
}
