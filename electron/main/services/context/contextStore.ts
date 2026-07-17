import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectContext } from '@shared/types/context'

/**
 * Per-project context cache as one JSON file each. Treated as a rebuildable
 * cache (the repo is the source of truth) — this is deliberately NOT SQLite yet:
 * a native DB module isn't justified until relational/full-text queries land in
 * the Memory phase. Swapping this class for a SQLite-backed one is localized.
 */
export class ContextStore {
  private readonly dir: string
  constructor(dataDir: string) {
    this.dir = join(dataDir, 'context')
  }

  private file(projectId: string): string {
    return join(this.dir, `${projectId}.json`)
  }

  async get(projectId: string): Promise<ProjectContext | null> {
    try {
      return JSON.parse(await readFile(this.file(projectId), 'utf8')) as ProjectContext
    } catch {
      return null
    }
  }

  async save(context: ProjectContext): Promise<ProjectContext> {
    await mkdir(this.dir, { recursive: true })
    const target = this.file(context.projectId)
    const tmp = `${target}.tmp`
    await writeFile(tmp, JSON.stringify(context, null, 2), 'utf8')
    await rename(tmp, target)
    return context
  }
}
