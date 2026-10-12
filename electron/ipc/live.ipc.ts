import type { Router } from './router'
import type { LiveServerService } from '../main/services/live/LiveServerService'
import type { SassService } from '../main/services/live/SassService'

/** Binds the liveServer:* and sass:* channels (Live Server, Live Sass Compiler). */
export function registerLiveIpc(router: Router, live: LiveServerService, sass: SassService): void {
  router.register('liveServer:status', () => live.status())
  router.register('liveServer:start', ({ projectId, page }) => live.start(projectId, page))
  router.register('liveServer:stop', ({ projectId }) => live.stop(projectId))
  router.register('sass:compile', ({ projectId, path }) => sass.compile(projectId, path))
  router.register('sass:compileAll', ({ projectId }) => sass.compileAll(projectId))
}
