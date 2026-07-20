import { registerAppInfoHandler } from './appInfo.handler'
import { registerHardwareStatusHandler } from './hardwareStatus.handler'
import { registerAuthHandlers } from './auth.handler'
import { registerHardwareConfigHandlers } from './hardwareConfig.handler'
import { registerKretzPortHandlers } from './kretzPort.handler'
import { registerInitStatusHandler } from './initStatus.handler'
import { registerShiftHandlers } from './shift.handler'
import { registerSaleHandlers } from './sale.handler'
import { registerExpenseHandlers } from './expense.handler'
import { registerKretzPluHandlers } from './kretzPlu.handler'
import { registerKretzSyncHandler } from './kretzSync.handler'
import { registerProductsHandlers } from './products.handler'
import { registerCatalogAdminHandlers } from './catalogAdmin.handler'
import { registerCashiersHandlers } from './cashiers.handler'
import { registerCustomerHandlers } from './customers.handler'
import { registerDebtHandlers } from './debts.handler'
import { registerSpecialCustomersHandlers } from './specialCustomers.handler'
import { registerDevSeedHandlers } from './devSeed.handler'
import type { HardwareManager } from '../hardware/hardwareManager'

export function registerAllHandlers(manager: HardwareManager): void {
  registerInitStatusHandler()
  registerAppInfoHandler()
  registerHardwareStatusHandler()
  registerAuthHandlers()
  registerHardwareConfigHandlers()
  registerKretzPortHandlers(manager)
  registerShiftHandlers()
  registerSaleHandlers()
  registerExpenseHandlers()
  registerKretzPluHandlers(manager)
  registerKretzSyncHandler(manager)
  registerProductsHandlers()
  registerCatalogAdminHandlers()
  registerCashiersHandlers()
  registerCustomerHandlers()
  registerDebtHandlers()
  registerSpecialCustomersHandlers()

  // Herramientas de desarrollo — nunca en producción.
  if ((process.env['APP_ENV'] ?? 'dev') !== 'production') {
    registerDevSeedHandlers()
  }
}
