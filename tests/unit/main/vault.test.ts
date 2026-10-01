import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tempDir, tick } from './helpers'

// --- doubles -------------------------------------------------------------------
const h = vi.hoisted(() => ({
  dialog: vi.fn(),
  openPath: vi.fn(async () => ''),
  watchers: [] as { root: string; cb: (event: string, filename: string | null) => void; emitter: EventEmitter & { close: () => void } }[],
  watchThrows: false
}))
vi.mock('electron', () => ({
  dialog: { showOpenDialog: h.dialog },
  shell: {
    trashItem: async (p: string) => (await import('node:fs/promises')).rm(p, { recursive: true }),
    openPath: h.openPath
  }
}))
vi.mock('node:fs', async (orig) => ({
  ...(await orig<typeof import('node:fs')>()),
  watch: (root: string, _opts: unknown, cb: (e: string, f: string | null) => void) => {
    if (h.watchThrows) throw new Error('EMFILE')
    const emitter = Object.assign(new EventEmitter(), { close: vi.fn() })
    h.watchers.push({ root, cb, emitter })
    return emitter
  }
}))

import { VaultService } from '../../../electron/main/services/memory/VaultService'
import { SettingsService } from '../../../electron/main/services/settings/SettingsService'

const FLUSH = 260 // > the service's 200 ms debounce

async function setup(opts: { create?: boolean } = { create: true }) {
  const base = await tempDir()
  const settings = new SettingsService(join(base, 'settings.json'))
  await settings.init()
  const onChange = vi.fn()
  const v = new VaultService({ settings, defaultRoot: join(base, 'vault'), onChange })
  if (opts.create) await v.createVault()
  const root = join(base, 'vault')
  return { base, root, settings, onChange, v, read: (p: string) => readFile(join(root, p), 'utf8') }
}
const lastWatcher = () => h.watchers[h.watchers.length - 1]
const fire = (filename: string | null) => lastWatcher().cb('rename', filename === null ? null : filename.split('/').join(sep))

beforeEach(() => {
  h.watchers.length = 0
  h.watchThrows = false
})
afterEach(() => vi.restoreAllMocks())

describe('VaultService — vault lifecycle', () => {
  it('reports a missing vault, then creates the default one with starter notes', async () => {
    const { v, onChange } = await setup({ create: false })
    expect(await v.status()).toMatchObject({ exists: false, isDefault: true, name: 'W-ONE', noteCount: 0, graphStyle: { mode: 'colorful' } })
    expect(await v.list()).toEqual([])
    expect(await v.folders()).toEqual([])
    const st = await v.createVault()
    expect(st).toMatchObject({ exists: true, noteCount: 6 })
    expect(onChange).toHaveBeenCalledWith({})
    expect(await v.status()).toMatchObject({ noteCount: 6 }) // cached index
  })

  it('does not seed a vault that already has notes, and survives a blocked starter path', async () => {
    const a = await setup({ create: false })
    await mkdir(a.root, { recursive: true })
    await writeFile(join(a.root, 'Mine.md'), 'mine')
    expect((await a.v.createVault()).noteCount).toBe(1)

    const b = await setup({ create: false })
    await mkdir(join(b.root, 'Willkommen.md'), { recursive: true }) // a folder where a starter note goes
    expect((await b.v.createVault()).noteCount).toBe(5)
  })

  it('picks another vault (or the default) via the dialog; cancel keeps the current', async () => {
    const { v, base, root } = await setup()
    h.dialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await v.pickVault()).toBeNull()
    h.dialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
    expect(await v.pickVault()).toBeNull()

    const other = join(base, 'Obsidian Vault')
    await mkdir(other)
    await writeFile(join(other, 'Note.md'), 'x')
    await mkdir(join(other, '.obsidian'))
    await writeFile(join(other, '.obsidian', 'Hidden.md'), 'ignored')
    await mkdir(join(other, 'node_modules'))
    h.dialog.mockResolvedValueOnce({ canceled: false, filePaths: [other] })
    expect(await v.pickVault()).toMatchObject({ name: 'Obsidian Vault', isDefault: false, noteCount: 1 })

    h.dialog.mockResolvedValueOnce({ canceled: false, filePaths: [root] })
    expect(await v.pickVault()).toMatchObject({ name: 'W-ONE', isDefault: true, noteCount: 6 })
  })

  it('reveals the vault folder, reporting missing folders and OS errors', async () => {
    const missing = await setup({ create: false })
    await expect(missing.v.reveal()).rejects.toMatchObject({ code: 'not-found' })
    const { v, root } = await setup()
    await v.reveal()
    expect(h.openPath).toHaveBeenCalledWith(root)
    h.openPath.mockResolvedValueOnce('no app')
    await expect(v.reveal()).rejects.toMatchObject({ code: 'open-failed', message: 'no app' })
  })

  it('stores a valid graph style and rejects invalid ones', async () => {
    const { v } = await setup()
    expect(await v.setGraphStyle({ mode: 'single', color: 'pink' })).toEqual({ mode: 'single', color: 'pink' })
    expect((await v.status()).graphStyle).toEqual({ mode: 'single', color: 'pink' })
    for (const bad of [{ mode: 'x', color: 'pink' }, { mode: 'single', color: 'x' }, null]) {
      await expect(v.setGraphStyle(bad as never)).rejects.toMatchObject({ code: 'bad-style' })
    }
  })
})

describe('VaultService — notes', () => {
  it('reads notes (also ones not indexed yet) and rejects unknown ones', async () => {
    const { v, root } = await setup()
    expect((await v.read('Willkommen.md')).links['Über mich']).toBe('Ich/Über mich.md')
    await writeFile(join(root, 'Fresh.md'), 'fresh [[Willkommen]]')
    expect((await v.read('Fresh.md')).body).toBe('fresh [[Willkommen]]')
    await expect(v.read('Nope.md')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('writes atomically, refusing oversized or non-string content', async () => {
    const { v, read, onChange } = await setup()
    expect((await v.write('Willkommen.md', 'new')).title).toBe('Willkommen')
    expect(await read('Willkommen.md')).toBe('new')
    expect(onChange).toHaveBeenLastCalledWith({ paths: ['Willkommen.md'] })
    await expect(v.write('Willkommen.md', 'x'.repeat(5 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: 'too-large' })
    await expect(v.write('Willkommen.md', 5 as never)).rejects.toMatchObject({ code: 'too-large' })
    await expect(v.write('Missing/Note.md', 'x')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('writeBody keeps the frontmatter block byte-for-byte (also for unindexed files)', async () => {
    const { v, read, root } = await setup()
    const before = await read('Ich/Über mich.md')
    await v.writeBody('Ich/Über mich.md', 'Neu.\n')
    expect(await read('Ich/Über mich.md')).toBe(before.slice(0, before.indexOf('---\n', 4) + 4) + 'Neu.\n')
    await writeFile(join(root, 'Plain.md'), 'no fm')
    await v.writeBody('Plain.md', 'replaced')
    expect(await read('Plain.md')).toBe('replaced')
    await expect(v.writeBody('Plain.md', 1 as never)).rejects.toMatchObject({ code: 'bad-input' })
  })

  it('creates notes named after the title, typed by folder, never overwriting', async () => {
    const { v, root, read } = await setup()
    const a = await v.create('Idee: neu?', ' ./Projekte/../Projekte\\Sub/. ')
    expect(a.path).toBe('Projekte/Projekte/Sub/Idee neu.md')
    expect(a.type).toBe('project')
    expect((await read(a.path)).endsWith('---\n')).toBe(true) // empty body

    expect((await v.create('Willkommen')).path).toBe('Willkommen 2.md') // indexed name taken
    await writeFile(join(root, 'Taken.md'), 'external, not indexed yet')
    expect((await v.create('Taken')).path).toBe('Taken 2.md') // EEXIST on disk
    await mkdir(join(root, 'Dir.md')) // a folder where the file would go → EEXIST → next name
    expect((await v.create('Dir')).path).toBe('Dir 2.md')
    await mkdir(join(root, 'Locked'))
    await chmod(join(root, 'Locked'), 0o555)
    await expect(v.create('X', 'Locked')).rejects.toMatchObject({ code: 'EACCES' }) // other errors surface
    await chmod(join(root, 'Locked'), 0o755)
    expect((await v.create('Free')).type).toBeUndefined()
  })

  it('gives up after 999 attempts on the same title', async () => {
    const { v } = await setup()
    const index = (v as unknown as { index: { upsert(p: string, r: string, d: Date): void } }).index
    index.upsert('Busy.md', '', new Date())
    for (let n = 2; n < 1000; n += 1) index.upsert(`Busy ${n}.md`, '', new Date())
    await expect(v.create('Busy')).rejects.toMatchObject({ code: 'exists' })
  })

  it('creating the first note also creates and indexes the vault', async () => {
    const { v, onChange } = await setup({ create: false })
    expect((await v.create('First')).path).toBe('First.md')
    expect(onChange).toHaveBeenCalledWith({})
    expect((await v.status()).noteCount).toBe(1)
  })

  it('trashes notes, searches and builds the graph', async () => {
    const { v, root } = await setup()
    await v.trash('Ich/Vorlieben.md')
    expect(existsSync(join(root, 'Ich/Vorlieben.md'))).toBe(false)
    expect((await v.list()).some((n) => n.path === 'Ich/Vorlieben.md')).toBe(false)
    expect((await v.search('gatekeeper'))[0].path).toBe('Entscheidungen/2026-10-01 Electron 37.md')
    expect(await v.search(undefined as never)).toEqual([])
    expect((await v.graph()).nodes.some((n) => n.ghost && n.title === 'Vorlieben')).toBe(true)
  })

  it('validates paths: no escapes, hidden folders, non-notes or drive letters', async () => {
    const { v, root, base } = await setup()
    await expect(v.read('a//b.md')).rejects.toMatchObject({ code: 'not-found' }) // '//' collapses → a valid path
    for (const bad of [undefined, '', '../x.md', '.obsidian/x.md', 'x.txt', 'Ich/../../x.md']) {
      await expect(v.read(bad as never)).rejects.toMatchObject({ code: 'bad-path' })
    }
    expect((await v.read('/Willkommen.md')).path).toBe('Willkommen.md') // leading slash = vault-relative

    const realPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      await expect(v.read('C:x.md')).rejects.toMatchObject({ code: 'bad-path' })
      await expect(v.move('Willkommen.md', 'C:evil')).rejects.toMatchObject({ code: 'bad-path' })
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform })
    }

    const outside = join(base, 'outside')
    await mkdir(outside)
    await symlink(outside, join(root, 'escape'))
    await expect(v.write('escape/x.md', 'no')).rejects.toMatchObject({ code: 'bad-path' })
  })
})

describe('VaultService — folders, renames, moves, links', () => {
  it('lists folders (empty ones too) and creates folders safely', async () => {
    const { v } = await setup()
    expect(await v.createFolder('', 'Archiv')).toBe('Archiv')
    expect(await v.createFolder('Archiv', '2026')).toBe('Archiv/2026')
    expect(await v.folders()).toEqual(['Archiv', 'Archiv/2026', 'Entscheidungen', 'Ich', 'Projekte'])
    await expect(v.createFolder('', 'Archiv')).rejects.toMatchObject({ code: 'exists' })
    expect(await v.createFolder('', '.hidden')).toBe('hidden')
    await expect(v.createFolder('../out', 'x')).rejects.toMatchObject({ code: 'bad-path' })
    expect(await v.createFolder('.', 'Dot')).toBe('Dot')
  })

  it('renames notes and rewrites links elsewhere (name- and path-style), incl. case-only', async () => {
    const { v, read, root } = await setup()
    await writeFile(join(root, 'Pathy.md'), 'see [[Projekte/W-ONE]] and [doc](Projekte/W-ONE.md) and [[W-ONE#Ziele|alias]] and [[Nowhere]]')
    await v.status() // index Pathy via full scan is not needed: write through the service instead
    await v.write('Pathy.md', await read('Pathy.md'))

    const meta = await v.rename('Projekte/W-ONE.md', 'W-ONE App')
    expect(meta.path).toBe('Projekte/W-ONE App.md')
    expect(await read('Pathy.md')).toBe('see [[Projekte/W-ONE App]] and [doc](Projekte/W-ONE%20App.md) and [[W-ONE App#Ziele|alias]] and [[Nowhere]]')
    expect((await v.rename('Pathy.md', 'Pathy Renamed')).path).toBe('Pathy Renamed.md') // a root-level note
    expect(await read('Willkommen.md')).toContain('[[W-ONE App]]')

    expect((await v.rename('Projekte/W-ONE App.md', 'W-ONE App')).path).toBe('Projekte/W-ONE App.md') // no-op
    expect((await v.rename('Ich/Vorlieben.md', 'vorlieben')).path).toBe('Ich/vorlieben.md') // case only
    await expect(v.rename('Ich/vorlieben.md', 'Über mich')).rejects.toMatchObject({ code: 'exists' })
    await expect(v.rename('Ghost.md', 'x')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('moves notes between folders; name-style links keep resolving', async () => {
    const { v, root } = await setup()
    expect((await v.move('Willkommen.md', '')).path).toBe('Willkommen.md') // same folder: no-op
    expect((await v.move('Willkommen.md', undefined as never)).path).toBe('Willkommen.md') // missing = root
    const moved = await v.move('Entscheidungen/2026-10-01 Electron 37.md', 'Ich')
    expect(moved.path).toBe('Ich/2026-10-01 Electron 37.md')
    expect(existsSync(join(root, 'Ich/2026-10-01 Electron 37.md'))).toBe(true)
    expect((await v.read('Projekte/W-ONE.md')).links['2026-10-01 Electron 37']).toBe('Ich/2026-10-01 Electron 37.md')
  })

  it('moves whole folders, refusing the root, self-nesting and collisions', async () => {
    const { v, root } = await setup()
    await expect(v.moveFolder('', 'Ich')).rejects.toMatchObject({ code: 'bad-path' })
    await expect(v.moveFolder('Ich', 'Ich')).rejects.toMatchObject({ code: 'bad-move' })
    await v.createFolder('Ich', 'Inner')
    await expect(v.moveFolder('Ich', 'Ich/Inner')).rejects.toMatchObject({ code: 'bad-move' })
    expect(await v.moveFolder('Ich', '')).toBe('Ich') // already at the root

    expect(await v.moveFolder('Ich', 'Projekte')).toBe('Projekte/Ich')
    expect(existsSync(join(root, 'Projekte/Ich/Über mich.md'))).toBe(true)
    expect((await v.list()).some((n) => n.path === 'Projekte/Ich/Vorlieben.md')).toBe(true)

    await v.createFolder('', 'Ich')
    await expect(v.moveFolder('Ich', 'Projekte')).rejects.toMatchObject({ code: 'exists' })
  })

  it('links and unlinks notes', async () => {
    const { v, read } = await setup()
    await expect(v.link('Willkommen.md', 'Willkommen.md')).rejects.toMatchObject({ code: 'bad-link' })
    const before = await read('Willkommen.md')
    await v.link('Willkommen.md', 'Ich/Über mich.md') // already linked
    expect(await read('Willkommen.md')).toBe(before)

    await v.link('Ich/Über mich.md', 'Entscheidungen/2026-10-01 Ruhigere Oberfläche.md')
    expect(await read('Ich/Über mich.md')).toContain('## Verbindungen\n- [[2026-10-01 Ruhigere Oberfläche]]')

    await v.create('Über mich', 'Projekte') // makes the name ambiguous → link by path
    await v.link('Willkommen.md', 'Projekte/Über mich.md')
    expect(await read('Willkommen.md')).toContain('- [[Projekte/Über mich]]')

    await v.unlink('Ich/Über mich.md', 'Entscheidungen/2026-10-01 Ruhigere Oberfläche.md')
    expect(await read('Ich/Über mich.md')).not.toContain('Ruhigere')
    const same = await read('Ich/Über mich.md')
    await v.unlink('Ich/Über mich.md', 'Projekte/W-ONE.md') // nothing to remove
    expect(await read('Ich/Über mich.md')).toBe(same)
  })
})

describe('VaultService — watcher', () => {
  it('picks up new, changed, deleted and moved-in files; ignores noise', async () => {
    const { v, root, onChange } = await setup()
    onChange.mockClear()
    await writeFile(join(root, 'External.md'), 'from obsidian')
    await mkdir(join(root, 'New/Deep'), { recursive: true })
    await writeFile(join(root, 'New/Deep/In.md'), 'x')
    await writeFile(join(root, 'notes.txt'), 'not a note')
    await rm(join(root, 'Ich/Vorlieben.md'))
    for (const f of ['External.md', 'New', 'notes.txt', '.obsidian/workspace.json', 'Ich/Vorlieben.md', 'Gone-before.md', '']) fire(f)
    await tick(FLUSH)
    expect(onChange).toHaveBeenCalledWith({ paths: ['External.md', 'New/Deep/In.md', 'Ich/Vorlieben.md'] })
    expect((await v.read('New/Deep/In.md')).body).toBe('x')

    onChange.mockClear()
    fire('External.md') // unchanged content → no event
    await tick(FLUSH)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('drops oversized files from the index', async () => {
    const { v, root } = await setup()
    await writeFile(join(root, 'Willkommen.md'), 'x'.repeat(5 * 1024 * 1024 + 10))
    fire('Willkommen.md')
    await tick(FLUSH)
    expect((await v.list()).some((n) => n.path === 'Willkommen.md')).toBe(false)
  })

  it('does a full rescan when the OS gives no filename', async () => {
    const { root, onChange } = await setup()
    await writeFile(join(root, 'Silent.md'), 'x')
    onChange.mockClear()
    fire(null)
    await tick(FLUSH)
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('ignores flushes for a vault that was switched away, and survives flush errors', async () => {
    const { v, base, onChange, root } = await setup()
    const oldWatcher = lastWatcher()
    const other = join(base, 'other')
    await mkdir(other)
    h.dialog.mockResolvedValueOnce({ canceled: false, filePaths: [other] })
    await v.pickVault()
    onChange.mockClear()
    oldWatcher.cb('change', 'Willkommen.md')
    await tick(FLUSH)
    expect(onChange).not.toHaveBeenCalled()

    h.dialog.mockResolvedValueOnce({ canceled: false, filePaths: [root] })
    await v.pickVault()
    onChange.mockImplementation(() => {
      throw new Error('renderer gone')
    })
    await writeFile(join(root, 'Boom.md'), 'x')
    fire('Boom.md')
    fire('Boom.md') // debounced into one flush
    await tick(FLUSH)
    onChange.mockReset()
    await writeFile(join(root, 'After.md'), 'y')
    fire('After.md')
    await tick(FLUSH)
    expect(onChange).toHaveBeenCalledWith({ paths: ['After.md'] }) // the chain kept working
  })

  it('stops watching on watcher errors and works without a watcher', async () => {
    const { v } = await setup()
    lastWatcher().emitter.emit('error', new Error('gone'))
    expect(lastWatcher().emitter.close).toHaveBeenCalled()
    v.dispose()

    h.watchThrows = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const second = await setup()
    expect(warn).toHaveBeenCalled()
    expect((await second.v.status()).exists).toBe(true)
    second.v.dispose()
  })

  it('dispose clears a pending flush', async () => {
    const { v, onChange, root } = await setup()
    onChange.mockClear()
    await writeFile(join(root, 'Late.md'), 'x')
    fire('Late.md')
    v.dispose()
    await tick(FLUSH)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('VaultService — picking before the default vault exists', () => {
  it('compares against the unresolved default path', async () => {
    const { v, base } = await setup({ create: false })
    const other = join(base, 'elsewhere')
    await mkdir(other)
    h.dialog.mockResolvedValueOnce({ canceled: false, filePaths: [other] })
    expect(await v.pickVault()).toMatchObject({ isDefault: false, name: 'elsewhere', noteCount: 0 })
  })
})
