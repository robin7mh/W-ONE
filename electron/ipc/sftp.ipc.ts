import type { Router } from './router'
import type { SftpService } from '../main/services/sftp/SftpService'

/** Binds the sftp:* channels (.vscode/sftp.json, like the VS Code extension) to SftpService. */
export function registerSftpIpc(router: Router, service: SftpService): void {
  router.register('sftp:targets', ({ projectId }) => service.targets(projectId))
  router.register('sftp:list', ({ projectId, target, dir }) => service.list(projectId, target, dir))
  router.register('sftp:upload', ({ projectId, target, paths }) => service.upload(projectId, target, paths))
  router.register('sftp:download', ({ projectId, target, paths }) => service.download(projectId, target, paths))
  router.register('sftp:sync', ({ projectId, target, direction }) => service.sync(projectId, target, direction))
}
