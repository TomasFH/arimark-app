/**
 * Handler de preferencias de UI (zoom, etc.).
 * Persiste en {userData}/ui-settings.json (no sensible → no safeStorage).
 * También expone funciones para que main.ts pueda aplicar el zoom inicial
 * y hookear los atajos de teclado Ctrl+=/Ctrl+-.
 */
import { ipcMain, app, BrowserWindow, type WebContents } from 'electron'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import { IPC } from './channels'
import type { IpcResult } from '../../src/types/hw-api'
import { notifyRenderer } from '../licensing/notifyRenderer'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const uiSettingsSchema = z.object({
  zoomFactor: z.number().min(0.6).max(2.0).default(1.0),
})

export type UiSettings = z.infer<typeof uiSettingsSchema>

const DEFAULTS: UiSettings = { zoomFactor: 1.0 }
const STEP = 0.1
const MIN_ZOOM = 0.6
const MAX_ZOOM = 2.0

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'ui-settings.json')
}

export function readSettings(): UiSettings {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf-8')
    return uiSettingsSchema.parse(JSON.parse(raw))
  } catch {
    return { ...DEFAULTS }
  }
}

function writeSettings(settings: UiSettings): void {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
  } catch (err) {
    log.error('[ui-settings] No se pudo guardar ui-settings.json', err)
  }
}

// ---------------------------------------------------------------------------
// Zoom helpers
// ---------------------------------------------------------------------------

function applyZoomToAll(factor: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.setZoomFactor(factor)
  }
}

/** Aplica el zoom guardado a todas las ventanas abiertas. Llamar tras ready-to-show. */
export function applyInitialZoom(): void {
  const { zoomFactor } = readSettings()
  applyZoomToAll(zoomFactor)
}

function adjustZoom(delta: number): void {
  const current = readSettings()
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round((current.zoomFactor + delta) * 100) / 100))
  if (next === current.zoomFactor) return
  const updated = { ...current, zoomFactor: next }
  writeSettings(updated)
  applyZoomToAll(next)
  notifyRenderer(IPC.UI_SETTINGS_CHANGED, updated)
}

/**
 * Hookea los atajos Ctrl+= (zoom in), Ctrl+- (zoom out) y Ctrl+0 (reset)
 * en el webContents indicado. Se llama desde main.ts tras crear la ventana.
 */
export function hookZoomShortcuts(webContents: WebContents): void {
  webContents.on('before-input-event', (event, input) => {
    if (!input.control || input.type !== 'keyDown') return

    if (input.code === 'Equal' || input.code === 'NumpadAdd') {
      event.preventDefault()
      adjustZoom(+STEP)
    } else if (input.code === 'Minus' || input.code === 'NumpadSubtract') {
      event.preventDefault()
      adjustZoom(-STEP)
    } else if (input.code === 'Digit0' || input.code === 'Numpad0') {
      event.preventDefault()
      const current = readSettings()
      if (current.zoomFactor !== DEFAULTS.zoomFactor) {
        const reset = { ...current, zoomFactor: DEFAULTS.zoomFactor }
        writeSettings(reset)
        applyZoomToAll(DEFAULTS.zoomFactor)
        notifyRenderer(IPC.UI_SETTINGS_CHANGED, reset)
      }
    }
  })
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

export function registerUiSettingsHandlers(): void {
  ipcMain.handle(IPC.GET_UI_SETTINGS, (): IpcResult<UiSettings> => {
    return { ok: true, data: readSettings() }
  })

  ipcMain.handle(IPC.SET_UI_SETTINGS, (_event, payload: unknown): IpcResult<UiSettings> => {
    const parsed = uiSettingsSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:set-ui-settings] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
    }
    writeSettings(parsed.data)
    applyZoomToAll(parsed.data.zoomFactor)
    notifyRenderer(IPC.UI_SETTINGS_CHANGED, parsed.data)
    return { ok: true, data: parsed.data }
  })
}
