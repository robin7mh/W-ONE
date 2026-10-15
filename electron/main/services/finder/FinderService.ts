import { execFile } from 'node:child_process'
import type { Dirent } from 'node:fs'
import { cp, lstat, mkdir, open, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileType, type FinderEntry, type FinderListing, type FinderPlaceId, type FinderPlaces, type FinderPreview } from '@shared/types/finder'

/** Entries listed per folder (a folder with more says so). */
const MAX_ENTRIES = 5000
const MAX_RESULTS = 300
/** The beginning of a text file the preview shows. */
const PREVIEW_BYTES = 256 * 1024
/** Folders the fallback search walks at most, and how long. */
const SEARCH_DIRS = 20_000
const SEARCH_MS = 4000
const SKIP_DIRS = new Set(['node_modules', '.git', '.Trash', 'Library', '.cache', '.npm', '__pycache__', '.venv'])
/** macOS system partitions that show up in /Volumes — Finder hides them too. */
const SYSTEM_VOLUMES = new Set(['Recovery', 'Preboot', 'VM', 'Update', 'xarts', 'iSCPreboot', 'Hardware'])

/** macOS packages: folders that Finder shows and opens as one file. */
const BUNDLES = new Set(['.app', '.bundle', '.framework', '.plugin', '.kext', '.prefpane', '.photoslibrary', '.musiclibrary', '.xcodeproj', '.xcworkspace', '.pages', '.numbers', '.key', '.rtfd', '.playground'])

const PLACES: { id: Exclude<FinderPlaceId, 'home'>; dir: string; alt?: string }[] = [
  { id: 'desktop', dir: 'Desktop' },
  { id: 'documents', dir: 'Documents' },
  { id: 'downloads', dir: 'Downloads' },
  { id: 'pictures', dir: 'Pictures' },
  { id: 'movies', dir: 'Movies', alt: 'Videos' },
  { id: 'music', dir: 'Music' }
]

export interface FinderDeps {
  home?: string
  /** Where Mindeck may change files (default: Home and external drives). */
  writableRoots?: string[]
  /** Writable too: Mindeck's own folder, wherever MINDECK_HOME puts it. */
  alsoWritable?: string[]
  /** Where external drives are mounted (default per OS). */
  volumeDirs?: string[]
  openPath?: (path: string) => Promise<void>
  revealPath?: (path: string) => void
  trash: (path: string) => Promise<void>
  /** Spotlight: paths under `dir` whose name matches `query`. Absent where there is none. */
  spotlight?: (dir: string, query: string) => Promise<string[]>
}

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** macOS Spotlight by file name, through `mdfind` (structured arguments, no shell). */
export function macSpotlight(dir: string, query: string): Promise<string[]> {
  return new Promise((resolveSearch, reject) => {
    execFile('mdfind', ['-onlyin', dir, '-name', query], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err)
      else resolveSearch(stdout.split('\n').filter(Boolean))
    })
  })
}

/** Default places drives show up in. */
function defaultVolumeDirs(home: string): string[] {
  if (process.platform === 'darwin') return ['/Volumes']
  if (process.platform === 'linux') return [join('/media', basename(home)), join('/run/media', basename(home)), '/mnt']
  return []
}

/** A file or folder name the user typed: one name, nothing that walks the tree. */
export function checkName(name: string): string {
  const n = name.trim()
  if (!n || n === '.' || n === '..' || /[/\\\0]/.test(n) || Buffer.byteLength(n) > 255) {
    throw coded('bad-name', `Not a valid name: ${name}`)
  }
  return n
}

/** `name 2.ext`, `name 3.ext`, … — the first that does not exist in `dir`. */
export async function freeName(dir: string, name: string): Promise<string> {
  const exists = (p: string) => lstat(p).then(() => true, () => false)
  if (!(await exists(join(dir, name)))) return join(dir, name)
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let i = 2
  while (await exists(join(dir, `${stem} ${i}${ext}`))) i += 1
  return join(dir, `${stem} ${i}${ext}`)
}

/**
 * The machine's files, like Finder (architecture §12.9): folders, places,
 * search, previews, and the everyday changes — new folder, rename, move, copy,
 * trash. Reading works anywhere the user can read; changes only inside Home
 * and on external drives, and deleting only ever moves to the trash.
 */
export class FinderService {
  private readonly home: string
  private readonly roots: string[]

  constructor(private readonly deps: FinderDeps) {
    this.home = deps.home ?? homedir()
    this.roots = [...(deps.writableRoots ?? [this.home, ...defaultVolumeDirs(this.home)]), ...(deps.alsoWritable ?? [])]
  }

  async places(): Promise<FinderPlaces> {
    const places: FinderPlaces['places'] = [{ id: 'home', path: this.home }]
    for (const p of PLACES) {
      for (const dir of [p.dir, p.alt]) {
        const path = dir && join(this.home, dir)
        if (path && (await isDir(path))) {
          places.push({ id: p.id, path })
          break
        }
      }
    }
    const volumes: FinderPlaces['volumes'] = []
    for (const base of this.deps.volumeDirs ?? defaultVolumeDirs(this.home)) {
      const names = await readdir(base).catch(() => [] as string[])
      for (const name of names.filter((n) => !n.startsWith('.') && !SYSTEM_VOLUMES.has(n)).sort((a, b) => a.localeCompare(b))) {
        const path = join(base, name)
        // macOS lists the startup disk too, as a link to "/" — it is not an external drive.
        if ((await realpath(path).catch(() => '/')) !== '/' && (await isDir(path))) volumes.push({ name, path })
      }
    }
    return { home: this.home, places, volumes }
  }

  async list(path?: string, hidden = false): Promise<FinderListing> {
    const dir = this.absolute(path ?? this.home)
    if (!(await isDir(dir))) throw coded('not-found', `Folder not found: ${dir}`)
    const dirents = await readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
      throw coded(err.code === 'EACCES' || err.code === 'EPERM' ? 'no-access' : 'error', `Cannot read ${dir}: ${err.message}`)
    })
    const shown = dirents.filter((d) => hidden || !d.name.startsWith('.'))
    const entries = await entriesOf(dir, shown.slice(0, MAX_ENTRIES))
    entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.kind === 'dir' ? -1 : 1))
    const parent = dirname(dir)
    return { path: dir, parent: parent === dir ? null : parent, entries, truncated: shown.length > MAX_ENTRIES }
  }

  /** Files and folders under `path` whose name contains `query` — Spotlight where there is one, else a bounded walk. */
  async search(path: string, query: string): Promise<FinderEntry[]> {
    const dir = this.absolute(path)
    const q = query.trim().toLowerCase()
    if (!q) return []
    if (this.deps.spotlight) {
      const prefix = dir.endsWith(sep) ? dir : dir + sep
      const found = await this.deps.spotlight(dir, query.trim()).then(
        (paths) => paths.filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).split(sep).some((s) => s.startsWith('.'))),
        () => [] // Spotlight off or indexing
      )
      // Nothing may only mean the folder isn't indexed (excluded from Spotlight, a network drive): walk then.
      if (found.length) return (await Promise.all(found.slice(0, MAX_RESULTS).map((p) => entryAt(p)))).filter((e): e is FinderEntry => !!e)
    }
    return this.walk(dir, q)
  }

  async preview(path: string): Promise<FinderPreview> {
    const abs = this.absolute(path)
    const entry = await entryAt(abs)
    if (!entry) throw coded('not-found', `Not found: ${abs}`)
    if (entry.bundle) return { entry, type: 'binary' }
    if (entry.kind === 'dir') {
      const items = (await readdir(abs).catch(() => [] as string[])).filter((n) => !n.startsWith('.')).length
      return { entry, type: 'dir', items }
    }
    const type = fileType(entry.name)
    if (type !== 'text' && type !== 'binary') return { entry, type }
    const head = await readHead(abs, PREVIEW_BYTES)
    // A NUL byte early on means binary, whatever the name says; an unknown name counts as text when it reads like text.
    if (head.subarray(0, 8192).includes(0) || (type === 'binary' && !looksLikeText(head))) return { entry, type: 'binary' }
    return { entry, type: 'text', text: head.toString('utf8'), truncated: entry.size > PREVIEW_BYTES }
  }

  async mkdir(parent: string, name: string): Promise<string> {
    const target = join(this.absolute(parent), checkName(name))
    await this.assertWritable(target)
    await mkdir(target).catch((err: NodeJS.ErrnoException) => {
      throw coded(err.code === 'EEXIST' ? 'exists' : 'error', err.code === 'EEXIST' ? `“${basename(target)}” already exists` : err.message)
    })
    return target
  }

  async rename(path: string, name: string): Promise<string> {
    const from = this.absolute(path)
    const to = join(dirname(from), checkName(name))
    if (to === from) return from
    await this.assertWritable(from)
    // On case-insensitive disks "a" → "A" finds "a" itself: only a different file blocks.
    if (to.toLowerCase() !== from.toLowerCase() && (await lstat(to).then(() => true, () => false))) {
      throw coded('exists', `“${basename(to)}” already exists`)
    }
    await rename(from, to)
    return to
  }

  async trash(paths: string[]): Promise<void> {
    const targets = paths.map((p) => this.absolute(p))
    for (const t of targets) await this.assertWritable(t)
    for (const t of targets) await this.deps.trash(t)
  }

  /** Into `dest`; a name that is taken there gets a number (nothing is replaced). */
  async move(paths: string[], dest: string): Promise<string[]> {
    const into = await this.destination(dest)
    const moved: string[] = []
    for (const p of paths.map((x) => this.absolute(x))) {
      await this.assertWritable(p)
      this.assertNotInside(into, p)
      if (dirname(p) === into) {
        moved.push(p)
        continue
      }
      const target = await freeName(into, basename(p))
      await rename(p, target).catch(async (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EXDEV') throw err
        // Another disk: copy, then remove the original.
        await cp(p, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
        await rm(p, { recursive: true, force: true })
      })
      moved.push(target)
    }
    return moved
  }

  async copy(paths: string[], dest: string): Promise<string[]> {
    const into = await this.destination(dest)
    const copied: string[] = []
    for (const p of paths.map((x) => this.absolute(x))) {
      this.assertNotInside(into, p)
      const target = await freeName(into, basename(p))
      await cp(p, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
      copied.push(target)
    }
    return copied
  }

  async open(path: string): Promise<void> {
    if (!this.deps.openPath) throw coded('desktop-only', 'Opening files is only available in the Mindeck desktop app')
    await this.deps.openPath(this.absolute(path))
  }

  reveal(path: string): void {
    if (!this.deps.revealPath) throw coded('desktop-only', 'Showing files is only available in the Mindeck desktop app')
    this.deps.revealPath(this.absolute(path))
  }

  private absolute(path: string): string {
    if (!isAbsolute(path)) throw coded('bad-path', 'Path must be absolute')
    return resolve(path)
  }

  /** Only inside Home and on external drives — never the system, never a root itself. */
  private async assertWritable(target: string): Promise<void> {
    const parent = await realpath(dirname(target)).catch(() => {
      throw coded('not-found', `Folder not found: ${dirname(target)}`)
    })
    const roots = await Promise.all(this.roots.map((r) => realpath(r).catch(() => r)))
    const inside = roots.some((r) => parent === r || parent.startsWith(r + sep))
    if (!inside || roots.includes(target)) throw coded('read-only', 'Mindeck only changes files in your home folder and on external drives')
  }

  private assertNotInside(dest: string, source: string): void {
    if (dest === source || dest.startsWith(source + sep)) throw coded('bad-move', 'A folder cannot go into itself')
  }

  private async destination(dest: string): Promise<string> {
    const into = this.absolute(dest)
    if (!(await isDir(into))) throw coded('not-found', `Folder not found: ${into}`)
    await this.assertWritable(join(into, '.probe'))
    return into
  }

  private async walk(root: string, q: string): Promise<FinderEntry[]> {
    const found: FinderEntry[] = []
    const queue = [root]
    const started = Date.now()
    let dirs = 0
    while (queue.length && found.length < MAX_RESULTS && dirs < SEARCH_DIRS && Date.now() - started < SEARCH_MS) {
      const dir = queue.shift()!
      dirs += 1
      const dirents = await readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[])
      const hits: Dirent[] = []
      for (const d of dirents) {
        if (d.name.startsWith('.')) continue
        if (d.name.toLowerCase().includes(q)) hits.push(d)
        if (d.isDirectory() && !SKIP_DIRS.has(d.name) && !BUNDLES.has(extname(d.name).toLowerCase())) queue.push(join(dir, d.name))
      }
      found.push(...(await entriesOf(dir, hits)))
    }
    return found.slice(0, MAX_RESULTS)
  }
}

async function isDir(path: string): Promise<boolean> {
  return stat(path).then((s) => s.isDirectory(), () => false)
}

/** Entries for names in `dir`, in batches (thousands of stats at once would stall the disk). */
async function entriesOf(dir: string, dirents: Dirent[]): Promise<FinderEntry[]> {
  const out: FinderEntry[] = []
  for (let i = 0; i < dirents.length; i += 64) {
    const batch = await Promise.all(dirents.slice(i, i + 64).map((d) => entryAt(join(dir, d.name), d.isSymbolicLink())))
    out.push(...batch.filter((e): e is FinderEntry => !!e))
  }
  return out
}

/** One entry; a broken link shows as the (empty) file it is. Null when it vanished. */
async function entryAt(path: string, link?: boolean): Promise<FinderEntry | null> {
  const info = await stat(path).catch(() => lstat(path).catch(() => null))
  if (!info) return null
  const name = basename(path)
  const isLink = link ?? (await lstat(path).then((l) => l.isSymbolicLink(), () => false))
  const dir = info.isDirectory()
  const bundle = dir && BUNDLES.has(extname(name).toLowerCase())
  return {
    name,
    path,
    kind: dir ? 'dir' : 'file',
    size: dir ? 0 : info.size,
    mtimeMs: info.mtimeMs,
    hidden: name.startsWith('.'),
    ...(isLink ? { link: true } : {}),
    ...(bundle ? { bundle: true } : {})
  }
}

async function readHead(path: string, bytes: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Mostly printable UTF-8 — a config file without a known extension, say. */
function looksLikeText(head: Buffer): boolean {
  const sample = head.subarray(0, 4096).toString('utf8')
  if (!sample) return true
  const odd = [...sample].filter((c) => c === '�' || (c < ' ' && !'\n\r\t\f'.includes(c))).length
  return odd / sample.length < 0.02
}
