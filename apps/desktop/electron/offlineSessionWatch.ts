/**
 * Re-verificación silenciosa de una sesión abierta offline (DT-02).
 * El password vive solo en memoria de proceso, nunca en disco.
 */

import log from 'electron-log'
import { notifyRenderer } from './licensing/notifyRenderer'
import { IPC } from './ipc/channels'
import { reverifyOnlineOnly } from './licensing/session'
import { getActiveSession, setActiveSession } from './activeSession'

const REVERIFY_INTERVAL_MS = 30_000

export interface OfflineWatchParams {
  licenseKey: string
  email: string
  password: string
  onUpgraded?: () => void
}

let current: OfflineWatchParams | null = null
let timer: ReturnType<typeof setInterval> | null = null
let ticking = false

export function startOfflineSessionWatch(params: OfflineWatchParams): void {
  stopOfflineSessionWatch()
  current = params
  void tickOfflineSessionWatch()
  timer = setInterval(() => {
    void tickOfflineSessionWatch()
  }, REVERIFY_INTERVAL_MS)
}

export function stopOfflineSessionWatch(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  current = null
}

export async function tickOfflineSessionWatch(): Promise<void> {
  if (!current || ticking) return
  ticking = true
  const snapshot = current
  try {
    const outcome = await reverifyOnlineOnly(snapshot.licenseKey, snapshot.email, snapshot.password)
    if (outcome === 'still_offline') return

    if (outcome === 'upgraded') {
      const session = getActiveSession()
      if (session) setActiveSession({ ...session, offlineSession: false })
      log.info('[offlineSessionWatch] Sesión revalidada online')
      notifyRenderer(IPC.OFFLINE_SESSION_UPGRADED)
      snapshot.onUpgraded?.()
      stopOfflineSessionWatch()
      return
    }

    log.warn('[offlineSessionWatch] Sesión offline revocada', { outcome })
    setActiveSession(null)
    notifyRenderer(IPC.OFFLINE_SESSION_REVOKED, { reason: outcome })
    stopOfflineSessionWatch()
  } catch (err) {
    log.warn('[offlineSessionWatch] Re-verificación falló (se reintenta)', err)
  } finally {
    ticking = false
  }
}
