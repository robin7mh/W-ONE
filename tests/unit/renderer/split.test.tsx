import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installBridge, settle } from './bridge'
import type { EditorTab } from '@/features/editor/store'

vi.mock('@/features/editor/components/CodeEditor', () => ({
  default: ({ tab, secondary }: { tab?: EditorTab; secondary?: boolean }) => <div data-testid={secondary ? 'right' : 'left'}>{tab?.id ?? 'none'}</div>
}))
vi.mock('@/features/editor/components/DiffView', () => ({ default: () => <div data-testid="diff" /> }))

import { setBufferHost, tabKey, useEditor } from '@/features/editor/store'
import { buildCommands } from '@/features/editor/commands'
import { EditorView } from '@/features/editor/components/EditorView'
import { EditorTabs } from '@/features/editor/components/EditorTabs'
import { useProjects } from '@/features/projects/store'
import { en } from '@/lib/i18n/en'

const initial = useEditor.getState()
const e = () => useEditor.getState()
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
const routes = () =>
  installBridge({
    'files:list': () => [],
    'files:stat': () => [],
    'files:read': ({ path }: { path: string }) => ({ path, mtimeMs: 1, size: 1, content: 'x' }),
    'files:write': () => ({ mtimeMs: 2, size: 1 }),
    'scm:status': () => ({ repo: false, ahead: 0, behind: 0, merging: false, files: [] }),
    'debug:session': () => null,
    'liveServer:status': () => []
  })

beforeEach(() => {
  useEditor.setState(initial, true)
  useEditor.setState({ projectId: 'p' })
  setBufferHost(null)
})

describe('split editor: the store', () => {
  it('splits the focused file, opens and activates in the focused side, saves it, closes the split', async () => {
    const bridge = routes()
    e().split() // nothing open: nothing to split
    expect(e().splitId).toBeUndefined()
    e().focusGroup(true) // no split: the left keeps the focus
    expect(e().focusRight).toBe(false)
    await e().open('a.ts')
    e().split()
    expect(e()).toMatchObject({ splitId: 'p:a.ts', focusRight: true, activeId: 'p:a.ts' })
    await e().open('b.ts') // opens on the right
    expect(e()).toMatchObject({ splitId: 'p:b.ts', activeId: 'p:a.ts' })
    expect(e().focusedId()).toBe('p:b.ts')
    e().focusGroup(false)
    e().setActive('p:b.ts')
    expect(e()).toMatchObject({ activeId: 'p:b.ts', splitId: 'p:b.ts' })
    expect(e().focusedId()).toBe('p:b.ts')
    e().focusGroup(true)
    e().setActive('p:a.ts')
    expect(e().splitId).toBe('p:a.ts')
    // ⌘S saves the focused side's file.
    setBufferHost({ snapshot: () => ({ text: 'new', version: 2 }), markClean: () => {}, drop: () => {}, rekey: () => {} })
    useEditor.setState((s) => ({ tabs: s.tabs.map((t) => ({ ...t, dirty: true })) }))
    await e().save()
    expect(bridge.invoke).toHaveBeenCalledWith('files:write', expect.objectContaining({ path: 'a.ts' }))
    e().closeSplit()
    expect(e().focusRight).toBe(false)
    expect(e().splitId).toBeUndefined()
    e().split('p:b.ts')
    expect(e().splitId).toBe('p:b.ts')
  })

  it('closing the right file ends the split; open to the side (splitting first); renames follow', async () => {
    routes()
    await e().openToSide('a.ts') // nothing open yet: just opens
    expect(e().activeId).toBe('p:a.ts')
    expect(e().splitId).toBeUndefined()
    await e().openToSide('b.ts')
    expect(e()).toMatchObject({ activeId: 'p:a.ts', splitId: 'p:b.ts', focusRight: true })
    await e().openToSide('c.ts') // already split: replaces the right file
    expect(e().splitId).toBe('p:c.ts')
    e().close('p:b.ts')
    expect(e().splitId).toBe('p:c.ts')
    e().close('p:c.ts')
    expect(e()).toMatchObject({ focusRight: false, activeId: 'p:a.ts' })
    expect(e().splitId).toBeUndefined()
  })
})

describe('split editor: the view', () => {
  const show = () => {
    useProjects.setState({ projects: [{ id: 'p', name: 'Demo', path: '/x/p', addedAt: '', lastSeenAt: '' }] })
    return render(<EditorView active onNavigate={vi.fn()} />)
  }

  it('two editors side by side: focus follows the click, the status bar the focus; ⌘\\ toggles; the right one closes', async () => {
    routes()
    useEditor.setState({ tabs: [tab('a.ts'), tab('b.ts', { dirty: true })], activeId: 'p:a.ts' })
    show()
    await act(settle)
    expect(screen.queryByTestId('right')).toBeNull()
    fireEvent.keyDown(window, { key: '\\', metaKey: true })
    expect(await screen.findByTestId('right')).toHaveTextContent('p:a.ts')
    act(() => e().setActive('p:b.ts'))
    expect(screen.getByTestId('right')).toHaveTextContent('p:b.ts')
    const right = screen.getByRole('region', { name: 'Right editor: b.ts' })
    expect(within(right).getByText('b.ts')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Demo › b.ts')
    fireEvent.mouseDown(screen.getByTestId('left'))
    expect(e().focusRight).toBe(false)
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Demo › a.ts')
    fireEvent.mouseDown(screen.getByTestId('right'))
    expect(e().focusRight).toBe(true)
    fireEvent.click(within(right).getByRole('button', { name: 'Close the split' }))
    expect(screen.queryByTestId('right')).toBeNull()
    fireEvent.keyDown(window, { key: '\\', metaKey: true })
    expect(await screen.findByTestId('right')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true })
    expect(screen.queryByTestId('right')).toBeNull()
  })

  it('a right file still loading shows the placeholder there', async () => {
    routes()
    useEditor.setState({ tabs: [tab('a.ts'), tab('big.bin', { content: undefined, loading: true })], activeId: 'p:a.ts', splitId: 'p:big.bin', focusRight: true })
    show()
    await act(settle)
    expect(within(screen.getByRole('region', { name: 'Right editor: big.bin' })).getByText(/Loading/)).toBeInTheDocument()
  })

  it('the tab bar marks the right file; the palette toggles the split', () => {
    useEditor.setState({ tabs: [tab('a.ts'), tab('b.ts')], activeId: 'p:a.ts', splitId: 'p:b.ts' })
    render(<EditorTabs projectNames={new Map()} />)
    expect(screen.getAllByLabelText('Shown on the right')).toHaveLength(1)
    const toggle = () => buildCommands(en, { readOnly: false }).find((c) => c.id === 'view.split')!
    expect(toggle().keys).toBe('⌘\\')
    act(() => void toggle().run())
    expect(e().splitId).toBeUndefined()
    act(() => void toggle().run())
    expect(e().splitId).toBe('p:a.ts')
  })
})
