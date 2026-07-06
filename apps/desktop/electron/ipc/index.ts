import { registerAppInfoHandler } from './appInfo.handler'
import { registerHardwareStatusHandler } from './hardwareStatus.handler'
import { registerAuthHandlers } from './auth.handler'
import { registerHardwareConfigHandlers } from './hardwareConfig.handler'
import { registerInitStatusHandler } from './initStatus.handler'
import { registerShiftHandlers } from './shift.handler'
import { registerSaleHandlers } from './sale.handler'
import { registerKretzPluHandlers } from './kretzPlu.handler'
import { registerProductsHandlers } from './products.handler'
import { registerCatalogAdminHandlers } from './catalogAdmin.handler'
import type { HardwareManager } from '../hardware/hardwareManager'

export function registerAllHandlers(manager: HardwareManager): void {
  registerInitStatusHandler()
  registerAppInfoHandler()
  registerHardwareStatusHandler()
  registerAuthHandlers()
  registerHardwareConfigHandlers()
  registerShiftHandlers()
  registerSaleHandlers()
  registerKretzPluHandlers(manager)
  registerProductsHandlers()
  registerCatalogAdminHandlers()
}
