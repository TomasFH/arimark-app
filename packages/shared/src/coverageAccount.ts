/**
 * Cuenta del resumen: ventas de las fichas, compras por fecha de ingreso
 * y el resto de los gastos. No lee filas de gastos ni pide nada a la nube.
 */
import { linePurchaseCost } from './merchIntake'

export interface CoverageFicha {
  soldTotal: number | null
  expenseTotal: number | null
  /** Null = la ficha no tiene el número. No se toma como cero. */
  providerExpenseTotal: number | null
}

export interface CoveragePurchaseLine {
  costTotal: number
  moneyRole?: 'payable' | 'informed' | 'none' | null
  mediaRes?: boolean
}

export interface CoverageIntake {
  /** Entre locales. Cuando exista, no entra en Compras ni en el aviso de precio. */
  transfer?: boolean
  lines: CoveragePurchaseLine[]
}

/** Ingreso que el resumen ya bajó. `createdAt` sirve para cortar el período. */
export interface SummaryPurchaseIntake extends CoverageIntake {
  createdAt: string
}

export interface CoverageAccount {
  /** Null = ninguna ficha de este período entra en la cuenta. */
  sales: number | null
  /** Cero es una semana sin compras. No es «sin dato». */
  purchases: number
  otherExpenses: number | null
  difference: number | null
  shiftsLeftOut: number
  /** Ingresos de media res que no suman porque no tienen precio. */
  mediaResWithoutPrice: number
}

function fichaCounts(ficha: CoverageFicha): ficha is CoverageFicha & {
  soldTotal: number
  expenseTotal: number
  providerExpenseTotal: number
} {
  return typeof ficha.soldTotal === 'number' && Number.isFinite(ficha.soldTotal)
    && typeof ficha.expenseTotal === 'number' && Number.isFinite(ficha.expenseTotal)
    && typeof ficha.providerExpenseTotal === 'number' && Number.isFinite(ficha.providerExpenseTotal)
}

function mediaResMissingPrice(intake: CoverageIntake): boolean {
  if (intake.transfer) return false
  const media = intake.lines.filter(line => line.mediaRes)
  if (media.length === 0) return false
  return media.every(line => linePurchaseCost(line) === 0)
}

export function coverageAccount(input: {
  fichas: CoverageFicha[]
  intakes: CoverageIntake[]
}): CoverageAccount {
  let sales = 0
  let otherExpenses = 0
  let included = 0
  let shiftsLeftOut = 0
  for (const ficha of input.fichas) {
    if (!fichaCounts(ficha)) {
      shiftsLeftOut += 1
      continue
    }
    included += 1
    sales += Math.round(ficha.soldTotal)
    otherExpenses += Math.round(ficha.expenseTotal) - Math.round(ficha.providerExpenseTotal)
  }

  let purchases = 0
  let mediaResWithoutPrice = 0
  for (const intake of input.intakes) {
    if (intake.transfer) continue
    for (const line of intake.lines) {
      purchases += linePurchaseCost(line)
    }
    if (mediaResMissingPrice(intake)) mediaResWithoutPrice += 1
  }

  if (included === 0) {
    return {
      sales: shiftsLeftOut > 0 ? null : 0,
      purchases,
      otherExpenses: shiftsLeftOut > 0 ? null : 0,
      difference: shiftsLeftOut > 0 ? null : 0 - purchases,
      shiftsLeftOut,
      mediaResWithoutPrice,
    }
  }

  return {
    sales,
    purchases,
    otherExpenses,
    difference: sales - purchases - otherExpenses,
    shiftsLeftOut,
    mediaResWithoutPrice,
  }
}
