import type { Router } from './router'
import type { DebugService } from '../main/services/debug/DebugService'

/** Binds the debug:* contract channels (the editor's Run & Debug) to DebugService. */
export function registerDebugIpc(router: Router, service: DebugService): void {
  router.register('debug:start', (req) => service.start(req))
  router.register('debug:stop', () => service.stop())
  router.register('debug:session', () => service.session())
  router.register('debug:control', ({ action }) => service.control(action))
  router.register('debug:setBreakpoints', ({ projectId, breakpoints }) => service.setBreakpoints(projectId, breakpoints))
  router.register('debug:variables', ({ objectId }) => service.variables(objectId))
  router.register('debug:evaluate', ({ expression, frameId }) => service.evaluate(expression, frameId))
}
