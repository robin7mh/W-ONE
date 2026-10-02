import type { Router } from './router'
import type { SystemService } from '../main/services/system/SystemService'

/** Binds the system:* contract channels to SystemService. */
export function registerSystemIpc(router: Router, service: SystemService): void {
  router.register('system:subscribe', () => service.subscribe())
  router.register('system:unsubscribe', () => service.unsubscribe())
  router.register('system:snapshot', () => service.snapshot())
  router.register('system:user', () => service.user())
}
