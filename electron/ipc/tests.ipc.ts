import type { Router } from './router'
import type { TestService } from '../main/services/tests/TestService'

/** Binds the tests:* channels (the test explorer) to TestService. */
export function registerTestsIpc(router: Router, service: TestService): void {
  router.register('tests:discover', ({ projectId }) => service.discover(projectId))
  router.register('tests:state', ({ projectId }) => service.state(projectId))
  router.register('tests:run', ({ projectId, id }) => service.run(projectId, id))
  router.register('tests:cancel', ({ projectId }) => service.cancel(projectId))
  router.register('tests:debug', ({ projectId, id, breakpoints }) => service.debug(projectId, id, breakpoints))
}
