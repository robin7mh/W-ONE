import type { Router } from './router'
import type { AgentSessionService } from '../main/services/agents/AgentSessionService'

/** Binds the agents:* contract channels (the agent cockpit) to AgentSessionService. */
export function registerAgentsIpc(router: Router, service: AgentSessionService): void {
  router.register('agents:detect', () => service.detect())
  router.register('agents:list', () => service.list())
  router.register('agents:get', ({ id }) => service.get(id))
  router.register('agents:create', (req) => service.create(req))
  router.register('agents:send', ({ id, text }) => service.send(id, text))
  router.register('agents:interrupt', ({ id }) => service.interrupt(id))
  router.register('agents:stop', ({ id }) => service.stop(id))
  router.register('agents:resume', ({ id }) => service.resume(id))
  router.register('agents:remove', ({ id }) => service.remove(id))
  router.register('agents:changes', ({ id }) => service.changes(id))
  router.register('agents:branch', ({ id }) => service.branch(id))
  router.register('agents:diff', ({ id, path }) => service.diff(id, path))
  router.register('agents:accept', ({ id }) => service.accept(id))
  router.register('agents:discard', ({ id }) => service.discard(id))
  router.register('agents:rename', ({ id, title }) => service.rename(id, title))
  router.register('agents:shell', ({ id }) => service.shell(id))
  router.register('agents:openInEditor', ({ id }) => service.openInEditor(id))
}
