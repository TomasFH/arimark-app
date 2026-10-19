import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { eq } from 'drizzle-orm'
import { roundPieceKg } from '@carniceria/shared'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { productPieceWeights, products } from '../db/schema'
import { getActiveSession } from '../activeSession'
import type { IpcResult, PieceWeightRow } from '../../src/types/hw-api'

const setSchema = z.object({
  items: z.array(z.object({
    productId: z.string().min(1),
    kgPerUnit: z.number().finite().positive().max(500),
  })).max(50),
})

export function registerPieceWeightHandlers(): void {
  ipcMain.handle(IPC.GET_PIECE_WEIGHTS, async (): Promise<IpcResult<PieceWeightRow[]>> => {
    if (!getActiveSession()) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    try {
      const rows = getDb().select().from(productPieceWeights).all()
      return {
        ok: true,
        data: rows.map(row => ({ productId: row.productId, kgPerUnit: row.kgPerUnit })),
      }
    } catch (err) {
      log.error('[ipc:get-piece-weights] Error', err)
      return { ok: false, error: 'No se pudieron leer los pesos de referencia.' }
    }
  })

  ipcMain.handle(IPC.SET_PIECE_WEIGHTS, async (_event, payload: unknown): Promise<IpcResult<{ saved: number }>> => {
    const parsed = setSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:set-piece-weights] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }
    if (!getActiveSession()) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    const now = new Date().toISOString()
    try {
      const db = getDb()
      db.transaction(tx => {
        for (const item of parsed.data.items) {
          const product = tx.select({ id: products.id }).from(products).where(eq(products.id, item.productId)).get()
          if (!product) throw new Error(`MISSING:${item.productId}`)
          const kgPerUnit = roundPieceKg(item.kgPerUnit)
          tx.insert(productPieceWeights).values({
            productId: item.productId,
            kgPerUnit,
            updatedAt: now,
          }).onConflictDoUpdate({
            target: productPieceWeights.productId,
            set: { kgPerUnit, updatedAt: now },
          }).run()
        }
      })
      return { ok: true, data: { saved: parsed.data.items.length } }
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.startsWith('MISSING:')) {
        return { ok: false, error: 'El producto no está en el catálogo.', code: 'NOT_FOUND' }
      }
      log.error('[ipc:set-piece-weights] Error', err)
      return { ok: false, error: 'No se pudo guardar el peso de referencia.' }
    }
  })
}
