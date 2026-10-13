import type { Router } from './router'
import type { NotebookService } from '../main/services/notebook/NotebookService'

/** Binds the notebook:* channels (Jupyter kernels for notebooks) to NotebookService. */
export function registerNotebookIpc(router: Router, service: NotebookService): void {
  router.register('notebook:kernels', ({ projectId }) => service.kernels(projectId))
  router.register('notebook:setup', ({ projectId }) => service.setup(projectId))
  router.register('notebook:start', ({ projectId, path, kernel }) => service.start(projectId, path, kernel))
  router.register('notebook:execute', ({ projectId, path, cell, code }) => service.execute(projectId, path, cell, code))
  router.register('notebook:interrupt', ({ projectId, path }) => service.interrupt(projectId, path))
  router.register('notebook:restart', ({ projectId, path }) => service.restart(projectId, path))
  router.register('notebook:shutdown', ({ projectId, path }) => service.shutdown(projectId, path))
}
