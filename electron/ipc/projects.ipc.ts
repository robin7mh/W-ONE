import type { Router } from './router'
import type { ProjectService } from '../main/services/projects/ProjectService'

/** Binds the projects:* contract channels to ProjectService methods. */
export function registerProjectIpc(router: Router, service: ProjectService): void {
  router.register('projects:list', () => service.list())
  router.register('projects:pickFolder', () => service.pickFolder())
  router.register('projects:add', ({ path }) => service.add(path))
  router.register('projects:remove', ({ id }) => service.remove(id))
  router.register('projects:refresh', ({ id }) => service.refresh(id))
  router.register('projects:openInEditor', ({ id }) => service.openInEditor(id))
  router.register('projects:openTerminal', ({ id }) => service.openTerminal(id))
  router.register('projects:openFile', ({ id, file, line }) => service.openFile(id, file, line))
}
