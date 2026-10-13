import type { Router } from './router'
import type { LintService } from '../main/services/lint/LintService'

/** Binds lint:* and format:document (ESLint and Prettier from the project) to LintService. */
export function registerLintIpc(router: Router, service: LintService): void {
  router.register('lint:file', ({ projectId, path, text }) => service.lint(projectId, path, text))
  router.register('lint:fix', ({ projectId, path, text }) => service.fix(projectId, path, text))
  router.register('lint:restart', () => service.restart())
  router.register('format:document', ({ projectId, path, text, prettier, options }) => service.format(projectId, path, text, { prettier, options }))
}
