import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, installBridge, settle } from './bridge'
import type { FileContent } from '@shared/types/files'

// --- Monaco fake (jsdom can't run the real editor) ------------------------------
const mon = vi.hoisted(() => {
  type Fn = (...a: unknown[]) => void
  class Emitter {
    fns = new Set<Fn>()
    event = (fn: Fn) => {
      this.fns.add(fn)
      return { dispose: () => this.fns.delete(fn) }
    }
    fire() {
      this.fns.forEach((f) => f())
    }
  }
  class FakeModel {
    version = 1
    disposed = false
    change = new Emitter()
    constructor(
      public value: string,
      public uri: { path: string }
    ) {}
    getValue() {
      return this.value
    }
    getAlternativeVersionId() {
      return this.version
    }
    getLanguageId() {
      return this.uri.path.endsWith('.ts') ? 'typescript' : 'plaintext'
    }
    getFullModelRange() {
      return 'full'
    }
    onDidChangeContent(fn: Fn) {
      return this.change.event(fn)
    }
    pushEditOperations(_sel: unknown, edits: { text: string }[]) {
      this.value = edits[0].text
      this.version += 1
      this.change.fire()
    }
    /** test helper: an edit (version = a new id, like Monaco's alternative version id) */
    type(text: string) {
      this.value += text
      this.version += 1
      this.change.fire()
    }
    /** test helper: undo back to an earlier version */
    undoTo(version: number, value: string) {
      this.version = version
      this.value = value
      this.change.fire()
    }
    dispose() {
      this.disposed = true
    }
  }
  class FakeEditor {
    model: FakeModel | null = null
    position: { lineNumber: number; column: number } | null = { lineNumber: 1, column: 1 }
    cursor = new Emitter()
    modelChange = new Emitter()
    focus = vi.fn()
    restoreViewState = vi.fn()
    disposed = false
    constructor(
      public el: HTMLElement,
      public options: Record<string, unknown>
    ) {}
    getModel() {
      return this.model
    }
    getPosition() {
      return this.model ? this.position : null
    }
    setModel(m: FakeModel | null) {
      this.model = m
      this.modelChange.fire()
    }
    saveViewState() {
      return { of: this.model?.uri.path }
    }
    onDidChangeCursorPosition(fn: Fn) {
      return this.cursor.event(fn)
    }
    onDidChangeModel(fn: Fn) {
      return this.modelChange.event(fn)
    }
    updateOptions(o: Record<string, unknown>) {
      Object.assign(this.options, o)
    }
    dispose() {
      this.disposed = true
    }
  }
  // Plain recorders: setup.ts configures these at import time, before restoreMocks would reset a vi.fn.
  const configured: { diagnostics: unknown[]; compiler: unknown[] } = { diagnostics: [], compiler: [] }
  const defaults = () => ({
    setDiagnosticsOptions: (o: unknown) => configured.diagnostics.push(o),
    setCompilerOptions: (o: unknown) => configured.compiler.push(o),
    getCompilerOptions: () => ({ strict: true })
  })
  const state = { editors: [] as FakeEditor[], models: [] as FakeModel[], themes: [] as Record<string, unknown>[], configured }
  const monaco = {
    editor: {
      create: (el: HTMLElement, opts: Record<string, unknown>) => {
        const e = new FakeEditor(el, { ...opts })
        state.editors.push(e)
        return e
      },
      createModel: (value: string, _lang: unknown, uri: { path: string }) => {
        const m = new FakeModel(value, uri)
        state.models.push(m)
        return m
      },
      defineTheme: (_name: string, theme: Record<string, unknown>) => state.themes.push(theme),
      setTheme: vi.fn(),
      remeasureFonts: vi.fn()
    },
    Uri: { file: (path: string) => ({ path }) },
    languages: { getLanguages: () => [{ id: 'typescript', aliases: ['TypeScript', 'ts'] }, { id: 'bare' }] },
    typescript: {
      typescriptDefaults: defaults(),
      javascriptDefaults: defaults(),
      ScriptTarget: { ESNext: 99 },
      JsxEmit: { Preserve: 1 }
    }
  }
  return { state, monaco }
})
vi.mock('monaco-editor', () => mon.monaco)
vi.mock('monaco-editor/editor/editor.worker.js?worker', () => ({ default: class { kind = 'editor' } }))
vi.mock('monaco-editor/language/json/json.worker.js?worker', () => ({ default: class { kind = 'json' } }))
vi.mock('monaco-editor/language/css/css.worker.js?worker', () => ({ default: class { kind = 'css' } }))
vi.mock('monaco-editor/language/html/html.worker.js?worker', () => ({ default: class { kind = 'html' } }))
vi.mock('monaco-editor/language/typescript/ts.worker.js?worker', () => ({ default: class { kind = 'ts' } }))

import { setBufferHost, tabKey, useEditor, type BufferHost, type EditorTab } from '@/features/editor/store'
import { applyMonacoTheme, languageName } from '@/features/editor/monaco/setup'
import { monacoTheme } from '@/features/editor/monaco/theme'
import CodeEditor from '@/features/editor/components/CodeEditor'

const initial = useEditor.getState()
const e = () => useEditor.getState()

const file = (path: string, over: Partial<FileContent> = {}): FileContent => ({ path, mtimeMs: 1, size: 3, content: `<${path}>`, ...over })
const entry = (path: string, kind: 'file' | 'dir' = 'file') => ({ name: path.split('/').pop()!, path, kind, ignored: false })
const tab = (path: string, over: Partial<EditorTab> = {}): EditorTab => ({
  id: tabKey('p', path),
  projectId: 'p',
  path,
  name: path.split('/').pop()!,
  loading: false,
  content: 'x',
  mtimeMs: 1,
  revision: 1,
  dirty: false,
  saving: false,
  conflict: false,
  deleted: false,
  ...over
})
const fakeHost = (text = 'buffer') => ({
  snapshot: vi.fn<BufferHost['snapshot']>(() => ({ text, version: 7 })),
  markClean: vi.fn<BufferHost['markClean']>(),
  drop: vi.fn<BufferHost['drop']>()
})

beforeEach(() => {
  useEditor.setState(initial, true)
  setBufferHost(null)
  mon.state.editors = []
  mon.state.models = []
  mon.state.themes = []
})

describe('editor store: tree', () => {
  it('selects a project, lists its root once, and keeps a root error until the next good listing', async () => {
    let broken = true
    const bridge = installBridge({
      'files:list': ({ dir }: { dir: string }) => (broken && !dir ? fail('no access') : [entry(dir ? `${dir}/x.ts` : 'src', dir ? 'file' : 'dir')])
    })
    await e().selectProject('p')
    expect(e().treeError).toBe('no access')
    await e().selectProject('p') // same project → nothing to do
    expect(bridge.invoke).toHaveBeenCalledTimes(1)

    broken = false
    await e().loadDir('src') // a sub-folder never clears the root's error…
    expect(e().treeError).toBe('no access')
    await e().loadDir('') // …the root listing does
    expect(e().treeError).toBeUndefined()
    expect(e().tree['p:']).toEqual([entry('src', 'dir')])
    expect(e().tree['p:src']).toEqual([entry('src/x.ts')])
    expect(bridge.invoke).toHaveBeenCalledWith('files:list', { projectId: 'p', dir: 'src' })
  })

  it('toggles folders, folds away one that vanished, and refreshes only the current project', async () => {
    let gone = false
    const bridge = installBridge({ 'files:list': ({ dir }: { dir: string }) => (gone && dir === 'a' ? fail('ENOENT') : [entry(`${dir}/f`)]) })
    await e().selectProject('p')
    await e().toggleDir('a')
    await e().toggleDir('b')
    expect(e().expanded).toEqual({ 'p:a': true, 'p:b': true })
    await e().toggleDir('b')
    expect(e().expanded).toEqual({ 'p:a': true })

    useEditor.setState((s) => ({ expanded: { ...s.expanded, 'q:other': true } }))
    gone = true
    bridge.invoke.mockClear()
    await e().refreshTree()
    expect(bridge.invoke.mock.calls.map((c) => (c[1] as { dir: string }).dir).sort()).toEqual(['', 'a'])
    expect(e().expanded).toEqual({ 'q:other': true }) // 'a' folded away, other project untouched
    expect(e().tree['p:a']).toBeUndefined()
    expect(e().treeError).toBeUndefined()
  })
})

describe('editor store: tabs', () => {
  it('opens files as tabs (once), loads them, and records read errors', async () => {
    installBridge({
      'files:read': ({ path }: { path: string }) => (path === 'bad.ts' ? fail('EACCES') : file(path, path === 'pic.png' ? { content: undefined, unsupported: 'binary' } : {}))
    })
    useEditor.setState({ projectId: 'p' })
    const opening = e().open('src/a.ts')
    expect(e().tabs[0]).toMatchObject({ id: 'p:src/a.ts', name: 'a.ts', loading: true, revision: 0 })
    await opening
    expect(e().tabs[0]).toMatchObject({ loading: false, content: '<src/a.ts>', mtimeMs: 1, revision: 1 })

    await e().open('README.md')
    await e().open('pic.png')
    await e().open('bad.ts')
    expect(e().tabs.map((t) => t.name)).toEqual(['a.ts', 'README.md', 'pic.png', 'bad.ts'])
    expect(e().tabs[2]).toMatchObject({ unsupported: 'binary', content: undefined })
    expect(e().tabs[3]).toMatchObject({ loading: false, error: 'EACCES' })

    await e().open('src/a.ts') // already open → just activates
    expect(e().tabs).toHaveLength(4)
    expect(e().activeId).toBe('p:src/a.ts')
    e().setActive('p:README.md')
    expect(e().activeId).toBe('p:README.md')
  })

  it('setDirty only writes real changes', () => {
    useEditor.setState({ tabs: [tab('a.ts')] })
    const before = e().tabs
    e().setDirty('p:a.ts', false)
    expect(e().tabs).toBe(before)
    e().setDirty('p:a.ts', true)
    expect(e().tabs[0].dirty).toBe(true)
    e().setDirty('p:gone.ts', true) // unknown tab: harmless
    expect(e().tabs).toHaveLength(1)
  })

  it('save: nothing to save without a tab, text, buffer host or snapshot; clean tabs skip the write', async () => {
    const bridge = installBridge({ 'files:write': () => ({ mtimeMs: 2, size: 1 }) })
    expect(await e().save()).toBe(false) // no active tab
    useEditor.setState({ tabs: [tab('a.ts', { dirty: true }), tab('b.png', { content: undefined }), tab('c.ts', { saving: true })], activeId: 'p:a.ts' })
    expect(await e().save()).toBe(false) // no buffer host (no editor yet)
    const host = fakeHost()
    setBufferHost(host)
    expect(await e().save('p:b.png')).toBe(false)
    expect(await e().save('p:c.ts')).toBe(false)
    host.snapshot.mockReturnValueOnce(undefined)
    expect(await e().save()).toBe(false)

    e().setDirty('p:a.ts', false)
    expect(await e().save()).toBe(true) // clean → no write
    expect(bridge.invoke).not.toHaveBeenCalled()
  })

  it('save writes the buffer with the loaded mtime, then marks it clean', async () => {
    const bridge = installBridge({ 'files:write': () => ({ mtimeMs: 9, size: 6 }) })
    const host = fakeHost('saved!')
    setBufferHost(host)
    useEditor.setState({ tabs: [tab('a.ts', { dirty: true, error: 'old' })], activeId: 'p:a.ts' })
    const saving = e().save()
    expect(e().tabs[0].saving).toBe(true)
    expect(await saving).toBe(true)
    expect(bridge.invoke).toHaveBeenCalledWith('files:write', { projectId: 'p', path: 'a.ts', content: 'saved!', expectedMtime: 1 })
    expect(e().tabs[0]).toMatchObject({ saving: false, content: 'saved!', mtimeMs: 9, error: undefined })
    expect(host.markClean).toHaveBeenCalledWith('p:a.ts', 7)
  })

  it('save without an mtime check when forced or when the file was deleted', async () => {
    const bridge = installBridge({ 'files:write': () => ({ mtimeMs: 9, size: 6 }) })
    setBufferHost(fakeHost())
    useEditor.setState({ tabs: [tab('a.ts', { dirty: true, conflict: true }), tab('b.ts', { deleted: true })] })
    await e().save('p:a.ts', { force: true })
    await e().save('p:b.ts')
    expect(bridge.invoke.mock.calls.map((c) => (c[1] as { expectedMtime?: number }).expectedMtime)).toEqual([undefined, undefined])
    expect(e().tabs.map((t) => [t.conflict, t.deleted])).toEqual([
      [false, false],
      [false, false]
    ])
  })

  it('save failures: a conflict flags the tab, other errors keep an earlier conflict and show the message', async () => {
    let code = 'conflict'
    installBridge({ 'files:write': () => fail('nope', code) })
    setBufferHost(fakeHost())
    useEditor.setState({ tabs: [tab('a.ts', { dirty: true })] })
    expect(await e().save('p:a.ts')).toBe(false)
    expect(e().tabs[0]).toMatchObject({ conflict: true, error: undefined, saving: false })
    code = 'EROFS'
    expect(await e().save('p:a.ts')).toBe(false)
    expect(e().tabs[0]).toMatchObject({ conflict: true, error: 'nope' })
    useEditor.setState({ tabs: [tab('a.ts', { dirty: true })] })
    await e().save('p:a.ts')
    expect(e().tabs[0]).toMatchObject({ conflict: false, error: 'nope' })
  })

  it('reload: unknown tab is ignored; ifClean turns into a conflict when edits appeared meanwhile', async () => {
    let release!: () => void
    installBridge({ 'files:read': () => new Promise((r) => (release = () => r(file('a.ts', { content: 'disk', mtimeMs: 5 })))) })
    await e().reload('p:nope')
    useEditor.setState({ tabs: [tab('a.ts', { conflict: true, deleted: true, error: 'x' })] })

    const finish = async (p: Promise<void>) => {
      await settle(1)
      release()
      await p
    }
    let pending = e().reload('p:a.ts', { ifClean: true })
    e().setDirty('p:a.ts', true)
    await finish(pending)
    expect(e().tabs[0]).toMatchObject({ content: 'x', conflict: true, dirty: true })

    pending = e().reload('p:a.ts') // explicit reload discards the edits
    await finish(pending)
    expect(e().tabs[0]).toMatchObject({ content: 'disk', mtimeMs: 5, revision: 2, dirty: false, conflict: false, deleted: false, error: undefined })

    pending = e().reload('p:a.ts', { ifClean: true }) // clean → applies
    await finish(pending)
    expect(e().tabs[0].revision).toBe(3)

    pending = e().reload('p:a.ts', { ifClean: true }) // closed meanwhile → nothing to update
    useEditor.setState({ tabs: [] })
    await finish(pending)
    expect(e().tabs).toEqual([])
  })

  it('closing: dirty tabs ask first; save-and-close only closes when saved; the neighbour takes over', async () => {
    let ok = false
    installBridge({ 'files:write': () => (ok ? { mtimeMs: 2, size: 1 } : fail('disk full')) })
    const host = fakeHost()
    setBufferHost(host)
    useEditor.setState({ tabs: [tab('a.ts'), tab('b.ts', { dirty: true }), tab('c.ts')], activeId: 'p:b.ts' })

    e().requestClose('p:b.ts')
    expect(e().closing).toBe('p:b.ts')
    e().cancelClose()
    expect(e().closing).toBeUndefined()
    e().requestClose('p:b.ts')
    await e().saveAndClose('p:b.ts')
    expect(e().tabs).toHaveLength(3) // save failed → still open
    ok = true
    await e().saveAndClose('p:b.ts')
    expect(e().tabs.map((t) => t.name)).toEqual(['a.ts', 'c.ts'])
    expect(e().activeId).toBe('p:c.ts') // right neighbour
    expect(e().closing).toBeUndefined()
    expect(host.drop).toHaveBeenCalledWith('p:b.ts')

    e().requestClose('p:a.ts') // clean, not active → closes, active stays
    expect(e().activeId).toBe('p:c.ts')
    e().close('p:nope') // unknown: nothing happens
    setBufferHost(null)
    e().close('p:c.ts') // the last one
    expect(e().tabs).toEqual([])
    expect(e().activeId).toBeUndefined()

    useEditor.setState({ tabs: [tab('a.ts'), tab('b.ts')], activeId: 'p:b.ts' })
    e().close('p:b.ts') // rightmost → left neighbour
    expect(e().activeId).toBe('p:a.ts')
  })
})

describe('editor store: following the disk', () => {
  it('reloads clean tabs that changed, flags dirty ones, tracks deletions, per project', async () => {
    const disk: Record<string, { mtimeMs: number; size: number } | null> = {
      'p:same.ts': { mtimeMs: 1, size: 1 },
      'p:changed.ts': { mtimeMs: 2, size: 1 },
      'p:edited.ts': { mtimeMs: 2, size: 1 },
      'p:conflicted.ts': { mtimeMs: 3, size: 1 },
      'p:gone.ts': null,
      'p:stillgone.ts': null,
      'p:back.ts': { mtimeMs: 1, size: 1 },
      'q:other.ts': { mtimeMs: 1, size: 1 }
    }
    const bridge = installBridge({
      'files:stat': ({ projectId, paths }: { projectId: string; paths: string[] }) => paths.map((p) => disk[`${projectId}:${p}`]),
      'files:read': ({ path }: { path: string }) => file(path, { content: 'fresh', mtimeMs: 2 })
    })
    useEditor.setState({
      tabs: [
        tab('same.ts'),
        tab('changed.ts'),
        tab('edited.ts', { dirty: true }),
        tab('conflicted.ts', { dirty: true, conflict: true }),
        tab('gone.ts'),
        tab('stillgone.ts', { deleted: true }),
        tab('back.ts', { deleted: true }),
        { ...tab('other.ts'), id: 'q:other.ts', projectId: 'q' },
        tab('pic.png', { content: undefined }),
        tab('busy.ts', { saving: true })
      ]
    })
    await e().checkDisk()
    const by = Object.fromEntries(e().tabs.map((t) => [t.name, t]))
    expect(by['same.ts']).toMatchObject({ revision: 1, deleted: false })
    expect(by['changed.ts']).toMatchObject({ content: 'fresh', revision: 2 })
    expect(by['edited.ts']).toMatchObject({ conflict: true, content: 'x' })
    expect(by['conflicted.ts']).toMatchObject({ conflict: true })
    expect(by['gone.ts'].deleted).toBe(true)
    expect(by['stillgone.ts'].deleted).toBe(true)
    expect(by['back.ts'].deleted).toBe(false)
    const statCalls = bridge.invoke.mock.calls.filter((c) => c[0] === 'files:stat').map((c) => c[1])
    expect(statCalls).toEqual([
      { projectId: 'p', paths: ['same.ts', 'changed.ts', 'edited.ts', 'conflicted.ts', 'gone.ts', 'stillgone.ts', 'back.ts'] },
      { projectId: 'q', paths: ['other.ts'] }
    ])
  })

  it('skips tabs that closed or started saving while the disk was asked; survives a failing stat', async () => {
    let release!: () => void
    let broken = false
    installBridge({
      'files:stat': () =>
        broken ? fail('offline') : new Promise((r) => (release = () => r([{ mtimeMs: 2, size: 1 }, { mtimeMs: 2, size: 1 }])))
    })
    useEditor.setState({ tabs: [tab('a.ts'), tab('b.ts')] })
    const checking = e().checkDisk()
    await settle(1)
    useEditor.setState({ tabs: [tab('b.ts', { saving: true })] })
    release()
    await checking
    expect(e().tabs[0]).toMatchObject({ revision: 1, saving: true })

    broken = true
    useEditor.setState({ tabs: [tab('a.ts')] })
    await e().checkDisk()
    expect(e().tabs[0].revision).toBe(1)
  })
})

describe('monaco setup & theme', () => {
  it('routes each language to its worker and quiets project-less TypeScript diagnostics', () => {
    const env = (globalThis as unknown as { MonacoEnvironment: { getWorker: (id: string, label: string) => { kind: string } } }).MonacoEnvironment
    const kinds = ['json', 'css', 'scss', 'less', 'html', 'handlebars', 'razor', 'typescript', 'javascript', 'markdown'].map(
      (label) => env.getWorker('workerMain.js', label).kind
    )
    expect(kinds).toEqual(['json', 'css', 'css', 'css', 'html', 'html', 'html', 'ts', 'ts', 'editor'])
    // TypeScript and JavaScript alike
    expect(mon.state.configured.diagnostics).toEqual(
      Array(2).fill({ noSemanticValidation: true, noSuggestionDiagnostics: true, noSyntaxValidation: false })
    )
    expect(mon.state.configured.compiler).toEqual(Array(2).fill({ strict: true, target: 99, jsx: 1, allowJs: true, allowNonTsExtensions: true }))
  })

  it('language names come from the registry, with the id as fallback', () => {
    expect(languageName('typescript')).toBe('TypeScript')
    expect(languageName('bare')).toBe('bare')
    expect(languageName('unknown')).toBe('unknown')
  })

  it('the theme follows the app tokens and the light/dark switch', () => {
    applyMonacoTheme()
    expect(mon.state.themes[0]).toMatchObject({ base: 'vs-dark', inherit: true })
    expect(mon.monaco.editor.setTheme).toHaveBeenCalledWith('wone')
    document.documentElement.dataset.theme = 'light'
    document.documentElement.style.setProperty('--accent-cyan', '0 132 158')
    const light = monacoTheme()
    expect(light.base).toBe('vs')
    expect(light.colors['editorCursor.foreground']).toBe('#00849e')
    expect(light.rules).toContainEqual({ token: 'type', foreground: '00849e' })
    document.documentElement.style.cssText = ''
  })
})

describe('CodeEditor (Monaco view)', () => {
  const editor = () => mon.state.editors[mon.state.editors.length - 1]
  const model = (path: string) => mon.state.models.find((m) => m.uri.path === `/p/${path}`)!

  it('one editor for all tabs: a model per file, view state per tab, dirty from version ids', async () => {
    const onCursor = vi.fn()
    useEditor.setState({ tabs: [tab('a.ts', { content: 'A' }), tab('b.md', { content: 'B' }), tab('c.ts', { content: undefined, loading: true })] })
    const view = (t?: EditorTab, readOnly = false) => <CodeEditor tab={t} readOnly={readOnly} onCursor={onCursor} />
    const { rerender, unmount } = render(view())
    expect(editor().options).toMatchObject({ model: null, theme: 'wone', automaticLayout: true, readOnly: false })
    expect(mon.state.themes).toHaveLength(1)
    document.documentElement.dataset.theme = 'light' // the app's theme switch
    await act(() => settle(1))
    expect(mon.state.themes).toHaveLength(2)

    rerender(view(e().tabs[0]))
    expect(editor().model).toBe(model('a.ts'))
    expect(editor().focus).toHaveBeenCalledTimes(1)
    expect(onCursor).toHaveBeenLastCalledWith({ line: 1, col: 1, language: 'TypeScript' })

    act(() => model('a.ts').type('!'))
    expect(e().tabs[0].dirty).toBe(true)
    act(() => model('a.ts').undoTo(1, 'A')) // undo back to the saved text → clean again
    expect(e().tabs[0].dirty).toBe(false)

    editor().position = { lineNumber: 3, column: 7 }
    act(() => editor().cursor.fire())
    expect(onCursor).toHaveBeenLastCalledWith({ line: 3, col: 7, language: 'TypeScript' })
    editor().position = null
    act(() => editor().cursor.fire()) // no position → nothing reported
    expect(onCursor).toHaveBeenCalledTimes(2)
    editor().position = { lineNumber: 3, column: 7 }

    rerender(view(e().tabs[1])) // switch: a.ts keeps its view state
    expect(editor().model).toBe(model('b.md'))
    expect(onCursor).toHaveBeenLastCalledWith({ line: 3, col: 7, language: 'plaintext' })
    rerender(view(e().tabs[0])) // back: restored
    expect(editor().restoreViewState).toHaveBeenLastCalledWith({ of: '/p/a.ts' })
    expect(mon.state.models).toHaveLength(2) // reused, not recreated

    rerender(view(e().tabs[2])) // still loading → no buffer shown
    expect(editor().model).toBeNull()
    rerender(view(e().tabs[2], true))
    expect(editor().options.readOnly).toBe(true)

    unmount()
    expect(editor().disposed).toBe(true)
    expect(mon.state.models.every((m) => m.disposed)).toBe(true)
    expect(await e().save('p:a.ts')).toBe(false) // the buffer host is gone
  })

  it('serves the store: snapshots, marks saved versions clean, applies disk reloads, frees closed tabs', async () => {
    installBridge({ 'files:write': () => ({ mtimeMs: 5, size: 2 }) })
    useEditor.setState({ tabs: [tab('a.ts', { content: 'A' }), tab('b.ts', { content: 'B' })], activeId: 'p:a.ts' })
    const view = (t: EditorTab) => <CodeEditor tab={t} readOnly={false} onCursor={() => {}} />
    // once the bundled font is in, Monaco measures again
    Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true })
    const { rerender } = render(view(e().tabs[0]))
    await act(() => settle(1))
    expect(mon.monaco.editor.remeasureFonts).toHaveBeenCalled()
    delete (document as { fonts?: unknown }).fonts
    rerender(view(e().tabs[1]))
    rerender(view(e().tabs[0]))

    act(() => model('a.ts').type('1'))
    expect(await e().save('p:a.ts')).toBe(true)
    expect(e().tabs[0]).toMatchObject({ dirty: false, content: 'A1' })
    act(() => model('a.ts').type('2'))
    expect(e().tabs[0].dirty).toBe(true)

    // disk reload of the shown tab: replaced as one edit, clean, view kept
    act(() => useEditor.setState({ tabs: [tab('a.ts', { content: 'DISK', revision: 2, dirty: true }), e().tabs[1]] }))
    rerender(view(e().tabs[0]))
    expect(model('a.ts').getValue()).toBe('DISK')
    expect(e().tabs[0].dirty).toBe(false)
    expect(editor().restoreViewState).toHaveBeenLastCalledWith({ of: '/p/a.ts' })
    expect(editor().focus).toHaveBeenCalledTimes(3) // reloads don't steal focus

    // a tab the editor never showed has no buffer: nothing to snapshot, nothing to free
    act(() => useEditor.setState((s) => ({ tabs: [...s.tabs, tab('c.ts', { dirty: true })] })))
    expect(await e().save('p:c.ts')).toBe(false)
    act(() => e().close('p:c.ts'))

    // a save still in flight when its (background) tab closes: nothing left to mark clean
    let release!: () => void
    installBridge({ 'files:write': () => new Promise((r) => (release = () => r({ mtimeMs: 6, size: 1 }))) })
    act(() => model('b.ts').type('x'))
    expect(e().tabs[1].dirty).toBe(true)
    const saving = e().save('p:b.ts')
    await settle(1)
    act(() => e().close('p:b.ts'))
    release()
    expect(await saving).toBe(true)
    expect(model('b.ts').disposed).toBe(true)
    expect(editor().model).toBe(model('a.ts'))

    // closing the shown tab takes its model out of the editor
    act(() => e().close('p:a.ts'))
    expect(model('a.ts').disposed).toBe(true)
    expect(editor().model).toBeNull()
  })
})
