import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp/test-ui-settings') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

vi.mock('electron-log', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    initialize: vi.fn(),
    transports: { file: { level: 'info' } },
  },
}))

vi.mock('fs')

import { ipcMain, BrowserWindow } from 'electron'
import { registerUiSettingsHandlers, readSettings, applyInitialZoom, uiSettingsSchema } from '../uiSettings.handler'

const SETTINGS_PATH = path.join('/tmp/test-ui-settings', 'ui-settings.json')

function getHandler(channel: string): (_event: unknown, payload: unknown) => unknown {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler not registered: ${channel}`)
  return call[1] as (_event: unknown, payload: unknown) => unknown
}

describe('uiSettings.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('not found') })
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined)
  })

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  it('registra ambos canales', () => {
    registerUiSettingsHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('ipc:get-ui-settings', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('ipc:set-ui-settings', expect.any(Function))
  })

  // -------------------------------------------------------------------------
  // GET_UI_SETTINGS
  // -------------------------------------------------------------------------

  describe('GET_UI_SETTINGS', () => {
    it('devuelve defaults si el archivo no existe', () => {
      registerUiSettingsHandlers()
      const result = getHandler('ipc:get-ui-settings')({}, undefined)
      expect(result).toEqual({ ok: true, data: { zoomFactor: 1.0 } })
    })

    it('devuelve el valor guardado si el archivo existe', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ zoomFactor: 1.2 }))
      registerUiSettingsHandlers()
      const result = getHandler('ipc:get-ui-settings')({}, undefined)
      expect(result).toEqual({ ok: true, data: { zoomFactor: 1.2 } })
    })
  })

  // -------------------------------------------------------------------------
  // SET_UI_SETTINGS
  // -------------------------------------------------------------------------

  describe('SET_UI_SETTINGS', () => {
    it('guarda y aplica zoom válido', () => {
      const mockSetZoomFactor = vi.fn()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
        { webContents: { setZoomFactor: mockSetZoomFactor } } as never,
      ])
      registerUiSettingsHandlers()
      const result = getHandler('ipc:set-ui-settings')({}, { zoomFactor: 1.3 })
      expect(result).toEqual({ ok: true, data: { zoomFactor: 1.3 } })
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        SETTINGS_PATH,
        expect.stringContaining('"zoomFactor": 1.3'),
        'utf-8',
      )
      expect(mockSetZoomFactor).toHaveBeenCalledWith(1.3)
    })

    it('rechaza payload malformado (zod)', () => {
      registerUiSettingsHandlers()
      const result = getHandler('ipc:set-ui-settings')({}, { zoomFactor: 'grande' })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })

    it('rechaza zoom fuera de rango (> 2.0)', () => {
      registerUiSettingsHandlers()
      const result = getHandler('ipc:set-ui-settings')({}, { zoomFactor: 5.0 })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })

    it('rechaza zoom fuera de rango (< 0.6)', () => {
      registerUiSettingsHandlers()
      const result = getHandler('ipc:set-ui-settings')({}, { zoomFactor: 0.1 })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })
  })

  // -------------------------------------------------------------------------
  // readSettings — fallback a defaults
  // -------------------------------------------------------------------------

  it('readSettings devuelve defaults si el JSON es inválido', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('{ broken json {{')
    const s = readSettings()
    expect(s).toEqual({ zoomFactor: 1.0 })
  })

  // -------------------------------------------------------------------------
  // applyInitialZoom
  // -------------------------------------------------------------------------

  it('applyInitialZoom aplica el zoom guardado a todas las ventanas', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ zoomFactor: 1.25 }))
    const mockSetZoom = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: { setZoomFactor: mockSetZoom } } as never,
      { webContents: { setZoomFactor: mockSetZoom } } as never,
    ])
    applyInitialZoom()
    expect(mockSetZoom).toHaveBeenCalledTimes(2)
    expect(mockSetZoom).toHaveBeenCalledWith(1.25)
  })

  // -------------------------------------------------------------------------
  // Schema
  // -------------------------------------------------------------------------

  it('schema acepta valores de borde válidos', () => {
    expect(uiSettingsSchema.parse({ zoomFactor: 0.6 })).toEqual({ zoomFactor: 0.6 })
    expect(uiSettingsSchema.parse({ zoomFactor: 2.0 })).toEqual({ zoomFactor: 2.0 })
  })

  it('schema usa default 1.0 si zoomFactor no está presente', () => {
    expect(uiSettingsSchema.parse({})).toEqual({ zoomFactor: 1.0 })
  })
})
