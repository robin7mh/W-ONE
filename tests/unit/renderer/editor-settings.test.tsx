import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installBridge, settle } from './bridge'

vi.mock('@/features/editor/components/CodeEditor', () => ({ default: () => <div data-testid="monaco" /> }))
vi.mock('@/features/editor/components/DiffView', () => ({ default: () => <div data-testid="diff" /> }))

import type { EditorSettings } from '@shared/types/migrate'
import { EditorCard } from '@/features/settings/components/EditorCard'
import { useEditorPrefs } from '@/features/editor/prefs'
import { useProblems } from '@/features/editor/problems'
import { useLintStatus } from '@/features/editor/lintStatus'
import { EditorView } from '@/features/editor/components/EditorView'
import { useEditor } from '@/features/editor/store'
import { useProjects } from '@/features/projects/store'

const range = (line: number, offset: number) => ({ start: { line, offset }, end: { line, offset: offset + 1 } })

beforeEach(() => {
  useEditorPrefs.setState({ settings: {}, snippets: [] })
  useProblems.setState({ byFile: {} })
  useLintStatus.setState({ errors: {} })
})

describe('Settings → Editor', () => {
  it('shows the settings (W-ONE’s defaults where none are set) and changes them one by one', async () => {
    let saved: EditorSettings = { formatOnSave: true, wordWrap: 'on' }
    const bridge = installBridge({
      'editor:settings': () => ({ settings: saved, snippets: [] }),
      'editor:update': (patch: EditorSettings) => (saved = { ...saved, ...patch })
    })
    render(<EditorCard />)
    await act(settle)
    const sw = (name: string) => screen.getByRole('switch', { name })
    expect(sw('Format on save')).toBeChecked()
    expect(sw('Prettier for every project')).not.toBeChecked()
    expect(sw('ESLint fixes on save')).not.toBeChecked()
    expect(sw('Minimap')).toBeChecked() // W-ONE's default
    expect(sw('Wrap long lines')).toBeChecked()
    fireEvent.click(sw('Prettier for every project'))
    await act(settle)
    expect(bridge.invoke).toHaveBeenLastCalledWith('editor:update', { prettier: true })
    expect(sw('Prettier for every project')).toBeChecked()
    for (const [name, patch] of [
      ['Format on save', { formatOnSave: false }],
      ['ESLint fixes on save', { eslintFixOnSave: true }],
      ['Minimap', { minimap: false }],
      ['Wrap long lines', { wordWrap: 'off' }],
      ['Sticky scroll (the enclosing function stays on top)', { stickyScroll: false }],
      ['Vim mode', { vim: true }]
    ] as const) {
      fireEvent.click(sw(name))
      await act(settle)
      expect(bridge.invoke).toHaveBeenLastCalledWith('editor:update', patch)
    }
    expect(sw('Wrap long lines')).not.toBeChecked()
    fireEvent.click(sw('Wrap long lines'))
    await act(settle)
    expect(bridge.invoke).toHaveBeenLastCalledWith('editor:update', { wordWrap: 'on' })

    const font = screen.getByLabelText('Font size')
    expect(font).toHaveValue(13)
    fireEvent.change(font, { target: { value: '40' } })
    await act(settle)
    expect(bridge.invoke).toHaveBeenLastCalledWith('editor:update', { fontSize: 32 })
    const calls = bridge.invoke.mock.calls.length
    fireEvent.change(font, { target: { value: '3' } }) // too small: ignored
    fireEvent.change(screen.getByLabelText('Tab width'), { target: { value: '0' } })
    expect(bridge.invoke.mock.calls.length).toBe(calls)
    fireEvent.change(screen.getByLabelText('Tab width'), { target: { value: '12' } })
    await act(settle)
    expect(bridge.invoke).toHaveBeenLastCalledWith('editor:update', { tabSize: 8 })
  })
})

describe('problems from more than one tool', () => {
  it('each tool replaces only its own; sorted by position', () => {
    const p = useProblems.getState()
    p.report('p', { 'a.ts': [{ range: range(5, 2), message: 'ts late', severity: 'error' }, { range: range(1, 1), message: 'ts early', severity: 'warning' }] })
    p.report('p', { 'a.ts': [{ range: range(1, 5), message: 'lint', severity: 'error', source: 'eslint' }, { range: range(2, 1), message: 'hint', severity: 'suggestion' }] }, 'eslint')
    expect(useProblems.getState().byFile['p:a.ts'].map((x) => `${x.line}:${x.col} ${x.message}${x.owner ? ` (${x.owner})` : ''}`)).toEqual(['1:1 ts early', '1:5 lint (eslint)', '5:2 ts late'])
    p.report('p', { 'a.ts': [] })
    expect(useProblems.getState().byFile['p:a.ts'].map((x) => x.message)).toEqual(['lint'])
  })
})

describe('ESLint in the status bar', () => {
  it('a broken ESLint shows; a click restarts it', async () => {
    installBridge({
      'files:list': () => [],
      'files:stat': () => [],
      'scm:status': () => ({ repo: false, ahead: 0, behind: 0, merging: false, files: [] }),
      'debug:session': () => null,
      'liveServer:status': () => []
    })
    useEditor.setState({ projectId: 'p' })
    useProjects.setState({ projects: [{ id: 'p', name: 'Demo', path: '/x/p', addedAt: '', lastSeenAt: '' }] })
    render(<EditorView active onNavigate={vi.fn()} />)
    await act(settle)
    expect(screen.queryByRole('button', { name: /ESLint/ })).toBeNull()
    const restart = vi.fn(async () => {})
    act(() => useLintStatus.setState({ errors: { p: "Cannot find package 'x'", q: 'other project' }, restart }))
    const button = screen.getByRole('button', { name: 'ESLint ⚠' })
    expect(button).toHaveAttribute('title', "ESLint: Cannot find package 'x' — click to restart")
    fireEvent.click(button)
    expect(restart).toHaveBeenCalled()
    act(() => useEditor.setState({ projectId: undefined }))
    expect(within(document.body).queryByRole('button', { name: 'ESLint ⚠' })).toBeNull()
  })
})
