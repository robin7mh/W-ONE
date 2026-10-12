import type { Router } from './router'
import type { RemoteService } from '../main/services/remote/RemoteService'

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** Binds the remote:* channels (Remote-SSH, Dev Containers) to RemoteService. */
export function registerRemoteIpc(router: Router, service: RemoteService, resolveRoot: (projectId: string) => string | undefined): void {
  const root = (projectId: string) => {
    const path = resolveRoot(projectId)
    if (!path) throw coded('not-found', `Unknown project: ${projectId}`)
    return path
  }
  router.register('remote:hosts', () => service.hosts())
  router.register('remote:list', () => service.list())
  router.register('remote:ssh', ({ target }) => service.ssh(target))
  router.register('remote:container', ({ projectId }) => service.container(root(projectId)))
  router.register('remote:hasContainer', ({ projectId }) => service.hasContainer(root(projectId)))
  router.register('remote:disconnect', ({ id }) => service.disconnect(id))
}
