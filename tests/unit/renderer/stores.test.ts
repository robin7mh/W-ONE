import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, installBridge, settle } from './bridge'

import { useProjects, useSelectedProject } from '@/features/projects/store'
import { useContextStore, useProjectContextEntry } from '@/features/context/store'
import { LAYOUT_GRID, tabLabels, useTerminals } from '@/features/terminal/store'
import { folderColors, useMemory } from '@/features/memory/store'
import { useSystemMetrics } from '@/features/system/useSystemMetrics'
import type { Note, NoteMeta } from '@shared/types/memory'
import type { TerminalInfo } from '@shared/types/terminal'

const project = (id: string) => ({ id, name: id, path: `/p/${id}`, addedAt: '', lastSeenAt: '' })
const initial = {
  projects: useProjects.getState(),
  context: useContextStore.getState(),
  terminals: useTerminals.getState(),
  memory: useMemory.getState()
}
beforeEach(() => {
  useProjects.setState(initial.projects, true)
  useContextStore.setState(initial.context, true)
  useTerminals.setState(initial.terminals, true)
  useMemory.setState(initial.memory, true)
})
afterEach(() => vi.useRealTimers())

// --- projects ------------------------------------------------------------------
describe('projects store', () => {
  it('loads (selecting the first), adds via picker, refreshes, removes', async () => {
    let list = [project('a'), project('b')]
    installBridge({
      'projects:list': () => list,
      'projects:pickFolder': () => ({ path: '/new' }),
      'projects:add': () => project('c'),
      'projects:refresh': ({ id }: { id: string }) => ({ ...project(id), name: 'fresh' }),
      'projects:remove': () => undefined,
      'projects:openInEditor': () => undefined,
      'projects:openInGitHubDesktop': () => undefined,
      'projects:githubDesktop': () => 'GitHub Desktop'
    })
    const s = useProjects.getState()
    await s.load()
    expect(useProjects.getState()).toMatchObject({ loading: false, selectedId: 'a', githubDesktop: 'GitHub Desktop' })
    await s.load() // keeps the selection
    list = []
    useProjects.setState({ selectedId: undefined })
    await s.load()
    expect(useProjects.getState().selectedId).toBeUndefined()
    list = [project('a'), project('b')]
    await s.load()

    await s.addViaPicker()
    expect(useProjects.getState()).toMatchObject({ selectedId: 'c' })
    expect(useProjects.getState().projects.map((p) => p.id)).toEqual(['a', 'b', 'c'])

    await s.refresh('b')
    expect(useProjects.getState().projects.find((p) => p.id === 'b')!.name).toBe('fresh')

    s.select('b')
    await s.remove('b')
    expect(useProjects.getState().selectedId).toBe('a')
    await s.remove('c') // not selected → selection kept
    expect(useProjects.getState().selectedId).toBe('a')
    await s.openEditor('a')
    await s.openInGitHubDesktop('a')
    expect(useProjects.getState().error).toBeUndefined()
  })

  it('keeps the list when the picker is cancelled and reports every failure', async () => {
    installBridge({ 'projects:pickFolder': () => null })
    await useProjects.getState().addViaPicker()
    expect(useProjects.getState().projects).toEqual([])

    installBridge(
      Object.fromEntries(
        ['projects:list', 'projects:pickFolder', 'projects:remove', 'projects:refresh', 'projects:openInEditor', 'projects:openInGitHubDesktop'].map(
          (ch) => [ch, () => fail(`${ch} failed`)]
        )
      )
    )
    const s = useProjects.getState()
    for (const [run, ch] of [
      [() => s.load(), 'projects:list'],
      [() => s.addViaPicker(), 'projects:pickFolder'],
      [() => s.remove('x'), 'projects:remove'],
      [() => s.refresh('x'), 'projects:refresh'],
      [() => s.openEditor('x'), 'projects:openInEditor'],
      [() => s.openInGitHubDesktop('x'), 'projects:openInGitHubDesktop']
    ] as const) {
      await run()
      expect(useProjects.getState().error).toBe(`${ch} failed`)
    }
  })

  it('useSelectedProject follows the selection', () => {
    useProjects.setState({ projects: [project('a'), project('b')], selectedId: 'b' })
    expect(renderHook(() => useSelectedProject()).result.current?.id).toBe('b')
  })
})

// --- context -------------------------------------------------------------------
describe('context store', () => {
  it('loads cached context and reindexes with progress for its own project only', async () => {
    let finish: (v: unknown) => void = () => {}
    const bridge = installBridge({
      'context:get': () => ({ projectId: 'p', fileCount: 1 }),
      'context:reindex': () => new Promise((r) => (finish = r))
    })
    const s = useContextStore.getState()
    await s.load('p')
    expect(useContextStore.getState().byProject.p).toMatchObject({ loading: false, context: { fileCount: 1 } })

    const done = s.reindex('p')
    await settle()
    bridge.emit('context:progress', { projectId: 'other', filesScanned: 9, done: false })
    bridge.emit('context:progress', { projectId: 'p', filesScanned: 5, done: false })
    expect(useContextStore.getState().byProject.p.progress).toMatchObject({ filesScanned: 5 })
    finish({ projectId: 'p', fileCount: 2 })
    await done
    expect(useContextStore.getState().byProject.p).toMatchObject({ indexing: false, progress: undefined, context: { fileCount: 2 } })
    expect(bridge.listenerCount('context:progress')).toBe(0)
  })

  it('reports failures and exposes a stable default entry', async () => {
    installBridge({ 'context:get': () => fail('no cache'), 'context:reindex': () => fail('no repo') })
    await useContextStore.getState().load('p')
    expect(useContextStore.getState().byProject.p.error).toBe('no cache')
    await useContextStore.getState().reindex('p')
    expect(useContextStore.getState().byProject.p).toMatchObject({ indexing: false, error: 'no repo' })
    expect(renderHook(() => useProjectContextEntry('unknown')).result.current).toEqual({ loading: false, indexing: false })
  })
})

// --- terminals -----------------------------------------------------------------
describe('terminal store', () => {
  let n = 0
  const info = (extra: Partial<TerminalInfo> = {}): TerminalInfo => ({
    id: `t${++n}`,
    title: '~',
    cwd: '/h',
    cwdLabel: '~',
    shell: 'zsh',
    createdAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`,
    ...extra
  })

  it('init re-attaches surviving sessions, else opens one; only once', async () => {
    const existing = [info(), info()]
    installBridge({ 'terminal:list': () => existing })
    await useTerminals.getState().init()
    expect(useTerminals.getState()).toMatchObject({ initialized: true, activeId: existing[0].id })
    await useTerminals.getState().init() // no second run
    expect(useTerminals.getState().tabs).toHaveLength(2)

    useTerminals.setState(initial.terminals, true)
    const created = info()
    installBridge({ 'terminal:list': () => [], 'terminal:create': () => created })
    await useTerminals.getState().init()
    expect(useTerminals.getState().activeId).toBe(created.id)

    useTerminals.setState(initial.terminals, true)
    installBridge({ 'terminal:list': () => fail('no main') })
    await useTerminals.getState().init()
    expect(useTerminals.getState().error).toBe('no main')
  })

  it('open / close / restart / markExited, with active-tab bookkeeping', async () => {
    const queue: TerminalInfo[] = []
    const kill = vi.fn()
    installBridge({ 'terminal:create': () => queue.shift() ?? fail('limit'), 'terminal:kill': kill })
    const s = () => useTerminals.getState()
    const [a, b, c] = [info(), info({ projectId: 'p1' }), info()]
    queue.push(a, b, c)
    await s().open()
    await s().open('p1')
    await s().open()
    expect(s().tabs.map((t) => t.id)).toEqual([a.id, b.id, c.id])
    expect(s().activeId).toBe(c.id)

    await s().open() // create fails
    expect(s().error).toBe('limit')

    s().markExited(b.id, 1)
    s().markExited('ghost', 1)
    expect(s().tabs.find((t) => t.id === b.id)!.exitCode).toBe(1)

    await s().close(c.id) // active, last → previous becomes active; running → killed
    expect(kill).toHaveBeenCalledTimes(1)
    expect(s().activeId).toBe(b.id)
    s().setActive(a.id)
    await s().close(b.id) // exited and inactive → no kill, active kept
    expect(kill).toHaveBeenCalledTimes(1)
    expect(s().activeId).toBe(a.id)
    await s().close(a.id) // active, nothing left
    expect(s().activeId).toBeUndefined()
    await s().close('nope')

    const r1 = info({ projectId: 'p1' })
    const r2 = info()
    queue.push(r1, r2)
    await s().open('p1')
    await s().open()
    const fresh = info({ projectId: 'p1' })
    queue.push(fresh)
    await s().restart(r1.id) // inactive tab restarted in place
    expect(s().tabs[0].id).toBe(fresh.id)
    expect(s().activeId).toBe(r2.id)
    const fresh2 = info()
    queue.push(fresh2)
    await s().restart(r2.id) // active tab restarted → stays active
    expect(s().activeId).toBe(fresh2.id)
    await s().restart('missing')
    await s().restart(fresh2.id) // queue empty → error
    expect(s().error).toBe('limit')
    await s().close(fresh.id) // kill fails silently
  })

  it('layouts never reorder: new tabs append, picking a tab only focuses it', async () => {
    const queue: TerminalInfo[] = []
    installBridge({ 'terminal:create': () => queue.shift()!, 'terminal:kill': () => fail('x') })
    const s = () => useTerminals.getState()
    const tabs = [info(), info(), info(), info(), info()]
    queue.push(...tabs)
    for (let i = 0; i < 5; i += 1) await s().open()

    s().setLayout('grid')
    expect(LAYOUT_GRID[s().layout]).toEqual({ cols: 2, rows: 2 })
    s().setActive(tabs[0].id)
    s().setActive(tabs[4].id) // the fifth shell lives in the third row — nothing moves
    expect(s().tabs.map((t) => t.id)).toEqual(tabs.map((t) => t.id))
    expect(s().activeId).toBe(tabs[4].id)

    await s().close(tabs[4].id) // kill rejects → still closes
    expect(s().tabs.some((t) => t.id === tabs[4].id)).toBe(false)
  })

  it('tabLabels numbers duplicate titles by age, independent of order', () => {
    const t1 = { ...info(), title: '~' }
    const t2 = { ...info(), title: '~' }
    const t3 = { ...info(), title: 'demo' }
    const t4 = { ...info(), title: '~', createdAt: t2.createdAt, id: 'zzz' }
    const labels = tabLabels([t2, t3, t1, t4])
    expect([...labels.values()].sort()).toEqual(['demo', '~', '~ 2', '~ 3'])
    expect(labels.get(t1.id)).toBe('~')
    expect(labels.get(t2.id)).toBe('~ 2')
  })
})

// --- system metrics hook -------------------------------------------------------
describe('useSystemMetrics', () => {
  const snap = (cpu: number) => ({
    cpu: { total: cpu, cores: [] },
    mem: { usedPct: 50, usedGb: 8, totalGb: 16 },
    disk: { usedPct: 70, mount: '/' },
    net: { rxMbps: 1, txMbps: 0.5 },
    battery: { pct: 90, charging: true, hasBattery: true },
    uptimeSec: 99,
    processes: [{ pid: 1, name: 'x', cpu: 1, mem: 1 }],
    ts: 1
  })

  it('primes the history from the snapshot, then appends ticks; unsubscribes on unmount', async () => {
    const bridge = installBridge({ 'system:snapshot': () => snap(10), 'system:subscribe': () => undefined, 'system:unsubscribe': () => undefined })
    const { result, unmount } = renderHook(() => useSystemMetrics())
    expect(result.current.live).toBe(false)
    await act(settle)
    expect(result.current).toMatchObject({ live: true, uptimeSec: 99, battery: { hasBattery: true, charging: true } })
    expect(new Set(result.current.metrics.cpu.history)).toEqual(new Set([10])) // filled, no fake zeros
    act(() => bridge.emit('system:tick', snap(30)))
    expect(result.current.metrics.cpu.history.at(-1)).toBe(30)
    expect(result.current.metrics.network.value).toBe(1.5)
    unmount()
    expect(bridge.invoke).toHaveBeenCalledWith('system:unsubscribe', undefined)
  })

  it('stays offline without a bridge and ignores late snapshots after unmount', async () => {
    const offline = renderHook(() => useSystemMetrics())
    await act(settle)
    expect(offline.result.current.live).toBe(false)
    offline.unmount()

    let resolve: (v: unknown) => void = () => {}
    installBridge({ 'system:snapshot': () => new Promise((r) => (resolve = r)), 'system:subscribe': () => fail('x'), 'system:unsubscribe': () => fail('y') })
    const late = renderHook(() => useSystemMetrics())
    late.unmount()
    resolve(snap(5))
    await settle()
    expect(late.result.current.live).toBe(false)
  })
})

// --- memory ----------------------------------------------------------------------
describe('memory store', () => {
  const meta = (path: string, extra: Partial<NoteMeta> = {}): NoteMeta => ({
    path,
    title: path.replace(/^.*\//, '').replace(/\.md$/, ''),
    folder: path.includes('/') ? path.split('/')[0] : '',
    tags: [],
    modifiedAt: '',
    linkCount: 0,
    ...extra
  })
  const note = (path: string, body = 'body', extra: Partial<Note> = {}): Note => ({
    ...meta(path),
    raw: `---\n---\n${body}`,
    body,
    frontmatter: {},
    backlinks: [],
    links: {},
    ...extra
  })

  /** A tiny in-memory vault behind the fake bridge. */
  function vault(paths: string[] = ['Willkommen.md', 'Ich/A.md']) {
    const files = new Map(paths.map((p) => [p, note(p)]))
    const calls: string[] = []
    const routes: Record<string, (p: never) => unknown> = {
      'memory:status': () => ({ root: '/v', defaultRoot: '/v', name: 'W-ONE', isDefault: true, exists: true, noteCount: files.size, graphStyle: { mode: 'colorful', color: 'cyan' } }),
      'memory:list': () => [...files.keys()].map((p) => meta(p)),
      'memory:graph': () => ({ nodes: [], edges: [] }),
      'memory:folders': () => ['Ich'],
      'memory:read': ({ path }: { path: string }) => files.get(path) ?? fail('Note not found', 'not-found'),
      'memory:writeBody': ({ path, body }: { path: string; body: string }) => {
        calls.push(`write:${path}`)
        files.set(path, note(path, body))
        return meta(path)
      },
      'memory:create': ({ title, folder }: { title: string; folder: string }) => {
        const p = `${folder ? `${folder}/` : ''}${title}.md`
        files.set(p, note(p, ''))
        return meta(p)
      },
      'memory:createFolder': ({ name }: { name: string }) => {
        calls.push(`folder:${name}`)
        return name
      },
      'memory:rename': ({ path, title }: { path: string; title: string }) => {
        const p = `${path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/` : ''}${title}.md`
        files.set(p, { ...files.get(path)!, ...meta(p) })
        files.delete(path)
        return meta(p)
      },
      'memory:move': ({ path, folder }: { path: string; folder: string }) => {
        const p = `${folder ? `${folder}/` : ''}${path.slice(path.lastIndexOf('/') + 1)}`
        files.set(p, { ...files.get(path)!, ...meta(p) })
        files.delete(path)
        return meta(p)
      },
      'memory:moveFolder': ({ folder, into }: { folder: string; into: string }) => {
        const to = `${into ? `${into}/` : ''}${folder}`
        for (const [p, n] of [...files]) {
          if (!p.startsWith(`${folder}/`)) continue
          const np = `${to}${p.slice(folder.length)}`
          files.set(np, { ...n, ...meta(np) })
          files.delete(p)
        }
        return to
      },
      'memory:link': ({ from, to }: { from: string; to: string }) => calls.push(`link:${from}->${to}`),
      'memory:unlink': ({ from, to }: { from: string; to: string }) => calls.push(`unlink:${from}->${to}`),
      'memory:trash': ({ path }: { path: string }) => files.delete(path),
      'memory:search': ({ query }: { query: string }) => [{ path: 'Willkommen.md', title: query, snippet: '' }],
      'memory:setGraphStyle': (s: unknown) => s,
      'memory:createVault': () => calls.push('createVault'),
      'memory:pickVault': () => ({ root: '/other' }),
      'memory:setVault': ({ path }: { path: string }) => calls.push(`setVault:${path}`),
      'memory:reveal': () => calls.push('reveal')
    }
    const bridge = installBridge(routes)
    return { files, calls, routes, bridge }
  }
  const m = () => useMemory.getState()

  it('init loads index, opens Willkommen (falling back to the first note) and shows the graph', async () => {
    vault(['Ich/A.md', 'Willkommen.md'])
    await m().init()
    expect(m()).toMatchObject({ loading: false, view: 'graph', folders: ['Ich'], note: { path: 'Willkommen.md' } })
    await m().init() // a note is open → stays
    expect(m().note!.path).toBe('Willkommen.md')

    useMemory.setState(initial.memory, true)
    vault(['Ich/A.md'])
    await m().init()
    expect(m().note!.path).toBe('Ich/A.md')

    useMemory.setState(initial.memory, true)
    vault([])
    await m().init()
    expect(m().note).toBeUndefined()

    installBridge({ 'memory:status': () => fail('no vault service') })
    await m().init()
    expect(m()).toMatchObject({ error: 'no vault service', loading: false })
  })

  it('edits autosave after a pause, keep typing that happened mid-save, and flush on demand', async () => {
    vi.useFakeTimers()
    const v = vault()
    await m().open('Willkommen.md')
    m().setDraft('one')
    m().setDraft('two')
    await vi.advanceTimersByTimeAsync(700)
    expect(v.calls).toEqual(['write:Willkommen.md'])
    expect(m().note!.body).toBe('two')

    // typing while the write is in flight survives
    let release: () => void = () => {}
    v.routes['memory:writeBody'] = (({ path, body }: { path: string; body: string }) =>
      new Promise((r) => (release = () => r(v.files.set(path, note(path, body)))))) as never
    m().setDraft('three')
    const saving = m().save()
    await vi.advanceTimersByTimeAsync(0)
    m().setDraft('three-and-more')
    release()
    await saving
    expect(m().draft).toBe('three-and-more')

    v.routes['memory:writeBody'] = (({ path, body }: { path: string; body: string }) => v.files.set(path, note(path, body))) as never
    await m().save() // flushes the pending autosave immediately
    await m().save() // nothing to do
    useMemory.setState({ note: undefined })
    await m().save() // no note
  })

  it('reports save failures and opening errors', async () => {
    const v = vault()
    await m().open('Willkommen.md')
    v.routes['memory:writeBody'] = (() => fail('disk full')) as never
    m().setDraft('x')
    await m().save()
    expect(m()).toMatchObject({ error: 'disk full', saving: false })
    m().clearError()
    expect(m().error).toBeUndefined()
    await m().open('Nope.md')
    expect(m().error).toBe('Note not found')
  })

  it('follows file changes: external edits, deletes, unsaved text, renames in flight', async () => {
    const v = vault()
    await m().open('Willkommen.md')
    v.files.set('Willkommen.md', note('Willkommen.md', 'external'))
    await m().onChanged({ paths: ['Willkommen.md'] })
    expect(m().draft).toBe('external') // not dirty → follows the file

    m().setDraft('mine')
    v.files.set('Willkommen.md', note('Willkommen.md', 'theirs', { backlinks: [meta('Ich/A.md')] }))
    await m().onChanged({ paths: ['Willkommen.md'] })
    expect(m().draft).toBe('mine') // dirty → keeps the user's text
    expect(m().note!.backlinks).toHaveLength(1)

    useMemory.setState({ query: 'q' })
    v.files.delete('Willkommen.md')
    await m().onChanged({ paths: ['Other.md'] }) // gone, but not reported → keep
    expect(m().note).toBeDefined()
    await m().onChanged({}) // full rescan → drop
    expect(m().note).toBeUndefined()
    await m().onChanged({}) // no note → nothing to do

    // a rename finished while onChanged was reading: never clobber the new note
    await m().open('Ich/A.md')
    let resolveRead: (v: unknown) => void = () => {}
    v.routes['memory:read'] = (() => new Promise((r) => (resolveRead = r))) as never
    const pending = m().onChanged({})
    await settle()
    useMemory.setState({ note: note('Ich/B.md') })
    resolveRead(undefined)
    await pending
    expect(m().note!.path).toBe('Ich/B.md')

    installBridge({ 'memory:status': () => fail('boom') })
    await m().onChanged({})
    expect(m().error).toBe('boom')
  })

  it('vault actions: create, pick (or cancel), reveal', async () => {
    const v = vault()
    await m().createVault()
    expect(v.calls).toContain('createVault')
    await m().pickVault()
    expect(m().query).toBe('')
    v.routes['memory:pickVault'] = (() => null) as never
    await m().open('Willkommen.md')
    await m().pickVault()
    expect(m().note).toBeDefined()
    await m().reveal()
    expect(v.calls).toContain('reveal')
    await m().setVault('/srv/notes')
    expect(v.calls).toContain('setVault:/srv/notes')

    for (const ch of ['memory:createVault', 'memory:pickVault', 'memory:reveal', 'memory:setVault']) v.routes[ch] = (() => fail(ch)) as never
    await m().setVault('/x')
    expect(m().error).toBe('memory:setVault')
    await m().createVault()
    expect(m().error).toBe('memory:createVault')
    await m().pickVault()
    expect(m().error).toBe('memory:pickVault')
    await m().reveal()
    expect(m().error).toBe('memory:reveal')
  })

  it('inline create: notes (opened in edit mode) and folders; cancel and blank names', async () => {
    const v = vault()
    m().startCreate('note')
    expect(m().creating).toEqual({ kind: 'note', parent: '' })
    m().cancelCreate()
    expect(m().creating).toBeNull()
    await m().submitCreate('ignored') // nothing pending
    m().startCreate('note', 'Ich')
    await m().submitCreate('   ')
    expect(m().note).toBeUndefined()

    m().startCreate('note', 'Ich')
    await m().submitCreate(' Idee ')
    expect(m()).toMatchObject({ mode: 'edit', view: 'note', note: { path: 'Ich/Idee.md' } })
    m().startCreate('folder', '')
    await m().submitCreate('Archiv')
    expect(v.calls).toContain('folder:Archiv')

    v.routes['memory:createFolder'] = (() => fail('exists')) as never
    v.routes['memory:create'] = (() => fail('no create')) as never
    m().startCreate('folder', '')
    await m().submitCreate('Archiv')
    expect(m().error).toBe('exists')
    await m().createNote('X')
    expect(m().error).toBe('no create')
  })

  it('openOrCreate follows links by title or path, creating missing notes', async () => {
    vault(['Ich/A.md', 'Other/A.md', 'Willkommen.md'])
    await m().init()
    await m().openOrCreate('a')
    expect(m().note!.path).toBe('Ich/A.md')
    await m().openOrCreate('Other/A.md')
    expect(m().note!.path).toBe('Other/A.md')
    await m().openOrCreate('Ideas/New One')
    expect(m().note!.path).toBe('Ideas/New One.md')
    await m().openOrCreate('Loose')
    expect(m().note!.path).toBe('Loose.md')
  })

  it('rename, move note, move folder — re-opening the moved note', async () => {
    vault(['Ich/A.md', 'Ich/B.md', 'Willkommen.md'])
    await m().open('Ich/A.md')
    await m().rename('  ') // ignored
    await m().rename('A') // same title
    await m().rename('Alpha')
    expect(m().note!.path).toBe('Ich/Alpha.md')
    useMemory.setState({ note: undefined })
    await m().rename('x') // no note

    await m().open('Ich/Alpha.md')
    await m().moveNote('Ich/B.md', '') // another note → current stays
    expect(m().note!.path).toBe('Ich/Alpha.md')
    await m().moveNote('Ich/Alpha.md', '')
    expect(m().note!.path).toBe('Alpha.md')

    await m().open('B.md')
    await m().moveFolder('Ich', 'Archiv') // open note not inside → stays
    expect(m().note!.path).toBe('B.md')
    await m().moveNote('B.md', 'Archiv/Ich')
    await m().moveFolder('Archiv', 'Deep')
    expect(m().note!.path).toBe('Deep/Archiv/Ich/B.md')
  })

  it('rename/move/link/unlink/trash surface errors', async () => {
    const v = vault()
    await m().open('Willkommen.md')
    for (const ch of ['memory:rename', 'memory:move', 'memory:moveFolder', 'memory:link', 'memory:unlink', 'memory:trash']) {
      v.routes[ch] = (() => fail(ch)) as never
    }
    await m().rename('New')
    expect(m().error).toBe('memory:rename')
    await m().moveNote('Willkommen.md', 'Ich')
    expect(m().error).toBe('memory:move')
    await m().moveFolder('Ich', '')
    expect(m().error).toBe('memory:moveFolder')
    await m().link('Ich/A.md')
    expect(m().error).toBe('memory:link')
    await m().unlink('Willkommen.md', 'Ich/A.md')
    expect(m().error).toBe('memory:unlink')
    await m().trash('Willkommen.md')
    expect(m().error).toBe('memory:trash')
  })

  it('link / unlink refresh the open note; trash closes it', async () => {
    const v = vault()
    await m().open('Willkommen.md')
    await m().link('Ich/A.md')
    await m().unlink('Willkommen.md', 'Ich/A.md')
    expect(v.calls).toEqual(['link:Willkommen.md->Ich/A.md', 'unlink:Willkommen.md->Ich/A.md'])
    const unlinkRoute = v.routes['memory:unlink']
    v.routes['memory:unlink'] = ((p: never) => {
      useMemory.setState({ draft: 'unsaved words' }) // typed while the unlink was in flight
      return unlinkRoute(p)
    }) as never
    await m().unlink('Ich/A.md', 'Willkommen.md') // the refresh keeps the dirty draft
    expect(m().draft).toBe('unsaved words')
    v.routes['memory:unlink'] = unlinkRoute
    useMemory.setState({ draft: m().note!.body })
    v.routes['memory:read'] = (() => fail('gone')) as never
    await m().link('Ich/A.md') // refresh fails quietly
    v.routes['memory:read'] = (({ path }: { path: string }) => v.files.get(path)) as never

    useMemory.setState({ note: undefined })
    await m().link('Ich/A.md') // no note → nothing
    await m().unlink('Ich/A.md', 'Willkommen.md') // works without an open note
    await m().open('Willkommen.md')
    await m().trash('Ich/A.md') // another note → current stays
    expect(m().note).toBeDefined()
    await m().trash('Willkommen.md')
    expect(m()).toMatchObject({ note: undefined, view: 'graph' })
  })

  it('view/mode switches save first; search is latest-wins; graph style is optimistic', async () => {
    const v = vault()
    await m().open('Willkommen.md')
    m().setView('graph')
    m().setView('note')
    m().setMode('preview')
    m().setMode('edit')
    expect(m()).toMatchObject({ view: 'note', mode: 'edit' })

    await m().search('  ')
    expect(m().hits).toEqual([])
    const slow = m().search('first')
    const fast = m().search('second')
    await Promise.all([slow, fast])
    expect(m().hits[0].title).toBe('second')
    v.routes['memory:search'] = (() => fail('index down')) as never
    await m().search('x')
    expect(m().error).toBe('index down')

    await m().setGraphStyle({ mode: 'single', color: 'pink' }) // no status yet
    await m().init()
    await m().setGraphStyle({ mode: 'single', color: 'amber' })
    expect(m().status!.graphStyle).toEqual({ mode: 'single', color: 'amber' })
    v.routes['memory:setGraphStyle'] = (() => fail('bad-style')) as never
    await m().setGraphStyle({ mode: 'colorful', color: 'cyan' })
    expect(m().status!.graphStyle).toEqual({ mode: 'single', color: 'amber' }) // reverted
    useMemory.setState({ status: undefined })
    await m().setGraphStyle({ mode: 'colorful', color: 'cyan' })
  })

  it('a successful style save while the status vanished keeps going', async () => {
    vault()
    await m().init()
    let resolve: (v: unknown) => void = () => {}
    useMemory.getState()
    ;(window as unknown as { wone: { routes: Record<string, unknown> } }).wone.routes['memory:setGraphStyle'] = () =>
      new Promise((r) => (resolve = r))
    const pending = m().setGraphStyle({ mode: 'single', color: 'lime' })
    await settle()
    useMemory.setState({ status: undefined })
    resolve({ mode: 'single', color: 'lime' })
    await pending
    expect(m().status).toBeUndefined()
  })

  it('folderColors assigns stable slots per folder', () => {
    const slots = folderColors([{ folder: 'b' }, { folder: '' }, { folder: 'a' }, { folder: 'b' }])
    expect([...slots]).toEqual([['', 0], ['a', 1], ['b', 2]])
  })
})
