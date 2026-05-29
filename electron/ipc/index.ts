import { registerAppInfoHandler } from './appInfo.handler'
import { registerHardwareStatusHandler } from './hardwareStatus.handler'
import { registerAuthHandlers } from './auth.handler'

export function registerAllHandlers(): void {
  registerAppInfoHandler()
  registerHardwareStatusHandler()
  registerAuthHandlers()
}
