import type { Router } from './router'
import type { MigrateService } from '../main/services/migrate/MigrateService'

/** Binds the migrate:* and editor:settings channels (moving over from VS Code / Cursor) to MigrateService. */
export function registerMigrateIpc(router: Router, service: MigrateService): void {
  router.register('migrate:scan', () => service.scan())
  router.register('migrate:apply', ({ app }) => service.apply(app))
  router.register('editor:settings', () => service.editor())
  router.register('editor:update', (patch) => service.updateEditor(patch))
}
