import type { Router } from './router'
import type { ScmService } from '../main/services/scm/ScmService'

/** Binds the scm:* contract channels (the editor's source control, quick open and search) to ScmService. */
export function registerScmIpc(router: Router, service: ScmService): void {
  router.register('scm:status', ({ projectId }) => service.status(projectId))
  router.register('scm:init', ({ projectId }) => service.init(projectId))
  router.register('scm:stage', ({ projectId, paths }) => service.stage(projectId, paths))
  router.register('scm:unstage', ({ projectId, paths }) => service.unstage(projectId, paths))
  router.register('scm:discard', ({ projectId, paths }) => service.discard(projectId, paths))
  router.register('scm:commit', ({ projectId, message, amend, all }) => service.commit(projectId, message, { amend, all }))
  router.register('scm:fetch', ({ projectId }) => service.fetch(projectId))
  router.register('scm:pull', ({ projectId }) => service.pull(projectId))
  router.register('scm:push', ({ projectId }) => service.push(projectId))
  router.register('scm:branches', ({ projectId }) => service.branches(projectId))
  router.register('scm:checkout', ({ projectId, name }) => service.checkout(projectId, name))
  router.register('scm:createBranch', ({ projectId, name }) => service.createBranch(projectId, name))
  router.register('scm:log', ({ projectId, limit }) => service.log(projectId, limit))
  router.register('scm:show', ({ projectId, hash }) => service.show(projectId, hash))
  router.register('scm:diff', ({ projectId, path, target }) => service.diff(projectId, path, target))
  router.register('scm:original', ({ projectId, path }) => service.original(projectId, path))
  router.register('scm:files', ({ projectId }) => service.files(projectId))
  router.register('scm:search', ({ projectId, query, regex, caseSensitive }) => service.search(projectId, { query, regex, caseSensitive }))
}
