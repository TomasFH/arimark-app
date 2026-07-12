import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const setSecretMock = vi.fn()
vi.mock('../../secureStorage', () => ({
  setSecret: (...args: unknown[]) => setSecretMock(...args),
  SECRET_KEYS: { KRETZ_PORT: 'kretz-port' },
}))

import { ipcMain } from 'electron'
import { registerKretzPortHandlers } from '../kretzPort.handler'
import type { HardwareManager } from '../../hardware/hardwareManager'

type Handler = (event: unknown, payload: unknown) => Promise<unknown>

function getRegisteredHandler(): Handler {
  return vi.mocked(ipcMain.handle).mock.calls[0][1] as Handler
}

function makeManager(detect: () => Promise<string | null>): HardwareManager {
  return { detectAndConnectKretz: vi.fn(detect) } as unknown as HardwareManager
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('kretzPort.handler — KRETZ_DETECT_PORT', () => {
  it('detecta la balanza, la persiste y devuelve el puerto', async () => {
    registerKretzPortHandlers(makeManager(async () => 'COM11'))
    const handler = getRegisteredHandler()

    const result = await handler({}, undefined)

    expect(result).toMatchObject({ ok: true, data: { port: 'COM11' } })
    expect(setSecretMock).toHaveBeenCalledWith('kretz-port', 'COM11')
  })

  it('devuelve error si no se detecta ninguna balanza', async () => {
    registerKretzPortHandlers(makeManager(async () => null))
    const handler = getRegisteredHandler()

    const result = await handler({}, undefined)

    expect(result).toMatchObject({ ok: false })
    expect(setSecretMock).not.toHaveBeenCalled()
  })

  it('rechaza payload malformado (zod)', async () => {
    registerKretzPortHandlers(makeManager(async () => 'COM11'))
    const handler = getRegisteredHandler()

    const result = await handler({}, { unexpected: 'value' })

    expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    expect(setSecretMock).not.toHaveBeenCalled()
  })

  it('captura errores lanzados por la detección', async () => {
    registerKretzPortHandlers(
      makeManager(async () => {
        throw new Error('fallo de hardware')
      })
    )
    const handler = getRegisteredHandler()

    const result = await handler({}, undefined)

    expect(result).toMatchObject({ ok: false, error: 'fallo de hardware' })
    expect(setSecretMock).not.toHaveBeenCalled()
  })
})
