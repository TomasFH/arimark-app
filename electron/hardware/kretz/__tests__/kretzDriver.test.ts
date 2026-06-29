import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KretzRealDriver } from '../kretzDriver'

function buildFakeResponse(responseCode: string, data = ''): Buffer {
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

type DataHandler = (chunk: Buffer) => void

function createMockPort(options: {
  onOpen?: (cb: (err: Error | null) => void) => void
  onWrite?: (data: Buffer, emitData: (chunk: Buffer) => void) => void
}) {
  let dataHandler: DataHandler | null = null
  const port = {
    open: vi.fn((cb: (err: Error | null) => void) => {
      if (options.onOpen) {
        options.onOpen(cb)
      } else {
        cb(null)
      }
    }),
    close: vi.fn((cb: () => void) => cb()),
    on: vi.fn((event: string, handler: DataHandler) => {
      if (event === 'data') dataHandler = handler
    }),
    write: vi.fn((data: Buffer) => {
      if (dataHandler && options.onWrite) {
        options.onWrite(data, chunk => dataHandler!(chunk))
      }
    }),
  }
  return port
}

// Mockear serialport para no necesitar hardware real en tests
vi.mock('serialport', () => ({
  SerialPort: vi.fn(),
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('KretzRealDriver — construcción', () => {
  it('construye sin lanzar error con puerto vacío', () => {
    expect(() => new KretzRealDriver('')).not.toThrow()
  })

  it('construye sin lanzar error con puerto de solo espacios', () => {
    expect(() => new KretzRealDriver('   ')).not.toThrow()
  })

  it('construye correctamente con un puerto válido', () => {
    const driver = new KretzRealDriver('COM3')
    expect(driver).toBeDefined()
    expect(driver.isConnected()).toBe(false)
  })
})

describe('KretzRealDriver — connect() con puerto no configurado', () => {
  it('lanza error en connect() si el puerto está vacío', async () => {
    const driver = new KretzRealDriver('')
    await expect(driver.connect()).rejects.toThrow(/no configurado/i)
  })

  it('lanza error en connect() si el puerto es solo espacios', async () => {
    const driver = new KretzRealDriver('   ')
    await expect(driver.connect()).rejects.toThrow(/no configurado/i)
  })
})

describe('KretzRealDriver — estado inicial', () => {
  it('isConnected() retorna false antes de conectar', () => {
    const driver = new KretzRealDriver('COM3')
    expect(driver.isConnected()).toBe(false)
  })
})

describe('KretzRealDriver — connect() con error de apertura', () => {
  it('rechaza la promesa si el puerto no se puede abrir', async () => {
    const { SerialPort } = await import('serialport')
    vi.mocked(SerialPort).mockImplementationOnce(
      () =>
        createMockPort({
          onOpen: cb => cb(new Error('Puerto no disponible')),
        }) as unknown as InstanceType<typeof SerialPort>
    )

    const driver = new KretzRealDriver('COM99')
    await expect(driver.connect()).rejects.toThrow(/COM99/)
    expect(driver.isConnected()).toBe(false)
  })
})

describe('KretzRealDriver — connect() exitoso', () => {
  it('conecta y emite evento connected', async () => {
    const { SerialPort } = await import('serialport')
    vi.mocked(SerialPort).mockImplementationOnce(
      () => createMockPort({}) as unknown as InstanceType<typeof SerialPort>
    )

    const driver = new KretzRealDriver('COM3')
    const connected = vi.fn()
    driver.on('connected', connected)

    await driver.connect()

    expect(driver.isConnected()).toBe(true)
    expect(connected).toHaveBeenCalled()
    await driver.disconnect()
  })

  it('connect es idempotente si ya está conectado', async () => {
    const { SerialPort } = await import('serialport')
    vi.mocked(SerialPort).mockImplementationOnce(
      () => createMockPort({}) as unknown as InstanceType<typeof SerialPort>
    )

    const driver = new KretzRealDriver('COM3')
    await driver.connect()
    await expect(driver.connect()).resolves.toBeUndefined()
    await driver.disconnect()
  })
})

describe('KretzRealDriver — testLink', () => {
  it('retorna true cuando la balanza responde OK', async () => {
    const { SerialPort } = await import('serialport')
    vi.mocked(SerialPort).mockImplementationOnce(
      () =>
        createMockPort({
          onWrite: (_data, emitData) => emitData(buildFakeResponse('01')),
        }) as unknown as InstanceType<typeof SerialPort>
    )

    const driver = new KretzRealDriver('COM3')
    await driver.connect()
    await expect(driver.testLink()).resolves.toBe(true)
    await driver.disconnect()
  })

  it('retorna false si la balanza responde con error', async () => {
    const { SerialPort } = await import('serialport')
    vi.mocked(SerialPort).mockImplementationOnce(
      () =>
        createMockPort({
          onWrite: (_data, emitData) => emitData(buildFakeResponse('02')),
        }) as unknown as InstanceType<typeof SerialPort>
    )

    const driver = new KretzRealDriver('COM3')
    await driver.connect()
    await expect(driver.testLink()).resolves.toBe(false)
    await driver.disconnect()
  })
})

describe('KretzRealDriver — transact sin conexión', () => {
  it('lanza si se llama transact sin puerto conectado', async () => {
    const driver = new KretzRealDriver('COM3')
    await expect(driver.transact('0002')).rejects.toThrow(/no conectado/)
  })
})

function cmdFromFrame(frame: Buffer): string {
  return frame.subarray(4, 8).toString('ascii')
}

describe('KretzRealDriver — PLU', () => {
  it('sendPlu envía comando 2005 y valida respuesta OK', async () => {
    const { SerialPort } = await import('serialport')
    vi.mocked(SerialPort).mockImplementationOnce(
      () =>
        createMockPort({
          onWrite: (data, emitData) => {
            expect(cmdFromFrame(data)).toBe('2005')
            emitData(buildFakeResponse('01'))
          },
        }) as unknown as InstanceType<typeof SerialPort>
    )

    const driver = new KretzRealDriver('COM3')
    await driver.connect()
    await driver.sendPlu({
      pluNumber: '1',
      name: 'Asado',
      articleCode: '12345',
      priceCents: 850000,
      pesable: true,
      department: '1',
      family: '1',
      description: '',
    })
    await driver.disconnect()
  })

  it('sendPlu lanza si la balanza responde error', async () => {
    const { SerialPort } = await import('serialport')
    vi.mocked(SerialPort).mockImplementationOnce(
      () =>
        createMockPort({
          onWrite: (_data, emitData) => emitData(buildFakeResponse('02')),
        }) as unknown as InstanceType<typeof SerialPort>
    )

    const driver = new KretzRealDriver('COM3')
    await driver.connect()
    await expect(
      driver.sendPlu({
        pluNumber: '1',
        name: 'Asado',
        articleCode: '12345',
        priceCents: 850000,
        pesable: true,
        department: '1',
        family: '1',
        description: '',
      })
    ).rejects.toThrow(/Error al enviar PLU/)
    await driver.disconnect()
  })

  it('deletePlu lanza si PLU inexistente', async () => {
    const { SerialPort } = await import('serialport')
    vi.mocked(SerialPort).mockImplementationOnce(
      () =>
        createMockPort({
          onWrite: (_data, emitData) => emitData(buildFakeResponse('20')),
        }) as unknown as InstanceType<typeof SerialPort>
    )

    const driver = new KretzRealDriver('COM3')
    await driver.connect()
    await expect(driver.deletePlu('99')).rejects.toThrow(/inexistente/)
    await driver.disconnect()
  })

  it('readPluCount devuelve cantidad parseada', async () => {
    const { SerialPort } = await import('serialport')
    vi.mocked(SerialPort).mockImplementationOnce(
      () =>
        createMockPort({
          onWrite: (data, emitData) => {
            expect(cmdFromFrame(data)).toBe('5001')
            emitData(buildFakeResponse('01', '0003'))
          },
        }) as unknown as InstanceType<typeof SerialPort>
    )

    const driver = new KretzRealDriver('COM3')
    await driver.connect()
    await expect(driver.readPluCount()).resolves.toBe(3)
    await driver.disconnect()
  })

  it('readPlu retorna null si la tabla está vacía', async () => {
    const { SerialPort } = await import('serialport')
    vi.mocked(SerialPort).mockImplementationOnce(
      () =>
        createMockPort({
          onWrite: (data, emitData) => {
            const cmd = cmdFromFrame(data)
            if (cmd === '5001') {
              emitData(buildFakeResponse('40'))
              return
            }
            emitData(buildFakeResponse('40'))
          },
        }) as unknown as InstanceType<typeof SerialPort>
    )

    const driver = new KretzRealDriver('COM3')
    await driver.connect()
    await expect(driver.readPlu('001')).resolves.toBeNull()
    await driver.disconnect()
  })
})
