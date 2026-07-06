import { dialog, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Project } from '@shared/types/project'
import { ProjectRegistry } from './registry'
import { detectGit } from './gitDetect'
import { detectStack } from './stackDetect'

const exec = promisify(execFile)

/**
 * Orchestrates the project registry, deterministic detection, and the few
 * Electron-side actions (folder picker, open in editor/terminal). Holds no UI
 * state — the renderer talks to it exclusively through the projects:* IPC.
 */
export class ProjectService {
  constructor(private readonly registry: ProjectRegistry) {}

  async init(): Promise<void> {
    await this.registry.load()
  }

  list(): Project[] {
    return this.registry.all()
  }

  /** Native directory picker. Returns null if the user cancels. */
  async pickFolder(): Promise<{ path: string } | null> {
    const res = await dialog.showOpenDialog({
      title: 'Add project folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return { path: res.filePaths[0] }
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
    const { path } = this.requireProject(id)
    try {
      await exec('code', [path], { windowsHide: true })
      return
    } catch {
      // `code` not on PATH — fall back per platform
    }
    if (process.platform === 'darwin') {
      try {
        await exec('open', ['-a', 'Visual Studio Code', path])
        return
      } catch {
        /* VS Code not installed — reveal in Finder as last resort */
      }
    }
    const err = await shell.openPath(path)
    if (err) throw new Error(err)
  }

  async openTerminal(id: string): Promise<void> {
    const { path } = this.requireProject(id)
    if (process.platform === 'darwin') {
      await exec('open', ['-a', 'Terminal', path])
    } else if (process.platform === 'win32') {
      // Windows Terminal if present, else classic console — both start in `path`
      try {
        await exec('wt', ['-d', path], { windowsHide: true })
      } catch {
        await exec('cmd', ['/c', 'start', 'cmd'], { cwd: path, windowsHide: true })
      }
    } else {
      // Linux: try common emulators
      const candidates: [string, string[]][] = [
        ['x-terminal-emulator', []],
        ['gnome-terminal', []],
        ['konsole', []]
      ]
      let opened = false
      for (const [bin, args] of candidates) {
        try {
          await exec(bin, args, { cwd: path })
          opened = true
          break
        } catch {
          /* try next */
        }
      }
      if (!opened) throw new Error('No terminal emulator found')
    }
  }

  // --- helpers ---

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
