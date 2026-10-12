import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, installBridge, settle } from './bridge'
import type { SftpEntry, SftpTarget } from '@shared/types/sftp'
import type { EditorTab } from '@/features/editor/store'

vi.mock('@/features/editor/components/CodeEditor', () => ({ default: () => <div data-testid="monaco" /> }))
vi.mock('@/features/editor/components/DiffView', () => ({ default: () => <div data-testid="diff" /> }))

import { setBufferHost, tabKey, useEditor } from '@/features/editor/store'
import { useSftp } from '@/features/editor/sftp'
import { useScm } from '@/features/editor/scm'
import { RemotePanel } from '@/features/editor/components/RemotePanel'
import { FileTree } from '@/features/editor/components/FileTree'
import { EditorView } from '@/features/editor/components/EditorView'
import { useProjects } from '@/features/projects/store'
import { de } from '@/lib/i18n/de'

const initialEditor = useEditor.getState()
const initialSftp = useSftp.getState()
const initialScm = useScm.getState()
const s = () => useSftp.getState()

const target = (over: Partial<SftpTarget> = {}): SftpTarget => ({ name: 'Prod', host: 'example.com', username: 'me', remotePath: '/var/www', context: 'site', uploadOnSave: false, ...over })
const dir = (path: string): SftpEntry => ({ name: path.split('/').pop()!, path, type: 'dir', size: 0, modified: 1 })
const file = (path: string): SftpEntry => ({ name: path.split('/').pop()!, path, type: 'file', size: 3, modified: 1 })
const entry = (path: string, kind: 'file' | 'dir' = 'file') => ({ name: path.split('/').pop()!, path, kind, ignored: false })
const tab = (path: string): EditorTab => ({
  id: tabKey('p', path),
  projectId: 'p',
  path,
  name: path.split('/').pop()!,
  loading: false,
  content: 'x',
  mtimeMs: 1,
  revision: 1,
  dirty: true,
  saving: false,
  conflict: false,
  deleted: false
})

/** A server with a css folder and an index.html below remotePath. */
function server(over: Record<string, (p: never) => unknown> = {}) {
  return installBridge({
    'sftp:targets': () => [target(), target({ name: 'Staging', host: 'staging.example.com', username: undefined, uploadOnSave: true })],
    'sftp:list': ({ dir: d }: { dir?: string }) => (d === 'css' ? [file('css/a.css')] : [dir('css'), file('index.html')]),
    'sftp:upload': ({ paths }: { paths: string[] }) => paths.length,
    'sftp:download': ({ paths }: { paths: string[] }) => paths.map((p) => `site/${p}`),
    'sftp:sync': ({ direction }: { direction: string }) => (direction === 'up' ? 2 : 1),
    'files:list': () => [],
    'files:read': ({ path }: { path: string }) => ({ path, mtimeMs: 1, size: 1, content: 'x' }),
    'files:write': () => ({ mtimeMs: 2, size: 1 }),
    ...over
  })
}

beforeEach(() => {
  useEditor.setState(initialEditor, true)
  useSftp.setState(initialSftp, true)
  useScm.setState(initialScm, true)
  useEditor.setState({ projectId: 'p' })
  setBufferHost(null)
})

describe('SFTP store', () => {
  it('loads the project’s targets (none without a project, an error shows), picks the first', async () => {
    useEditor.setState({ projectId: undefined })
    const bridge = server()
    await s().load()
    expect(bridge.invoke).not.toHaveBeenCalled()
    useEditor.setState({ projectId: 'p' })
    await s().load()
    expect(s()).toMatchObject({ target: 'Prod' })
    expect(s().targets).toHaveLength(2)

    server({ 'sftp:targets': () => fail('Unexpected token in .vscode/sftp.json', 'bad-config') })
    await s().load()
    expect(s()).toMatchObject({ targets: [], target: undefined, error: 'Unexpected token in .vscode/sftp.json' })
    s().clearError()
    expect(s().error).toBeUndefined()
  })

  it('a new project in the editor loads its targets', async () => {
    const bridge = server()
    act(() => useEditor.setState({ projectId: 'q' }))
    await settle()
    expect(bridge.invoke).toHaveBeenCalledWith('sftp:targets', { projectId: 'q' })
    expect(s().target).toBe('Prod')
  })

  it('browses the server: folders open and close, refresh reloads the open ones, errors show', async () => {
    const bridge = server()
    await s().load()
    await s().toggle('')
    await s().toggle('css')
    expect(s().tree).toEqual({ '': [dir('css'), file('index.html')], css: [file('css/a.css')] })
    await s().toggle('css')
    expect(s().expanded).toEqual({ '': true })
    await s().toggle('css')
    bridge.invoke.mockClear()
    await s().refresh()
    expect(bridge.invoke.mock.calls.map((c) => (c[1] as { dir: string }).dir)).toEqual(['', 'css'])
    s().select('Staging')
    expect(s()).toMatchObject({ target: 'Staging', tree: {}, expanded: {} })

    server({ 'sftp:list': () => fail('All configured authentication methods failed') })
    await s().toggle('')
    expect(s().error).toBe('All configured authentication methods failed')
    // Without a project or target nothing is asked.
    useSftp.setState({ target: undefined, expanded: {} })
    const quiet = server()
    await s().toggle('')
    expect(quiet.invoke).not.toHaveBeenCalled()
  })

  it('transfers: upload, download (the tree refreshes), sync either way — one at a time, errors show', async () => {
    const bridge = server()
    const refreshTree = vi.spyOn(useEditor.getState(), 'refreshTree').mockResolvedValue()
    await s().load()
    await s().upload(['site/index.html'])
    expect(bridge.invoke).toHaveBeenCalledWith('sftp:upload', { projectId: 'p', target: 'Prod', paths: ['site/index.html'] })
    expect(s()).toMatchObject({ busy: false, message: '1 file' })
    await s().download(['index.html', 'css'])
    expect(s().message).toBe('2 files')
    expect(refreshTree).toHaveBeenCalledTimes(1)
    await s().sync('up')
    expect(s().message).toBe('2 files')
    expect(refreshTree).toHaveBeenCalledTimes(1)
    s().setConfirmDown(true)
    await s().sync('down')
    expect(s()).toMatchObject({ message: '1 file', confirmDown: false })
    expect(refreshTree).toHaveBeenCalledTimes(2)

    // Busy: a second transfer waits its turn (is ignored).
    useSftp.setState({ busy: true })
    bridge.invoke.mockClear()
    await s().upload(['site/index.html'])
    expect(bridge.invoke).not.toHaveBeenCalled()
    useSftp.setState({ busy: false })

    server({ 'sftp:upload': () => fail('Permission denied') })
    await s().upload(['site/index.html'])
    expect(s()).toMatchObject({ busy: false, error: 'Permission denied', message: undefined })
  })

  it('opens a server file: downloads it, then opens the local copy; errors show', async () => {
    server()
    const open = vi.spyOn(useEditor.getState(), 'open').mockResolvedValue()
    vi.spyOn(useEditor.getState(), 'refreshTree').mockResolvedValue()
    await s().open('index.html') // no target yet
    expect(open).not.toHaveBeenCalled()
    await s().load()
    await s().open('index.html')
    expect(open).toHaveBeenCalledWith('site/index.html')
    server({ 'sftp:download': () => fail('No such file') })
    await s().open('gone.html')
    expect(s().error).toBe('No such file')
  })

  it('shows transfer progress; uploads on save for targets that want it, inside their folder only', async () => {
    const bridge = server({
      'sftp:targets': () => [target({ uploadOnSave: true }), target({ name: 'All', context: '', uploadOnSave: true }), target({ name: 'Off' })],
      'sftp:upload': ({ target: t }: { target: string }) => (t === 'All' ? fail('Connection lost') : 1)
    })
    await s().load()
    const stop = s().connect()
    act(() => bridge.emit('sftp:progress', { projectId: 'p', action: 'upload', file: 'site/a.css', done: 1, total: 2 }))
    expect(s().progress).toMatchObject({ done: 1, total: 2 })

    setBufferHost({ snapshot: () => ({ text: 'y', version: 2 }), markClean: () => {}, drop: () => {}, rekey: () => {} })
    useEditor.setState({ tabs: [tab('site/index.html'), tab('other.txt')] })
    await useEditor.getState().save('p:site/index.html')
    await settle()
    const uploads = () => bridge.invoke.mock.calls.filter((c) => c[0] === 'sftp:upload').map((c) => (c[1] as { target: string; paths: string[] }).target + ':' + (c[1] as { paths: string[] }).paths[0])
    expect(uploads()).toEqual(['Prod:site/index.html', 'All:site/index.html'])
    expect(s().error).toBe('Connection lost')
    await useEditor.getState().save('p:other.txt')
    await settle()
    expect(uploads()).toEqual(['Prod:site/index.html', 'All:site/index.html', 'All:other.txt'])

    // Another project's save (the editor moved on) uploads nothing.
    useSftp.setState({ error: undefined })
    useEditor.setState({ tabs: [{ ...tab('site/x.html'), id: 'q:site/x.html', projectId: 'q' }] })
    await useEditor.getState().save('q:site/x.html')
    await settle()
    expect(uploads()).toHaveLength(3)
    stop()
    expect(bridge.listenerCount('sftp:progress')).toBe(0)
  })
})

describe('remote panel', () => {
  it('shows the server, opens folders, downloads, syncs (asking before overwriting), shows progress and errors', async () => {
    const bridge = server()
    const open = vi.spyOn(useEditor.getState(), 'open').mockResolvedValue()
    vi.spyOn(useEditor.getState(), 'refreshTree').mockResolvedValue()
    await s().load()
    render(<RemotePanel />)
    await act(settle)
    expect(screen.getByText('me@example.com:/var/www')).toBeInTheDocument()
    const tree = screen.getByRole('tree', { name: 'Remote files' })
    fireEvent.click(within(tree).getByRole('treeitem', { name: 'css' }))
    expect(within(tree).getByLabelText('Loading…')).toBeInTheDocument()
    await act(settle)
    expect(within(tree).getByRole('treeitem', { name: 'a.css' })).toBeInTheDocument()
    fireEvent.click(within(tree).getByRole('treeitem', { name: 'index.html' }))
    await act(settle)
    expect(open).toHaveBeenCalledWith('site/index.html')
    fireEvent.click(screen.getByRole('button', { name: 'Download css' }))
    await act(settle)
    expect(bridge.invoke).toHaveBeenCalledWith('sftp:download', { projectId: 'p', target: 'Prod', paths: ['css'] })
    fireEvent.click(screen.getByRole('button', { name: 'Download a.css' }))
    await act(settle)
    expect(screen.getByText('Done: 1 file')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await act(settle)
    expect(within(tree).getByRole('treeitem', { name: 'a.css' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sync local → server' }))
    await act(settle)
    expect(bridge.invoke).toHaveBeenCalledWith('sftp:sync', { projectId: 'p', target: 'Prod', direction: 'up' })
    fireEvent.click(screen.getByRole('button', { name: 'Sync server → local' }))
    const ask = screen.getByRole('alertdialog')
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sync server → local' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Sync server → local' }))
    await act(settle)
    expect(bridge.invoke).toHaveBeenCalledWith('sftp:sync', { projectId: 'p', target: 'Prod', direction: 'down' })

    act(() => useSftp.setState({ busy: true, progress: undefined }))
    expect(screen.getByRole('status')).toHaveTextContent('Connecting …')
    act(() => useSftp.setState({ progress: { projectId: 'p', action: 'download', file: 'site/a.css', done: 1, total: 3 } }))
    expect(screen.getByRole('status')).toHaveTextContent('Downloading 1/3: site/a.css')
    act(() => useSftp.setState({ busy: false, error: 'Timed out while waiting for handshake' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Timed out while waiting for handshake')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('switches between servers; uploading on save is shown', async () => {
    server()
    await s().load()
    render(<RemotePanel />)
    await act(settle)
    fireEvent.click(screen.getByRole('combobox', { name: 'Server' }))
    fireEvent.click(screen.getByRole('option', { name: /Staging/ }))
    await act(settle)
    expect(s().target).toBe('Staging')
    expect(screen.getByText('staging.example.com:/var/www')).toBeInTheDocument()
    expect(screen.getByText('uploads on save')).toBeInTheDocument()
    // Nothing chosen yet: the picker waits for a choice.
    act(() => useSftp.setState({ target: undefined }))
    expect(screen.getByRole('combobox', { name: 'Server' })).toBeInTheDocument()
    act(() => useSftp.setState({ busy: true, progress: { projectId: 'p', action: 'upload', file: 'site/a.css', done: 2, total: 2 } }))
    expect(screen.getByRole('status')).toHaveTextContent('Uploading 2/2: site/a.css')
    expect(de.sftp.progress('upload', 1, 2, 'a')).toBe('Lade hoch 1/2: a')
    expect(de.sftp.progress('download', 1, 2, 'a')).toBe('Lade herunter 1/2: a')
    expect([de.sftp.files(1), de.sftp.files(3)]).toEqual(['1 Datei', '3 Dateien'])
  })

  it('one server: no picker; nothing chosen: no tree', async () => {
    server({ 'sftp:targets': () => [target()] })
    render(<RemotePanel />)
    expect(screen.queryByRole('tree', { name: 'Remote files' })).toBeEmptyDOMElement()
    await act(() => s().load())
    await act(settle)
    expect(screen.queryByRole('combobox', { name: 'Server' })).toBeNull()
  })
})

describe('SFTP in the explorer and the editor', () => {
  it('the explorer menu uploads to / downloads from the server — only inside its folder', async () => {
    server()
    const upload = vi.spyOn(useSftp.getState(), 'upload').mockResolvedValue()
    const download = vi.spyOn(useSftp.getState(), 'download').mockResolvedValue()
    useEditor.setState({ tree: { 'p:': [entry('site', 'dir'), entry('other.txt')], 'p:site': [entry('site/index.html')] }, expanded: { 'p:site': true } })
    render(<FileTree projectId="p" />)
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'other.txt' }))
    expect(screen.queryByRole('menuitem', { name: /Upload to/ })).toBeNull() // no server yet
    fireEvent.keyDown(window, { key: 'Escape' })
    await act(() => s().load())

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'other.txt' }))
    expect(screen.queryByRole('menuitem', { name: /Upload to/ })).toBeNull() // outside site/
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'index.html' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Upload to example.com' }))
    expect(upload).toHaveBeenCalledWith(['site/index.html'])
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'index.html' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download from example.com' }))
    expect(download).toHaveBeenCalledWith(['index.html'])

    // A target for the whole project: paths stay as they are.
    act(() => useSftp.setState({ targets: [target({ context: '' })] }))
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'other.txt' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download from example.com' }))
    expect(download).toHaveBeenLastCalledWith(['other.txt'])
  })

  it('the editor shows the Remote files pane only for projects with a server', async () => {
    let targets = [target()]
    server({
      'sftp:targets': () => targets,
      'files:stat': () => [],
      'scm:status': () => ({ repo: false, ahead: 0, behind: 0, merging: false, files: [] }),
      'debug:session': () => null,
      'liveServer:status': () => []
    })
    useProjects.setState({ projects: [{ id: 'p', name: 'Demo', path: '/x/p', addedAt: '', lastSeenAt: '' }] })
    const view = render(<EditorView active onNavigate={vi.fn()} />)
    await act(settle)
    const nav = screen.getByRole('navigation', { name: 'Editor' })
    fireEvent.click(within(nav).getByRole('button', { name: 'Remote files' }))
    await act(settle)
    expect(screen.getByText('me@example.com:/var/www')).toBeInTheDocument()
    view.unmount()
    targets = []
    render(<EditorView active onNavigate={vi.fn()} />)
    await act(settle)
    expect(within(screen.getByRole('navigation', { name: 'Editor' })).queryByRole('button', { name: 'Remote files' })).toBeNull()
  })
})
