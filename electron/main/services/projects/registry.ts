import { join } from 'node:path'
import type { Project } from '@shared/types/project'
import { readJson } from '../../lib/jsonFile'
import { writeAtomic } from '../../lib/writeAtomic'

/**
 * Persistent project list backed by a single JSON file. Electron-agnostic: the
 * data directory is injected, so it is fully unit-testable against a temp dir.
 * Writes are atomic and one at a time (see writeAtomic).
 */
export class ProjectRegistry {
  private readonly file: string
  private projects: Project[] = []
  private loaded = false

  constructor(dataDir: string) {
    this.file = join(dataDir, 'projects.json')
  }

  async load(): Promise<void> {
    if (this.loaded) return
    // Missing/damaged file → start empty (a damaged one is set aside, see readJson).
    const parsed = await readJson<{ projects?: Project[] }>(this.file)
    this.projects = Array.isArray(parsed?.projects) ? parsed.projects : []
    this.loaded = true
  }

  all(): Project[] {
    return [...this.projects]
  }

  get(id: string): Project | undefined {
    return this.projects.find((p) => p.id === id)
  }

  findByPath(path: string): Project | undefined {
    return this.projects.find((p) => p.path === path)
  }

  async upsert(project: Project): Promise<Project> {
    const idx = this.projects.findIndex((p) => p.id === project.id)
    if (idx >= 0) this.projects[idx] = project
    else this.projects.push(project)
    await this.persist()
    return project
  }

  async remove(id: string): Promise<void> {
    this.projects = this.projects.filter((p) => p.id !== id)
    await this.persist()
  }

  private persist(): Promise<void> {
    return writeAtomic(this.file, JSON.stringify({ version: 1, projects: this.projects }, null, 2))
  }
}
