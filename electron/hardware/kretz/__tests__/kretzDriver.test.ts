import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KretzRealDriver } from '../kretzDriver'

// Mockear serialport para no necesitar hardware real en tests
vi.mock('serialport', () => {
  const MockSerialPort = vi.fn().mockImplementation(() => ({
    open: vi.fn((_cb: (err: Error | null) => void) => {
      // Simula apertura exitosa por defecto
    }),
    close: vi.fn((cb: () => void) => cb()),
    on: vi.fn(),
    write: vi.fn(),
  }))
  return { SerialPort: MockSerialPort }
})

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
    const mockOpen = vi.fn((cb: (err: Error | null) => void) => {
      cb(new Error('Puerto no disponible'))
    })
    vi.mocked(SerialPort).mockImplementationOnce(
      () =>
        ({
          open: mockOpen,
          close: vi.fn(),
          on: vi.fn(),
        }) as unknown as InstanceType<typeof SerialPort>
    )

    const driver = new KretzRealDriver('COM99')
    await expect(driver.connect()).rejects.toThrow(/COM99/)
    expect(driver.isConnected()).toBe(false)
  })
})
