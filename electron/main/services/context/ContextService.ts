import type { ProjectContext, ContextProgress } from '@shared/types/context'
import { detectStack } from '../projects/stackDetect'
import { detectGit } from '../projects/gitDetect'
import { scanProject } from './scan'
import { buildTree, detectConfigFiles, parseDependencies, scanTodos, parseReadme } from './analyzers'
import { ContextStore } from './contextStore'

export interface ContextServiceDeps {
  store: ContextStore
  /** Resolve a project id to its absolute path (from ProjectService). */
  resolvePath: (projectId: string) => string | undefined
  /** Emit indexing progress to the renderer. */
  onProgress?: (progress: ContextProgress) => void
}

/**
 * Builds a deterministic structural understanding of a project — no LLM. Runs a
 * single bounded, ignore-aware scan, then derives structure/config/TODOs from
 * it and reuses the Phase-1 stack/git detectors. Results are cached; the repo
 * remains the source of truth (reindex any time).
 */
export class ContextService {
  constructor(private readonly deps: ContextServiceDeps) {}

  get(projectId: string): Promise<ProjectContext | null> {
    return this.deps.store.get(projectId)
  }

  async reindex(projectId: string): Promise<ProjectContext> {
    const root = this.deps.resolvePath(projectId)
    if (!root) throw new Error(`Unknown project: ${projectId}`)

    const scan = await scanProject(root, {
      onProgress: (filesScanned) =>
        this.deps.onProgress?.({ projectId, filesScanned, done: false })
    })

    const [stack, git, dependencies, todos, readme] = await Promise.all([
      detectStack(root),
      detectGit(root),
      parseDependencies(root),
      scanTodos(scan),
      parseReadme(root, scan)
    ])

    const context: ProjectContext = {
      projectId,
      indexedAt: new Date().toISOString(),
      fileCount: scan.fileCount,
      dirCount: scan.dirCount,
      truncated: scan.truncated,
      tree: buildTree(scan),
      languages: stack.languages,
      frameworks: stack.frameworks,
      dependencies,
      configFiles: detectConfigFiles(scan),
      todos,
      readme,
      packageJson: stack.packageJson,
      gitCommit: git.lastCommit?.hash
    }

    await this.deps.store.save(context)
    this.deps.onProgress?.({ projectId, filesScanned: scan.fileCount, done: true })
    return context
  }
}
