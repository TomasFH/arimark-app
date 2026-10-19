import { addDaysYmd } from './datetime'

/** Cada consulta a la nube trae como máximo este tramo, incluidos ambos extremos. */
export const HISTORY_CHUNK_DAYS = 14

export interface HistorySpan {
  from: string
  to: string
}

export type HistoryFetchPlan =
  | { kind: 'none' }
  | { kind: 'replace'; from: string; to: string }
  | { kind: 'extend'; from: string; to: string }

function later(a: string, b: string): string {
  return a > b ? a : b
}

function earlier(a: string, b: string): string {
  return a < b ? a : b
}

/** Desde y hasta no pueden ser posteriores a hoy. Desde no puede quedar después de hasta. */
export function clampHistoryRange(from: string, to: string, today: string): HistorySpan {
  const toC = !to || to > today ? today : to
  let fromC = !from || from > today ? today : from
  if (fromC > toC) fromC = toC
  return { from: fromC, to: toC }
}

function newestChunk(from: string, to: string): HistorySpan {
  return { from: later(from, addDaysYmd(to, -(HISTORY_CHUNK_DAYS - 1))), to }
}

/**
 * Una sola consulta por acción.
 * Si el rango pedido ya está cargado, no se pide nada.
 * Si se agranda hacia atrás o hacia adelante, se pide solo el tramo que falta, de a 14 días.
 * Un salto a otro año no reutiliza lo cargado y empieza por los 14 días más nuevos de ese rango.
 */
export function planHistoryFetch(
  requestedFrom: string,
  requestedTo: string,
  loaded: HistorySpan | null,
  prefer: 'auto' | 'older' | 'newer' = 'auto',
): HistoryFetchPlan {
  if (!loaded) return { kind: 'replace', ...newestChunk(requestedFrom, requestedTo) }

  const disjoint = requestedTo < addDaysYmd(loaded.from, -1)
    || requestedFrom > addDaysYmd(loaded.to, 1)
  if (disjoint) return { kind: 'replace', ...newestChunk(requestedFrom, requestedTo) }

  const older = requestedFrom < loaded.from
    ? {
        from: later(requestedFrom, addDaysYmd(loaded.from, -HISTORY_CHUNK_DAYS)),
        to: addDaysYmd(loaded.from, -1),
      }
    : null
  const newer = requestedTo > loaded.to
    ? {
        from: addDaysYmd(loaded.to, 1),
        to: earlier(requestedTo, addDaysYmd(loaded.to, HISTORY_CHUNK_DAYS)),
      }
    : null

  const chosen = prefer === 'older' ? older : prefer === 'newer' ? newer : (older ?? newer)
  if (!chosen || chosen.from > chosen.to) return { kind: 'none' }
  return { kind: 'extend', ...chosen }
}
