import { describe, it, expect, vi, beforeEach } from 'vitest'

// Estado compartido con el mock de serialport. Debe crearse con vi.hoisted porque
// vi.mock se eleva por encima de las declaraciones normales del módulo.
const state = vi.hoisted(() => ({
  behaviors: {} as Record<string, 'ok' | 'noresponse' | 'busy' | 'garbage'>,
  listResult: [] as Array<{ path: string; manufacturer?: string; pnpId?: string }>,
}))

/** Construye una respuesta R30 válida con el código dado (checksum correcto). */
function buildResponse(responseCode: string, data = ''): Buffer {
  const STX_RESP = 0x07
  const ETX = 0x04
  const inner = `B0101${responseCode}${data}`
  const innerBuf = Buffer.from(inner, 'ascii')
  const prefix = Buffer.from([STX_RESP])
  let sum = 0
  for (const b of Buffer.concat([prefix, innerBuf])) sum = (sum + b) & 0xffff
  const low = sum & 0xff
  const chk = String.fromCharCode(0x30 + ((low >> 4) & 0x0f), 0x30 + (low & 0x0f))
  return Buffer.concat([prefix, innerBuf, Buffer.from(chk + String.fromCharCode(ETX), 'ascii')])
}

vi.mock('serialport', () => {
  class MockSerialPort {
    path: string
    isOpen = false
    private handlers: Record<string, (arg?: unknown) => void> = {}

    constructor(opts: { path: string }) {
      this.path = opts.path
    }

    on(event: string, handler: (arg?: unknown) => void): this {
      this.handlers[event] = handler
      return this
    }

    open(cb: (err: Error | null) => void): void {
      const behavior = state.behaviors[this.path]
      if (behavior === 'busy') {
        cb(new Error('Access denied (puerto ocupado)'))
        return
      }
      this.isOpen = true
      cb(null)
    }

    write(_data: Buffer): void {
      const behavior = state.behaviors[this.path]
      if (behavior === 'ok') {
        queueMicrotask(() => this.handlers['data']?.(buildResponse('01')))
      } else if (behavior === 'garbage') {
        queueMicrotask(() => this.handlers['data']?.(Buffer.from([0x07, 0x42, 0x04])))
      }
      // 'noresponse' → nunca emite data → resuelve por timeout.
    }

    close(cb: () => void): void {
      this.isOpen = false
      cb()
    }

    static list = vi.fn(async () => state.listResult)
  }
  return { SerialPort: MockSerialPort }
})

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { listSerialPorts, probeKretzPort, detectKretzPort } from '../portDetect'

beforeEach(() => {
  vi.clearAllMocks()
  state.behaviors = {}
  state.listResult = []
})

describe('portDetect — listSerialPorts', () => {
  it('mapea los puertos devueltos por serialport', async () => {
    state.listResult = [
      { path: 'COM3', manufacturer: 'FTDI' },
      { path: 'COM11', manufacturer: 'JDATAGATE' },
    ]
    const ports = await listSerialPorts()
    expect(ports).toHaveLength(2)
    expect(ports[0]).toMatchObject({ path: 'COM3', manufacturer: 'FTDI' })
    expect(ports[1]).toMatchObject({ path: 'COM11' })
  })
})

describe('portDetect — probeKretzPort', () => {
  it('devuelve true si el puerto responde OK al protocolo R30', async () => {
    state.behaviors = { COM8: 'ok' }
    await expect(probeKretzPort('COM8', 200)).resolves.toBe(true)
  })

  it('devuelve false si el puerto no responde (timeout)', async () => {
    state.behaviors = { COM5: 'noresponse' }
    await expect(probeKretzPort('COM5', 50)).resolves.toBe(false)
  })

  it('devuelve false si el puerto está ocupado', async () => {
    state.behaviors = { COM8: 'busy' }
    await expect(probeKretzPort('COM8', 200)).resolves.toBe(false)
  })

  it('devuelve false ante una respuesta corrupta', async () => {
    state.behaviors = { COM8: 'garbage' }
    await expect(probeKretzPort('COM8', 200)).resolves.toBe(false)
  })
})

describe('portDetect — detectKretzPort', () => {
  it('devuelve el puerto que responde al protocolo R30', async () => {
    state.listResult = [{ path: 'COM3' }, { path: 'COM11' }]
    state.behaviors = { COM3: 'noresponse', COM11: 'ok' }
    await expect(detectKretzPort(50)).resolves.toBe('COM11')
  })

  it('salta puertos ocupados y encuentra el correcto', async () => {
    state.listResult = [{ path: 'COM8' }, { path: 'COM11' }]
    state.behaviors = { COM8: 'busy', COM11: 'ok' }
    await expect(detectKretzPort(50)).resolves.toBe('COM11')
  })

  it('devuelve null si ninguna balanza responde', async () => {
    state.listResult = [{ path: 'COM3' }, { path: 'COM5' }]
    state.behaviors = { COM3: 'noresponse', COM5: 'busy' }
    await expect(detectKretzPort(50)).resolves.toBeNull()
  })

  it('devuelve null si no hay puertos serie', async () => {
    state.listResult = []
    await expect(detectKretzPort(50)).resolves.toBeNull()
  })

  it('prioriza el puerto con pistas de adaptador USB-serie', async () => {
    state.listResult = [
      { path: 'COM1' },
      { path: 'COM11', manufacturer: 'Prolific USB-Serial' },
    ]
    // Ambos responden OK; debe elegir el priorizado (COM11) por sondearlo primero.
    state.behaviors = { COM1: 'ok', COM11: 'ok' }
    await expect(detectKretzPort(50)).resolves.toBe('COM11')
  })
})
