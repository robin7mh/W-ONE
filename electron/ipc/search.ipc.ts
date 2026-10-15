import type { Router } from './router'
import type { SearchService } from '../main/services/search/SearchService'

/**
 * Binds the search:* contract channels (the editor's project-wide search) to
 * SearchService. A paired device's search leaves out the files its deny list
 * names (`denied`, RemoteAccess) and reports to that device only.
 */
export function registerSearchIpc(router: Router, service: SearchService, denied: (path: string) => boolean): void {
  router.register('search:start', ({ id, projectId, query }, ctx) =>
    service.start(id, projectId, query, ctx.transport === 'remote' ? { device: ctx.deviceId, hidden: denied } : undefined)
  )
  router.register('search:cancel', ({ id }, ctx) => service.cancel(id, ctx.transport === 'remote' ? (ctx.deviceId ?? '') : undefined))
}
