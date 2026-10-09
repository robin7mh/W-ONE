import type { Router } from './router'
import type { ContextService } from '../main/services/context/ContextService'

/** Binds the context:* contract channels to ContextService. */
export function registerContextIpc(router: Router, service: ContextService): void {
  router.register('context:get', ({ projectId }) => service.get(projectId))
  router.register('context:reindex', ({ projectId }) => service.reindex(projectId))
}
