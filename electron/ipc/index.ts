import { registerAppInfoHandler } from './appInfo.handler'
import { registerHardwareStatusHandler } from './hardwareStatus.handler'
import { registerAuthHandlers } from './auth.handler'
import { registerFiscalPaymentHandlers } from './fiscalPayment.handler'
import { registerHardwareConfigHandlers } from './hardwareConfig.handler'
import type { HardwareManager } from '../hardware/hardwareManager'

export function registerAllHandlers(manager: HardwareManager): void {
  registerAppInfoHandler()
  registerHardwareStatusHandler()
  registerAuthHandlers()
  registerFiscalPaymentHandlers(manager)
  registerHardwareConfigHandlers()
}
