/**
 * Tests del daemon de inactividad.
 * Se usan fake timers de Vitest para controlar el tiempo sin esperas reales.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))

vi.mock('../channels', () => ({
  IPC: { SHIFT_INACTIVITY_WARNING: 'ipc:shift-inactivity-warning' },
}))

import { BrowserWindow } from 'electron'
import { startDaemon, stopDaemon, notifySaleOccurred, dismissWarning } from '../inactivityDaemon'

const mockSend = vi.fn()
const mockWindow = { webContents: { send: mockSend } }

describe('inactivityDaemon', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWindow as unknown as BrowserWindow])
    stopDaemon()
  })

  afterEach(() => {
    stopDaemon()
    vi.useRealTimers()
  })

  it('envía SHIFT_INACTIVITY_WARNING tras superar el umbral', () => {
    const thresholdHours = 2
    startDaemon(thresholdHours)

    // Avanzar 2 horas + 1 minuto (para que el check se ejecute después del umbral)
    vi.advanceTimersByTime(thresholdHours * 3_600_000 + 60_000)

    expect(mockSend).toHaveBeenCalledWith('ipc:shift-inactivity-warning')
  })

  it('no envía aviso si no se alcanzó el umbral', () => {
    const thresholdHours = 2
    startDaemon(thresholdHours)

    // Avanzar 1 hora y 59 minutos
    vi.advanceTimersByTime(1 * 3_600_000 + 59 * 60_000)

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('no envía aviso si se registró una venta antes del umbral', () => {
    const thresholdHours = 2
    startDaemon(thresholdHours)

    // Avanzar 1 hora 50 min → registrar venta → avanzar 20 min más (total 2h10m desde start, solo 20min desde venta)
    vi.advanceTimersByTime(1 * 3_600_000 + 50 * 60_000)
    notifySaleOccurred()
    vi.advanceTimersByTime(20 * 60_000)

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('dismissWarning reinicia el reloj y cancela el aviso activo', () => {
    const thresholdHours = 1
    startDaemon(thresholdHours)

    // Superar el umbral → aviso se envía
    vi.advanceTimersByTime(thresholdHours * 3_600_000 + 60_000)
    expect(mockSend).toHaveBeenCalledTimes(1)

    // Descartar el aviso → reinicia el reloj
    dismissWarning()

    // Avanzar 30 min → no debería enviar otro aviso
    vi.advanceTimersByTime(30 * 60_000)
    expect(mockSend).toHaveBeenCalledTimes(1)

    // Avanzar 35 min más (total 65min desde dismiss > 1h de umbral) → nuevo aviso
    vi.advanceTimersByTime(35 * 60_000)
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it('stopDaemon cancela el timer y no envía más avisos', () => {
    const thresholdHours = 1
    startDaemon(thresholdHours)
    stopDaemon()

    vi.advanceTimersByTime(thresholdHours * 3_600_000 + 60_000)

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('no envía avisos duplicados si el aviso ya está activo', () => {
    const thresholdHours = 1
    startDaemon(thresholdHours)

    // Superar el umbral → primer aviso
    vi.advanceTimersByTime(thresholdHours * 3_600_000 + 60_000)
    expect(mockSend).toHaveBeenCalledTimes(1)

    // Avanzar otro minuto → no duplica
    vi.advanceTimersByTime(60_000)
    expect(mockSend).toHaveBeenCalledTimes(1)
  })
})
