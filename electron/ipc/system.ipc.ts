import { handle } from './registry'
import type { SystemService } from '../main/services/system/SystemService'

/** Binds the system:* contract channels to SystemService. */
export function registerSystemIpc(service: SystemService): void {
  handle('system:subscribe', () => service.subscribe())
  handle('system:unsubscribe', () => service.unsubscribe())
  handle('system:snapshot', () => service.snapshot())
  handle('system:user', () => service.user())
}
