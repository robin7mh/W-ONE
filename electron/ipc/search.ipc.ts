import type { Router } from './router'
import type { SearchService } from '../main/services/search/SearchService'

/** Binds the search:* contract channels (the editor's project-wide search) to SearchService. */
export function registerSearchIpc(router: Router, service: SearchService): void {
  router.register('search:start', ({ id, projectId, query }) => service.start(id, projectId, query))
  router.register('search:cancel', ({ id }) => service.cancel(id))
}
