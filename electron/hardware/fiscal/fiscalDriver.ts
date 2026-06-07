/**
 * Driver real de la caja registradora SAM4S NR-330F.
 *
 * Comunicación via HTTP sobre red local. Autenticación HTTP Basic Auth.
 * Las credenciales (usuario y contraseña) se leen desde @napi-rs/keyring.
 * La IP se lee desde safeStorage (SECRET_KEYS.SAM4S_IP).
 *
 * NOTA sobre endpoints:
 * Los paths exactos dependen del firmware instalado en la NR-330F.
 * Verificar contra la documentación HTTP del equipo real antes del deploy.
 * Ver PLAN.md § Fase 1 — Bloqueante.
 *
 * NOTA: este módulo NUNCA se usa en APP_ENV=sandbox.
 * En sandbox y tests se usa FiscalMockDriver.
 */

import http from 'node:http'
import log from 'electron-log'
import type {
  FiscalDriver,
  FiscalPaymentRequest,
  FiscalPaymentResult,
} from './fiscalDriver.interface'

// Endpoints configurables — ajustar según firmware de la NR-330F
const ENDPOINTS = {
  STATUS: '/api/status',
  PAYMENT: '/api/payment',
  RECEIPT: '/api/receipt',
} as const

const REQUEST_TIMEOUT_MS = 10_000

interface Sam4sPaymentResponse {
  success: boolean
  receiptNumber?: string
  errorMessage?: string
}

export class FiscalRealDriver implements FiscalDriver {
  private _connected = false

  constructor(
    private readonly ip: string,
    private readonly username: string,
    private readonly password: string
  ) {}

  async connect(): Promise<void> {
    if (!this.ip || this.ip.trim() === '') {
      throw new Error('[sam4s] IP de la caja no configurada. Configurarla desde el panel admin.')
    }
    if (!this.username || !this.password) {
      throw new Error('[sam4s] Credenciales de la caja no configuradas. Configurarlas desde el panel admin.')
    }

    const response = await this._request('GET', ENDPOINTS.STATUS, null)
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        `[sam4s] La caja respondió con status ${response.statusCode} al verificar conexión.`
      )
    }
    this._connected = true
    log.info('[sam4s] Conexión verificada con la caja', { ip: this.ip })
  }

  async disconnect(): Promise<void> {
    this._connected = false
    log.info('[sam4s] Sesión cerrada con la caja', { ip: this.ip })
  }

  isConnected(): boolean {
    return this._connected
  }

  async processPayment(req: FiscalPaymentRequest): Promise<FiscalPaymentResult> {
    if (!this._connected) {
      return { ok: false, error: 'Caja no conectada' }
    }

    let response: { statusCode: number; body: string }
    try {
      response = await this._request('POST', ENDPOINTS.PAYMENT, {
        amount: req.amount,
        paymentMethod: req.paymentMethod,
        referenceId: req.referenceId,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[sam4s] Error de red al procesar pago', { err: msg })
      return { ok: false, error: `Error de red con la caja: ${msg}` }
    }

    if (response.statusCode >= 500) {
      log.error('[sam4s] Error HTTP 5xx al procesar pago', { status: response.statusCode })
      return { ok: false, error: `Error HTTP ${response.statusCode} de la caja registradora` }
    }

    let parsed: Sam4sPaymentResponse
    try {
      parsed = JSON.parse(response.body) as Sam4sPaymentResponse
    } catch {
      log.error('[sam4s] Respuesta no parseable de la caja', { body: response.body })
      return { ok: false, error: 'Respuesta malformada de la caja (no parseable)' }
    }

    if (!parsed.success) {
      return { ok: false, error: parsed.errorMessage ?? 'La caja rechazó el pago sin detalle' }
    }

    log.info('[sam4s] Pago procesado', { receiptNumber: parsed.receiptNumber })
    return { ok: true, receiptNumber: parsed.receiptNumber }
  }

  async issueCashReceipt(amount: number, referenceId: string): Promise<FiscalPaymentResult> {
    if (!this._connected) {
      return { ok: false, error: 'Caja no conectada' }
    }

    let response: { statusCode: number; body: string }
    try {
      response = await this._request('POST', ENDPOINTS.RECEIPT, { amount, referenceId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[sam4s] Error de red al emitir comprobante en efectivo', { err: msg })
      return { ok: false, error: `Error de red con la caja: ${msg}` }
    }

    if (response.statusCode >= 500) {
      return { ok: false, error: `Error HTTP ${response.statusCode} de la caja registradora` }
    }

    let parsed: Sam4sPaymentResponse
    try {
      parsed = JSON.parse(response.body) as Sam4sPaymentResponse
    } catch {
      return { ok: false, error: 'Respuesta malformada de la caja (no parseable)' }
    }

    if (!parsed.success) {
      return { ok: false, error: parsed.errorMessage ?? 'La caja rechazó la emisión del comprobante' }
    }

    return { ok: true, receiptNumber: parsed.receiptNumber }
  }

  private _request(
    method: string,
    path: string,
    body: object | null
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64')
      const bodyStr = body !== null ? JSON.stringify(body) : ''

      const options: http.RequestOptions = {
        hostname: this.ip,
        port: 80,
        path,
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      }

      const req = http.request(options, res => {
        let data = ''
        res.on('data', chunk => (data += chunk))
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data }))
      })

      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error(`Timeout al comunicarse con la caja SAM4S (${REQUEST_TIMEOUT_MS}ms)`))
      })

      req.on('error', reject)

      if (bodyStr) req.write(bodyStr)
      req.end()
    })
  }
}
