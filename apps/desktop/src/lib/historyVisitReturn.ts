/**
 * Estado del historial mientras se abre «Ver visita».
 * Al volver se restaura. Entrar desde el hub no lo usa.
 */
export type HistoryDetailTab = 'sales' | 'expenses' | 'injects' | 'debts' | 'deposits' | 'vales'

export interface HistoryVisitReturnState {
  fromDate: string
  toDate: string
  storeIdFilter: string
  selectedShiftId: string | null
  activeTab: HistoryDetailTab
  openExpenseId: string | null
}

let saved: HistoryVisitReturnState | null = null

export function rememberHistoryVisitReturn(state: HistoryVisitReturnState): void {
  saved = state
}

export function readHistoryVisitReturn(): HistoryVisitReturnState | null {
  return saved
}

export function clearHistoryVisitReturn(): void {
  saved = null
}
