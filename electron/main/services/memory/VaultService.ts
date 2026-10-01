import { dialog, shell } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, posix, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_GRAPH_STYLE,
  GRAPH_COLORS,
  type GraphStyle,
  type MemoryChanged,
  type MemoryGraph,
  type Note,
  type NoteMeta,
  type NotePath,
  type SearchHit,
  type VaultStatus
} from '@shared/types/memory'
import type { SettingsService } from '../settings/SettingsService'
import { MemoryIndex } from './MemoryIndex'
import { sanitizeTitle } from './parse'
import { FOLDER_TYPES, frontmatter, starterNotes } from './starterVault'

const MAX_NOTES = 20_000
const MAX_NOTE_BYTES = 5 * 1024 * 1024
const FLUSH_DELAY_MS = 200

/** `.obsidian`, `.trash`, `.git`, our temp files … and dependency folders. */
const ignoredSegment = (s: string) => s.startsWith('.') || s === 'node_modules'
const isNoteFile = (p: string) => /\.md$/i.test(p)

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

async function isDir(p: string): Promise<boolean> {
  return (await stat(p).catch(() => null))?.isDirectory() ?? false
}

/** All markdown files under `dir`, as POSIX paths relative to it. */
async function scan(dir: string, limit = MAX_NOTES): Promise<string[]> {
  const out: string[] = []
  const stack = ['']
  while (stack.length && out.length < limit) {
    const rel = stack.pop()!
    const entries = await readdir(join(dir, rel), { withFileTypes: true }).catch(() => [])
    for (const d of entries) {
      if (ignoredSegment(d.name)) continue
      const child = rel ? `${rel}/${d.name}` : d.name
      if (d.isDirectory()) stack.push(child) // symlinked dirs are skipped (no cycles)
      else if (d.isFile() && isNoteFile(d.name)) out.push(child)
      if (out.length >= limit) break
    }
  }
  return out
}

/**
 * The Memory module's backend: an Obsidian-compatible markdown vault
 * (architecture §11.2). Files are the source of truth — the index is rebuilt
 * from them, and external edits (e.g. in Obsidian) are picked up by a
 * recursive watcher and pushed to the renderer via `onChange`. Every path from
 * the renderer is vault-relative and confined to the vault root.
 */
export class VaultService {
  private readonly index = new MemoryIndex()
  private indexedRoot?: string
  private indexing?: Promise<void>
  private watcher?: FSWatcher
  private pending = new Set<string>()
  private fullRescan = false
  private flushTimer?: NodeJS.Timeout
  private flushing: Promise<void> = Promise.resolve()

  constructor(
    private readonly opts: {
      settings: SettingsService
      defaultRoot: string
      onChange: (change: MemoryChanged) => void
    }
  ) {}

  async status(): Promise<VaultStatus> {
    await this.ensureIndexed()
    const root = this.root()
    const isDefault = !this.opts.settings.get().vaultRoot
    return {
      root,
      defaultRoot: this.opts.defaultRoot,
      name: isDefault ? 'W-ONE' : basename(root),
      isDefault,
      exists: await isDir(root),
      noteCount: this.index.size,
      graphStyle: this.graphStyle()
    }
  }

  /** Creates the default vault (with starter notes if it is new) and selects it. */
  async createVault(): Promise<VaultStatus> {
    const root = this.opts.defaultRoot
    await mkdir(root, { recursive: true })
    if ((await scan(root, 1)).length === 0) {
      for (const note of starterNotes()) {
        const abs = join(root, ...note.path.split('/'))
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, note.content, { encoding: 'utf8', flag: 'wx' }).catch(() => {})
      }
    }
    await this.opts.settings.update({ vaultRoot: undefined })
    return this.switched()
  }

  /** Native folder picker — e.g. an existing Obsidian vault. Null on cancel. */
  async pickVault(): Promise<VaultStatus | null> {
    const res = await dialog.showOpenDialog({
      title: 'Choose a vault folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const chosen = await realpath(res.filePaths[0])
    const isDefault = resolve(chosen) === resolve(this.opts.defaultRoot)
    await this.opts.settings.update({ vaultRoot: isDefault ? undefined : chosen })
    return this.switched()
  }

  async list(): Promise<NoteMeta[]> {
    await this.ensureIndexed()
    return this.index.list()
  }

  async read(path: string): Promise<Note> {
    await this.ensureIndexed()
    const rel = this.normalize(path)
    if (!this.index.has(rel)) await this.load(this.root(), rel)
    const e = this.index.get(rel)
    if (!e) throw coded('not-found', `Note not found: ${rel}`)
    return {
      ...e.meta,
      raw: e.raw,
      body: e.body,
      frontmatter: e.frontmatter,
      backlinks: e.backlinks,
      links: e.resolved
    }
  }

  async write(path: string, raw: string): Promise<NoteMeta> {
    await this.ensureIndexed()
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_NOTE_BYTES) {
      throw coded('too-large', 'Note exceeds 5 MB')
    }
    const rel = this.normalize(path)
    const abs = await this.confine(rel)
    await this.atomicWrite(abs, raw)
    this.index.upsert(rel, raw, new Date())
    this.opts.onChange({ paths: [rel] })
    return this.index.get(rel)!.meta
  }

  /** New note named after `title` (Obsidian: filename = title), never overwriting. */
  async create(title: string, folder = ''): Promise<NoteMeta> {
    await this.ensureIndexed()
    const root = this.root()
    await mkdir(root, { recursive: true })
    const dir = folder
      .split(/[\\/]/)
      .map((s) => s.trim())
      .filter((s) => s && s !== '.' && s !== '..')
      .map(sanitizeTitle)
      .join('/')
    const base = sanitizeTitle(title)
    const top = dir.split('/')[0]

    for (let n = 1; n < 1000; n += 1) {
      const rel = this.normalize(`${dir ? `${dir}/` : ''}${n === 1 ? base : `${base} ${n}`}.md`)
      if (this.index.has(rel)) continue
      const abs = await this.confine(rel, true)
      const raw = frontmatter({ type: FOLDER_TYPES[top] }) + '\n'
      try {
        await writeFile(abs, raw, { encoding: 'utf8', flag: 'wx' })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw err
      }
      this.index.upsert(rel, raw, new Date())
      if (this.indexedRoot !== root) await this.switched()
      else this.opts.onChange({ paths: [rel] })
      return this.index.get(rel)!.meta
    }
    throw coded('exists', `Too many notes named "${base}"`)
  }

  /** Moves the note to the OS trash (recoverable), never a hard delete. */
  async trash(path: string): Promise<void> {
    await this.ensureIndexed()
    const rel = this.normalize(path)
    await shell.trashItem(await this.confine(rel))
    this.index.remove(rel)
    this.opts.onChange({ paths: [rel] })
  }

  async graph(): Promise<MemoryGraph> {
    await this.ensureIndexed()
    return this.index.graph()
  }

  async search(query: string): Promise<SearchHit[]> {
    await this.ensureIndexed()
    return this.index.search(String(query ?? ''))
  }

  async setGraphStyle(style: GraphStyle): Promise<GraphStyle> {
    const valid =
      (style?.mode === 'colorful' || style?.mode === 'single') &&
      (GRAPH_COLORS as readonly string[]).includes(style?.color)
    if (!valid) throw coded('bad-style', 'Invalid graph style')
    await this.opts.settings.update({ graphStyle: { mode: style.mode, color: style.color } })
    return this.graphStyle()
  }

  dispose(): void {
    this.stopWatching()
    if (this.flushTimer) clearTimeout(this.flushTimer)
  }

  // --- internals -----------------------------------------------------------

  private root(): string {
    return this.opts.settings.get().vaultRoot ?? this.opts.defaultRoot
  }

  private graphStyle(): GraphStyle {
    return this.opts.settings.get().graphStyle ?? DEFAULT_GRAPH_STYLE
  }

  private async switched(): Promise<VaultStatus> {
    this.indexedRoot = undefined
    await this.ensureIndexed()
    this.opts.onChange({})
    return this.status()
  }

  private ensureIndexed(): Promise<void> {
    const root = this.root()
    if (this.indexedRoot === root && this.indexing) return this.indexing
    this.indexedRoot = root
    this.indexing = this.reindex(root)
    return this.indexing
  }

  private async reindex(root: string): Promise<void> {
    this.stopWatching()
    this.index.clear()
    if (!(await isDir(root))) {
      this.indexedRoot = undefined // vault not created yet — check again next call
      return
    }
    const files = await scan(root)
    for (let i = 0; i < files.length; i += 64) {
      await Promise.all(files.slice(i, i + 64).map((rel) => this.load(root, rel)))
    }
    this.startWatching(root)
  }

  /** (Re)parse one file. Returns true if the index actually changed. */
  private async load(root: string, rel: NotePath): Promise<boolean> {
    try {
      const abs = join(root, ...rel.split('/'))
      const [raw, st] = await Promise.all([readFile(abs, 'utf8'), stat(abs)])
      if (st.size > MAX_NOTE_BYTES) return this.index.remove(rel)
      if (this.index.rawOf(rel) === raw) return false
      this.index.upsert(rel, raw, st.mtime)
      return true
    } catch {
      return this.index.remove(rel)
    }
  }

  private normalize(path: string): NotePath {
    const rel = posix.normalize(String(path ?? '').replace(/\\/g, '/')).replace(/^\/+/, '')
    const segments = rel.split('/')
    if (
      !rel ||
      !isNoteFile(rel) ||
      segments.some((s) => s === '..' || s === '' || ignoredSegment(s)) ||
      (process.platform === 'win32' && rel.includes(':'))
    ) {
      throw coded('bad-path', `Invalid note path: ${path}`)
    }
    return rel
  }

  /** Absolute path for a normalized note path, guaranteed inside the vault. */
  private async confine(rel: NotePath, createParent = false): Promise<string> {
    const root = this.root()
    const abs = resolve(root, ...rel.split('/'))
    if (!abs.startsWith(resolve(root) + sep)) throw coded('bad-path', 'Path escapes the vault')
    if (createParent) await mkdir(dirname(abs), { recursive: true })
    const [rootReal, parentReal] = await Promise.all([realpath(root), realpath(dirname(abs))]).catch(() => {
      throw coded('not-found', `Folder not found for ${rel}`)
    })
    if (parentReal !== rootReal && !parentReal.startsWith(rootReal + sep)) {
      throw coded('bad-path', 'Path escapes the vault')
    }
    return abs
  }

  private async atomicWrite(abs: string, raw: string): Promise<void> {
    const tmp = join(dirname(abs), `.${basename(abs)}.${randomUUID().slice(0, 8)}.tmp`)
    await writeFile(tmp, raw, 'utf8')
    await rename(tmp, abs)
  }

  private startWatching(root: string): void {
    try {
      this.watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (filename == null) this.fullRescan = true
        else this.pending.add(String(filename).split(sep).join('/'))
        if (this.flushTimer) clearTimeout(this.flushTimer)
        this.flushTimer = setTimeout(() => {
          this.flushing = this.flushing.then(() => this.flush(root)).catch(() => {})
        }, FLUSH_DELAY_MS)
      })
      this.watcher.on('error', () => this.stopWatching())
    } catch (err) {
      console.warn('[memory] vault watcher unavailable — external edits need a reopen', err)
    }
  }

  private stopWatching(): void {
    this.watcher?.close()
    this.watcher = undefined
    this.pending.clear()
    this.fullRescan = false
  }

  private async flush(root: string): Promise<void> {
    if (this.indexedRoot !== root) return
    if (this.fullRescan) {
      await this.switched()
      return
    }
    const changed: NotePath[] = []
    const paths = [...this.pending]
    this.pending.clear()
    for (const rel of paths) {
      if (!rel || rel.split('/').some(ignoredSegment)) continue
      const abs = join(root, ...rel.split('/'))
      const st = await stat(abs).catch(() => null)
      if (st?.isDirectory()) {
        for (const f of await scan(abs)) {
          if (await this.load(root, `${rel}/${f}`)) changed.push(`${rel}/${f}`)
        }
      } else if (st?.isFile()) {
        if (isNoteFile(rel) && (await this.load(root, rel))) changed.push(rel)
      } else if (this.index.remove(rel)) {
        changed.push(rel)
      }
    }
    if (changed.length) this.opts.onChange({ paths: changed })
  }
}
