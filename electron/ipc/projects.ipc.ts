import { handle } from './registry'
import type { ProjectService } from '../main/services/projects/ProjectService'

/** Binds the projects:* contract channels to ProjectService methods. */
export function registerProjectIpc(service: ProjectService): void {
  handle('projects:list', () => service.list())
  handle('projects:pickFolder', () => service.pickFolder())
  handle('projects:add', ({ path }) => service.add(path))
  handle('projects:remove', ({ id }) => service.remove(id))
  handle('projects:refresh', ({ id }) => service.refresh(id))
  handle('projects:openInEditor', ({ id }) => service.openInEditor(id))
  handle('projects:openTerminal', ({ id }) => service.openTerminal(id))
}
