import { handle } from './registry'
import type { ContextService } from '../main/services/context/ContextService'

/** Binds the context:* contract channels to ContextService. */
export function registerContextIpc(service: ContextService): void {
  handle('context:get', ({ projectId }) => service.get(projectId))
  handle('context:reindex', ({ projectId }) => service.reindex(projectId))
}
