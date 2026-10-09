import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath, stat } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Project } from '@shared/types/project'
import { ProjectRegistry } from './registry'
import { detectGit } from './gitDetect'
import { detectStack } from './stackDetect'
import { desktopOnly, type Platform } from '../../platform/types'
import { openInVsCode } from '../../lib/openInVsCode'

const exec = promisify(execFile)

/** GitHub Desktop's link scheme (its `github` command line tool uses the same). */
const GITHUB_DESKTOP = 'x-github-client://'

/**
 * Orchestrates the project registry, deterministic detection, and the few
 * Electron-side actions (folder picker, open in editor / GitHub Desktop). Holds no UI
 * state — the renderer talks to it exclusively through the projects:* IPC.
 */
export class ProjectService {
  constructor(
    private readonly registry: ProjectRegistry,
    private readonly platform: Platform
  ) {}

  async init(): Promise<void> {
    await this.registry.load()
  }

  list(): Project[] {
    return this.registry.all()
  }

  /** Absolute path for a project id, or undefined (used by ContextService). */
  getProjectPath(id: string): string | undefined {
    return this.registry.get(id)?.path
  }

  /** Native directory picker. Returns null if the user cancels. */
  async pickFolder(): Promise<{ path: string } | null> {
    if (!this.platform.pickFolder) throw desktopOnly('The folder picker')
    const path = await this.platform.pickFolder('Add project folder')
    return path ? { path } : null
  }

  async add(path: string): Promise<Project> {
    const canonical = await this.canonicalDir(path)
    const existing = this.registry.findByPath(canonical)
    if (existing) return this.refresh(existing.id) // idempotent: refresh instead of duplicate

    const now = new Date().toISOString()
    const [git, stack] = await Promise.all([detectGit(canonical), detectStack(canonical)])
    const project: Project = {
      id: randomUUID(),
      name: stack.packageJson?.name?.trim() || basename(canonical),
      path: canonical,
      addedAt: now,
      lastSeenAt: now,
      git,
      stack
    }
    return this.registry.upsert(project)
  }

  async remove(id: string): Promise<void> {
    await this.registry.remove(id)
  }

  /** Re-run detection for one project (Git/stack are never cached as truth). */
  async refresh(id: string): Promise<Project> {
    const project = this.requireProject(id)
    const [git, stack] = await Promise.all([detectGit(project.path), detectStack(project.path)])
    return this.registry.upsert({
      ...project,
      git,
      stack,
      name: stack.packageJson?.name?.trim() || project.name,
      lastSeenAt: new Date().toISOString()
    })
  }

  async openInEditor(id: string): Promise<void> {
    await openInVsCode(this.requireProject(id).path, this.platform)
  }

  /** Open a specific file (optionally at a line) in the editor. Path-confined. */
  async openFile(id: string, file: string, line?: number): Promise<void> {
    const project = this.requireProject(id)
    const target = resolve(project.path, file)
    // Confine: the resolved target must live inside the project root.
    const rootReal = await realpath(project.path)
    const targetReal = await realpath(target).catch(() => target)
    if (targetReal !== rootReal && !targetReal.startsWith(rootReal + sep)) {
      throw new Error('Refusing to open a file outside the project')
    }
    const arg = line && line > 0 ? `${target}:${line}` : target
    try {
      await exec('code', ['-g', arg], { windowsHide: true }) // -g = go to file:line
      return
    } catch {
      // `code` not available — reveal the file instead
    }
    await this.openPath(target)
  }

  /** GitHub Desktop's name when it is installed here, else null. */
  githubDesktop(): string | null {
    return this.platform.appForUrl?.(GITHUB_DESKTOP) || null
  }

  /** Open the project in GitHub Desktop — it adds the repo on first use. */
  async openInGitHubDesktop(id: string): Promise<void> {
    const { path } = this.requireProject(id)
    if (!this.platform.openExternal) throw desktopOnly('GitHub Desktop')
    await this.platform.openExternal(`${GITHUB_DESKTOP}openLocalRepo/${encodeURIComponent(path)}`)
  }

  // --- helpers ---

  private async openPath(path: string): Promise<void> {
    if (!this.platform.openPath) throw desktopOnly('Opening files on this machine')
    await this.platform.openPath(path)
  }

  private requireProject(id: string): Project {
    const project = this.registry.get(id)
    if (!project) throw new Error(`Unknown project: ${id}`)
    return project
  }

  /** Resolve symlinks and assert the path is an existing directory. */
  private async canonicalDir(path: string): Promise<string> {
    const canonical = await realpath(path)
    const info = await stat(canonical)
    if (!info.isDirectory()) throw new Error('Selected path is not a directory')
    return canonical
  }
}
