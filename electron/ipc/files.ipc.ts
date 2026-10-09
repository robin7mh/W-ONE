import type { Router } from './router'
import type { FilesService } from '../main/services/files/FilesService'

/** Binds the files:* contract channels (the editor) to FilesService. */
export function registerFilesIpc(router: Router, service: FilesService): void {
  router.register('files:list', ({ projectId, dir }) => service.list(projectId, dir))
  router.register('files:read', ({ projectId, path }) => service.read(projectId, path))
  router.register('files:stat', ({ projectId, paths }) => service.stat(projectId, paths))
  router.register('files:write', ({ projectId, path, content, expectedMtime }) =>
    service.write(projectId, path, content, expectedMtime)
  )
}
