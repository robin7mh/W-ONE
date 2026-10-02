import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import ignore from 'ignore'
import type { FileContent, FileEntry, FileStat } from '@shared/types/files'
import { confine } from '../../lib/confine'

/** Never listed — VS Code hides these too. */
const HIDDEN = new Set(['.git', '.DS_Store', 'Thumbs.db'])
const MAX_ENTRIES = 5000
/** Larger files open in VS Code instead (Monaco stays fast below this). */
export const MAX_EDIT_BYTES = 5 * 1024 * 1024
/** A NUL byte in the first chunk marks a binary file (git's heuristic). */
const SNIFF_BYTES = 8000

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

const isMissing = (err: unknown) => (err as { code?: string }).code === 'ENOENT'

/**
 * The editor's view of a project folder: lists one directory at a time
 * (dependency folders stay cheap until opened), reads text files, and writes
 * them back. Every path is relative to the project root and confined to it.
 * A write carries the mtime the editor loaded; if the file changed on disk
 * since (another editor, an agent, git), it fails with `conflict` instead of
 * silently overwriting.
 */
export class FilesService {
  constructor(private readonly resolveRoot: (projectId: string) => string | undefined) {}

  async list(projectId: string, dir = ''): Promise<FileEntry[]> {
    const root = this.root(projectId)
    const abs = await confine(root, dir || '.')
    const ig = await this.gitignore(root)
    // Normalized posix prefix ('' at the root), whatever form `dir` came in.
    const prefix = relative(await realpath(root), abs).split(sep).join('/')
    const entries: FileEntry[] = []
    for (const d of await readdir(abs, { withFileTypes: true })) {
      if (HIDDEN.has(d.name)) continue
      const kind = await this.kindOf(d, join(abs, d.name))
      if (!kind) continue
      const path = prefix ? `${prefix}/${d.name}` : d.name
      entries.push({ name: d.name, path, kind, ignored: ig.ignores(kind === 'dir' ? `${path}/` : path) })
    }
    return entries
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'en', { numeric: true }) : a.kind === 'dir' ? -1 : 1))
      .slice(0, MAX_ENTRIES)
  }

  async read(projectId: string, path: string): Promise<FileContent> {
    const abs = await confine(this.root(projectId), path)
    const info = await stat(abs).catch((err: unknown) => {
      throw isMissing(err) ? coded('not-found', `${path} does not exist`) : err
    })
    if (!info.isFile()) throw coded('not-a-file', `${path} is not a file`)
    const meta = { path, mtimeMs: info.mtimeMs, size: info.size }
    if (info.size > MAX_EDIT_BYTES) return { ...meta, unsupported: 'too-large' }
    const buf = await readFile(abs)
    if (buf.subarray(0, SNIFF_BYTES).includes(0)) return { ...meta, unsupported: 'binary' }
    return { ...meta, content: buf.toString('utf8') }
  }

  /** mtime + size per path; null where the file is gone (or not a file). */
  async stat(projectId: string, paths: string[]): Promise<(FileStat | null)[]> {
    const root = this.root(projectId)
    return Promise.all(
      paths.map(async (path) => {
        try {
          const info = await stat(await confine(root, path))
          return info.isFile() ? { mtimeMs: info.mtimeMs, size: info.size } : null
        } catch {
          return null
        }
      })
    )
  }

  /**
   * Write `content` in place (keeps the file's mode and hard links). With
   * `expectedMtime`, refuses when the file on disk is newer than that. A file
   * deleted meanwhile is simply recreated.
   */
  async write(projectId: string, path: string, content: string, expectedMtime?: number): Promise<FileStat> {
    const abs = await confine(this.root(projectId), path)
    const current = await stat(abs).catch((err: unknown) => {
      if (isMissing(err)) return null
      throw err
    })
    if (current && !current.isFile()) throw coded('not-a-file', `${path} is not a file`)
    if (current && expectedMtime !== undefined && current.mtimeMs !== expectedMtime) {
      throw coded('conflict', `${path} changed on disk since it was opened`)
    }
    if (!current) await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
    const info = await stat(abs)
    return { mtimeMs: info.mtimeMs, size: info.size }
  }

  // --- helpers ---

  private root(projectId: string): string {
    const root = this.resolveRoot(projectId)
    if (!root) throw coded('not-found', `Unknown project: ${projectId}`)
    return root
  }

  /** Symlinks show as what they point to; dangling ones are skipped. */
  private async kindOf(d: { isDirectory(): boolean; isSymbolicLink(): boolean }, abs: string): Promise<FileEntry['kind'] | null> {
    if (!d.isSymbolicLink()) return d.isDirectory() ? 'dir' : 'file'
    const target = await stat(abs).catch(() => null)
    if (!target) return null
    return target.isDirectory() ? 'dir' : 'file'
  }

  private async gitignore(root: string): Promise<ReturnType<typeof ignore>> {
    const ig = ignore()
    try {
      ig.add(await readFile(join(root, '.gitignore'), 'utf8'))
    } catch {
      /* no .gitignore */
    }
    return ig
  }
}
