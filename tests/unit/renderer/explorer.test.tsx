import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, installBridge, settle } from './bridge'
import { FileTree } from '@/features/editor/components/FileTree'
import { setBufferHost, tabKey, useEditor, type BufferHost, type EditorTab } from '@/features/editor/store'
import { useLive } from '@/features/editor/live'

const flags = vi.hoisted(() => ({ mac: true }))
vi.mock('@/lib/platform', () => ({
  get isMac() {
    return flags.mac
  }
}))

const initial = useEditor.getState()
const e = () => useEditor.getState()
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
const host = () => ({
  snapshot: vi.fn<BufferHost['snapshot']>(),
  markClean: vi.fn<BufferHost['markClean']>(),
  drop: vi.fn<BufferHost['drop']>(),
  rekey: vi.fn<BufferHost['rekey']>()
})

/** A project tree the file routes answer from. */
function routes(extra: Record<string, (p: never) => unknown> = {}) {
  return installBridge({
    'files:list': ({ dir }: { dir: string }) => (dir === 'src' ? [entry('src/a.ts')] : [entry('src', 'dir'), entry('README.md')]),
    'files:read': ({ path }: { path: string }) => ({ path, mtimeMs: 1, size: 0, content: '' }),
    'files:create': () => undefined,
    'files:rename': () => undefined,
    'files:delete': () => undefined,
    ...extra
  })
}

beforeEach(() => {
  useEditor.setState(initial, true)
  useEditor.setState({ projectId: 'p' })
  setBufferHost(null)
  flags.mac = true
})

describe('explorer store', () => {
  it('names new entries inside the selected folder, next to a selected file, else at the root', async () => {
    const bridge = routes()
    await e().startNaming('file')
    expect(e().naming).toEqual({ mode: 'file', dir: '' })

    e().select('src', 'dir')
    await e().startNaming('dir')
    expect(e().naming).toEqual({ mode: 'dir', dir: 'src' })
    expect(e().expanded['p:src']).toBe(true) // the folder opens to show the field
    expect(bridge.invoke).toHaveBeenCalledWith('files:list', { projectId: 'p', dir: 'src' })

    await e().startNaming('file', { path: 'src/a.ts', kind: 'file' })
    expect(e().naming).toEqual({ mode: 'file', dir: 'src' }) // already open: no second listing
    expect(bridge.invoke.mock.calls.filter(([c]) => c === 'files:list')).toHaveLength(1)

    e().cancelNaming()
    expect(e().naming).toBeUndefined()
  })

  it('renames the selection (nothing selected → nothing to rename)', async () => {
    await e().startNaming('rename')
    expect(e().naming).toBeUndefined()
    await e().startNaming('rename', { path: 'src/a.ts', kind: 'file' })
    expect(e().naming).toEqual({ mode: 'rename', dir: 'src', path: 'src/a.ts' })
    expect(e().selection).toEqual({ path: 'src/a.ts', kind: 'file' })
  })

  it('submit: refuses bad names, skips unchanged ones, and shows what the core refused', async () => {
    routes({ 'files:create': () => fail('src/x.ts already exists', 'exists') })
    await e().submitName('x') // no field open
    for (const bad of ['', '  ', 'a/../b', './x', 'a//b']) {
      useEditor.setState({ naming: { mode: 'file', dir: 'src' } })
      await e().submitName(bad)
      expect(e().naming?.error).toBe('invalid-name')
    }
    useEditor.setState({ naming: { mode: 'file', dir: 'src' } })
    await e().submitName('x.ts')
    expect(e().naming).toEqual({ mode: 'file', dir: 'src', error: 'src/x.ts already exists' })

    useEditor.setState({ naming: { mode: 'rename', dir: 'src', path: 'src/a.ts' } })
    await e().submitName(' a.ts ')
    expect(e().naming).toBeUndefined()
  })

  it('creates a file (and opens it) or a folder at the root or inside one', async () => {
    const bridge = routes()
    useEditor.setState({ naming: { mode: 'file', dir: '' } })
    await e().submitName('/notes/todo.md/')
    expect(bridge.invoke).toHaveBeenCalledWith('files:create', { projectId: 'p', path: 'notes/todo.md', kind: 'file' })
    expect(e().activeId).toBe('p:notes/todo.md')
    expect(e().selection).toEqual({ path: 'notes/todo.md', kind: 'file' })

    useEditor.setState({ naming: { mode: 'dir', dir: 'src' } })
    await e().submitName('lib')
    expect(bridge.invoke).toHaveBeenCalledWith('files:create', { projectId: 'p', path: 'src/lib', kind: 'dir' })
    expect(e().selection).toEqual({ path: 'src/lib', kind: 'dir' })
    expect(e().tabs).toHaveLength(1)
  })

  it('renaming carries open tabs along — the file itself, everything in a renamed folder, the active one', async () => {
    const bridge = routes()
    const h = host()
    setBufferHost(h)
    useEditor.setState({
      tabs: [tab('src/a.ts', { dirty: true }), tab('src/deep/b.ts'), tab('srcx.ts'), { ...tab('src/a.ts'), id: 'q:src/a.ts', projectId: 'q' }],
      activeId: 'p:src/deep/b.ts',
      selection: { path: 'src', kind: 'dir' },
      naming: { mode: 'rename', dir: '', path: 'src' }
    })
    await e().submitName('lib')
    expect(bridge.invoke).toHaveBeenCalledWith('files:rename', { projectId: 'p', from: 'src', to: 'lib' })
    expect(e().tabs.map((t) => `${t.id} ${t.name}${t.dirty ? ' *' : ''}`)).toEqual(['p:lib/a.ts a.ts *', 'p:lib/deep/b.ts b.ts', 'p:srcx.ts srcx.ts', 'q:src/a.ts a.ts'])
    expect(e().activeId).toBe('p:lib/deep/b.ts')
    expect(h.rekey).toHaveBeenCalledWith('p:src/a.ts', { id: 'p:lib/a.ts', projectId: 'p', path: 'lib/a.ts' })
    expect(e().selection).toEqual({ path: 'lib', kind: 'dir' })

    // Without a buffer host (Monaco not loaded yet) the tabs still move.
    setBufferHost(null)
    useEditor.setState({ naming: { mode: 'rename', dir: 'lib', path: 'lib/a.ts' }, selection: { path: 'lib/a.ts', kind: 'file' } })
    await e().submitName('z.ts')
    expect(e().tabs[0].id).toBe('p:lib/z.ts')
    expect(e().activeId).toBe('p:lib/deep/b.ts')
  })

  it('deletes after asking: clean tabs of it close, unsaved ones stay, the selection clears', async () => {
    const bridge = routes()
    useEditor.setState({ tabs: [tab('src/a.ts'), tab('src/b.ts', { dirty: true }), tab('README.md')], selection: { path: 'src/a.ts', kind: 'file' } })
    await e().confirmDelete() // nothing asked
    expect(bridge.invoke).not.toHaveBeenCalledWith('files:delete', expect.anything())

    e().requestDelete('src')
    expect(e().deleting).toBe('src')
    e().cancelDelete()
    expect(e().deleting).toBeUndefined()

    e().requestDelete() // the selection
    expect(e().deleting).toBe('src/a.ts')
    e().requestDelete('src')
    await e().confirmDelete()
    expect(bridge.invoke).toHaveBeenCalledWith('files:delete', { projectId: 'p', path: 'src' })
    expect(e().tabs.map((t) => t.path)).toEqual(['src/b.ts', 'README.md'])
    expect(e().selection).toBeUndefined()

    useEditor.setState({ selection: { path: 'README.md', kind: 'file' } })
    e().requestDelete('src/b.ts')
    await e().confirmDelete()
    expect(e().selection).toEqual({ path: 'README.md', kind: 'file' })
  })

  it('a failed delete shows the error until dismissed; collapse folds only this project', async () => {
    routes({ 'files:delete': () => fail('gone', 'not-found') })
    e().requestDelete('x')
    await e().confirmDelete()
    expect(e().fileError).toBe('gone')
    e().clearFileError()
    expect(e().fileError).toBeUndefined()

    useEditor.setState({ expanded: { 'p:src': true, 'p:src/deep': true, 'q:src': true } })
    e().collapseAll()
    expect(e().expanded).toEqual({ 'q:src': true })
  })
})

describe('explorer view', () => {
  const show = (readOnly = false) => {
    useEditor.setState({ tree: { 'p:': [entry('src', 'dir'), entry('README.md')], 'p:src': [entry('src/a.ts')] }, expanded: { 'p:src': true } })
    return render(<FileTree projectId="p" readOnly={readOnly} />)
  }

  it('toolbar: new file and folder at the selection, collapse all', async () => {
    routes()
    show()
    fireEvent.click(screen.getByRole('treeitem', { name: 'src' }))
    expect(e().selection).toEqual({ path: 'src', kind: 'dir' })
    fireEvent.click(screen.getByRole('treeitem', { name: 'src' })) // open again
    await act(settle)
    fireEvent.click(screen.getByRole('button', { name: 'New File' }))
    await act(settle)
    expect(e().naming).toEqual({ mode: 'file', dir: 'src' })
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'New Folder' }))
    await act(settle)
    expect(e().naming).toEqual({ mode: 'dir', dir: 'src' })

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Folders' }))
    expect(e().expanded).toEqual({})
  })

  it('the name field: Enter creates, a refused name stays open with the error, typing clears it', async () => {
    const bridge = routes({ 'files:create': () => fail('taken', 'exists') })
    show()
    act(() => useEditor.setState({ naming: { mode: 'file', dir: '' } }))
    const input = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(input, { target: { value: 'x.ts' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await act(settle)
    expect(screen.getByRole('alert')).toHaveTextContent('taken')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    fireEvent.blur(input) // an error keeps the field (no second try on blur)
    expect(bridge.invoke.mock.calls.filter(([c]) => c === 'files:create')).toHaveLength(1)

    fireEvent.change(input, { target: { value: 'y.ts' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(input, { target: { value: 'z.ts' } }) // no error to clear
    fireEvent.keyDown(input, { key: 'a' })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input) // leaving while it's being created: not a second try
    await act(settle)
    expect(bridge.invoke).toHaveBeenLastCalledWith('files:create', { projectId: 'p', path: 'z.ts', kind: 'file' })
    expect(bridge.invoke.mock.calls.filter(([c, p]) => c === 'files:create' && (p as { path: string }).path === 'z.ts')).toHaveLength(1)
  })

  it('the name field: bad names explain themselves; Escape cancels; leaving it empty cancels; leaving it applies', async () => {
    const bridge = routes()
    show()
    act(() => useEditor.setState({ naming: { mode: 'dir', dir: 'src' } }))
    let input = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(input, { target: { value: '..' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await act(settle)
    expect(screen.getByRole('alert')).toHaveTextContent('Not a valid file or folder name.')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(e().naming).toBeUndefined()

    act(() => useEditor.setState({ naming: { mode: 'file', dir: '' } }))
    fireEvent.blur(screen.getByRole('textbox', { name: 'Name' }))
    expect(e().naming).toBeUndefined()

    act(() => useEditor.setState({ naming: { mode: 'file', dir: '' } }))
    input = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(input, { target: { value: 'new.ts' } })
    fireEvent.blur(input)
    await act(settle)
    expect(bridge.invoke).toHaveBeenCalledWith('files:create', { projectId: 'p', path: 'new.ts', kind: 'file' })
  })

  it('renaming in place selects the name without its extension', async () => {
    routes()
    show()
    act(() => useEditor.setState({ naming: { mode: 'rename', dir: '', path: 'README.md' }, selection: { path: 'README.md', kind: 'file' } }))
    const input = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    expect([input.value, input.selectionStart, input.selectionEnd]).toEqual(['README.md', 0, 6])
    expect(screen.queryByRole('treeitem', { name: 'README.md' })).toBeNull()

    act(() => useEditor.setState({ naming: { mode: 'rename', dir: '', path: 'src' }, selection: { path: 'src', kind: 'dir' } }))
    const folder = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    expect([folder.value, folder.selectionEnd]).toEqual(['src', 3])
  })

  it('context menu: every action on an entry, only "new" on empty space, nothing editable read-only', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    routes()
    const view = show()
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'a.ts' }))
    expect(e().selection).toEqual({ path: 'src/a.ts', kind: 'file' })
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['New File', 'New Folder', 'RenameF2', 'Copy Relative Path', 'Delete⌘⌫'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy Relative Path' }))
    expect(writeText).toHaveBeenCalledWith('src/a.ts')
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'a.ts' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }))
    await act(settle)
    expect(e().naming).toEqual({ mode: 'rename', dir: 'src', path: 'src/a.ts' })
    act(() => e().cancelNaming())

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'src' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New File' }))
    await act(settle)
    expect(e().naming).toEqual({ mode: 'file', dir: 'src' })
    act(() => e().cancelNaming())

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'README.md' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Folder' }))
    await act(settle)
    expect(e().naming).toEqual({ mode: 'dir', dir: '' })
    act(() => e().cancelNaming())

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'README.md' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }))
    expect(e().deleting).toBe('README.md')
    act(() => e().cancelDelete())

    // Empty space: only creating.
    fireEvent.contextMenu(screen.getByRole('tree'))
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['New File', 'New Folder'])
    fireEvent.keyDown(window, { key: 'x' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'a.ts' }))
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()

    view.unmount()
    flags.mac = false
    show(true)
    expect(screen.queryByRole('button', { name: 'New File' })).toBeNull()
    fireEvent.contextMenu(screen.getByRole('tree'))
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'a.ts' }))
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Copy Relative Path'])
  })

  it('keys: F2 renames, Delete / ⌘⌫ ask to delete — only with a selection and when editable', async () => {
    routes()
    const view = show()
    const tree = screen.getByRole('tree')
    fireEvent.keyDown(tree, { key: 'F2' })
    expect(e().naming).toBeUndefined()
    act(() => e().select('README.md', 'file'))
    fireEvent.keyDown(tree, { key: 'Backspace' })
    expect(e().deleting).toBeUndefined()
    fireEvent.keyDown(tree, { key: 'F2' })
    await act(settle)
    expect(e().naming?.mode).toBe('rename')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Delete' }) // typing in the field stays there
    expect(e().deleting).toBeUndefined()
    act(() => e().cancelNaming())
    fireEvent.keyDown(tree, { key: 'Delete' })
    expect(e().deleting).toBe('README.md')
    act(() => e().cancelDelete())
    fireEvent.keyDown(tree, { key: 'Backspace', metaKey: true })
    expect(e().deleting).toBe('README.md')
    act(() => e().cancelDelete())
    fireEvent.keyDown(tree, { key: 'Backspace', ctrlKey: true })
    expect(e().deleting).toBe('README.md')
    act(() => e().cancelDelete())

    view.unmount()
    show(true)
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'Delete' })
    expect(e().deleting).toBeUndefined()
  })

  it('the delete prompt and file errors', async () => {
    const bridge = routes()
    show()
    act(() => useEditor.setState({ deleting: 'src/a.ts' }))
    const prompt = screen.getByRole('alertdialog')
    expect(prompt).toHaveTextContent('Move “a.ts” to the trash?')
    fireEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }))
    expect(e().deleting).toBeUndefined()

    act(() => useEditor.setState({ deleting: 'README.md' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    await act(settle)
    expect(bridge.invoke).toHaveBeenCalledWith('files:delete', { projectId: 'p', path: 'README.md' })

    act(() => useEditor.setState({ fileError: 'disk full' }))
    expect(screen.getByRole('alert')).toHaveTextContent('disk full')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('an empty project still takes a new file', () => {
    useEditor.setState({ tree: { 'p:': [] } })
    render(<FileTree projectId="p" />)
    expect(screen.getByText('This folder is empty.')).toBeInTheDocument()
    act(() => useEditor.setState({ naming: { mode: 'file', dir: '' } }))
    expect(screen.queryByText('This folder is empty.')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument()
  })

  it('an HTML file opens with Live Server from its menu', () => {
    const start = vi.spyOn(useLive.getState(), 'start').mockResolvedValue()
    useEditor.setState({ tree: { 'p:': [entry('index.html'), entry('a.ts')] } })
    render(<FileTree projectId="p" />)
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'a.ts' }))
    expect(screen.queryByRole('menuitem', { name: 'Open with Live Server' })).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'index.html' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open with Live Server' }))
    expect(start).toHaveBeenCalledWith('index.html')
  })

})
