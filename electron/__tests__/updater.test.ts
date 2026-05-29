import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on: vi.fn(),
    checkForUpdatesAndNotify: vi.fn(),
    quitAndInstall: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  app: {
    once: vi.fn(),
    on: vi.fn(),
    getVersion: vi.fn().mockReturnValue('0.1.0'),
  },
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { autoUpdater } from 'electron-updater'
import { isUpdateAvailable, initUpdater } from '../updater'

describe('updater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['APP_ENV'] = 'production'
  })

  it('no inicializa en modo sandbox', () => {
    process.env['APP_ENV'] = 'sandbox'
    initUpdater()
    expect(autoUpdater.checkForUpdatesAndNotify).not.toHaveBeenCalled()
  })

  it('llama checkForUpdatesAndNotify en producción', () => {
    initUpdater()
    expect(autoUpdater.checkForUpdatesAndNotify).toHaveBeenCalledOnce()
  })

  it('registra listeners en producción', () => {
    initUpdater()
    expect(autoUpdater.on).toHaveBeenCalledWith('update-available', expect.any(Function))
    expect(autoUpdater.on).toHaveBeenCalledWith('update-downloaded', expect.any(Function))
    expect(autoUpdater.on).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('isUpdateAvailable retorna false por defecto', () => {
    expect(isUpdateAvailable()).toBe(false)
  })

  it('isUpdateAvailable devuelve false antes de recibir actualización', () => {
    initUpdater()
    expect(isUpdateAvailable()).toBe(false)
  })
})
