import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../licensing/notifyRenderer', () => ({
  notifyRenderer: vi.fn(),
}))

vi.mock('../activeSession', () => ({
  getActiveSession: vi.fn(),
  setActiveSession: vi.fn(),
}))

vi.mock('../licensing/session', () => ({
  reverifyOnlineOnly: vi.fn(),
}))

import { notifyRenderer } from '../licensing/notifyRenderer'
import { getActiveSession, setActiveSession } from '../activeSession'
import { reverifyOnlineOnly } from '../licensing/session'
import {
  startOfflineSessionWatch,
  stopOfflineSessionWatch,
} from '../offlineSessionWatch'
import { IPC } from '../ipc/channels'

describe('offlineSessionWatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stopOfflineSessionWatch()
    vi.mocked(getActiveSession).mockReturnValue({
      userId: 'uid-1',
      storeId: 'store-1',
      role: 'cashier',
      shiftId: null,
      offlineSession: true,
    })
  })

  afterEach(() => {
    stopOfflineSessionWatch()
  })

  it('al revalidar online limpia el flag y notifica upgrade', async () => {
    vi.mocked(reverifyOnlineOnly).mockResolvedValue('upgraded')
    startOfflineSessionWatch({
      licenseKey: 'LIC',
      email: 'ana@negocio.com',
      password: 'pw',
    })
    await vi.waitFor(() => {
      expect(notifyRenderer).toHaveBeenCalledWith(IPC.OFFLINE_SESSION_UPGRADED)
    })
    expect(setActiveSession).toHaveBeenCalledWith(expect.objectContaining({ offlineSession: false }))
  })

  it('si la cuenta está deshabilitada fuerza logout', async () => {
    vi.mocked(reverifyOnlineOnly).mockResolvedValue('disabled')
    startOfflineSessionWatch({
      licenseKey: 'LIC',
      email: 'ana@negocio.com',
      password: 'pw',
    })
    await vi.waitFor(() => {
      expect(notifyRenderer).toHaveBeenCalledWith(IPC.OFFLINE_SESSION_REVOKED, { reason: 'disabled' })
    })
    expect(setActiveSession).toHaveBeenCalledWith(null)
  })

  it('si sigue sin red no toca la sesión', async () => {
    vi.mocked(reverifyOnlineOnly).mockResolvedValue('still_offline')
    startOfflineSessionWatch({
      licenseKey: 'LIC',
      email: 'ana@negocio.com',
      password: 'pw',
    })
    await vi.waitFor(() => {
      expect(reverifyOnlineOnly).toHaveBeenCalled()
    })
    expect(setActiveSession).not.toHaveBeenCalled()
    expect(notifyRenderer).not.toHaveBeenCalled()
  })
})
