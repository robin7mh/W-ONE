import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { installBridge, installRemote, settle } from './bridge'
import type { LanguageStatus } from '@shared/types/languages'
import type { MigrationSource } from '@shared/types/migrate'
import { LanguagesCard } from '@/features/settings/components/LanguagesCard'
import { MigrateCard } from '@/features/settings/components/MigrateCard'
import { useLanguages } from '@/features/editor/languages'
import { useEditorPrefs } from '@/features/editor/prefs'

const status = (over: Partial<Record<string, LanguageStatus>> = {}): LanguageStatus[] => [
  { id: 'python', name: 'Python', server: { name: 'Pyright', state: 'missing', requires: 'npm', command: 'npm install pyright' }, debugger: { name: 'debugpy', state: 'ready' }, ...over.python },
  { id: 'go', name: 'Go', server: { name: 'gopls', state: 'toolchain', requires: 'go' }, debugger: { name: 'Delve', state: 'toolchain', requires: 'go' }, ...over.go },
  { id: 'swift', name: 'Swift', server: { name: 'SourceKit-LSP', state: 'manual' }, ...over.swift }
]

beforeEach(() => {
  useLanguages.setState({ files: {}, toolsVersion: 0 })
})

describe('Settings → Languages', () => {
  it('lists every language with its server and debugger; installs on request with live output', async () => {
    let release!: () => void
    const bridge = installBridge({
      'tools:status': () => status(),
      'tools:install': () =>
        new Promise((r) => (release = () => r({ ...status()[0], server: { name: 'Pyright', state: 'ready' } })))
    })
    render(<LanguagesCard />)
    expect(screen.getByLabelText('Loading…')).toBeInTheDocument()
    await act(settle)
    const python = screen.getByText('Python').closest('li')!
    expect(python).toHaveTextContent('Pyright')
    expect(python).toHaveTextContent(/debugpy\s*ready/)
    expect(screen.getByText('Go').closest('li')).toHaveTextContent('needs go')
    expect(screen.getByText('Swift').closest('li')).toHaveTextContent('comes with its toolchain')
    expect(within(python).getByText('Pyright').parentElement).toHaveAttribute('title', 'npm install pyright') // what will run

    fireEvent.click(within(python).getByRole('button', { name: 'Install Pyright' }))
    await act(settle)
    expect(bridge.invoke).toHaveBeenCalledWith('tools:install', { id: 'python', part: 'server' })
    expect(within(python).getByRole('button', { name: 'Install Pyright' })).toBeDisabled()
    act(() => {
      bridge.emit('tools:progress', { id: 'python', part: 'server', line: '$ npm install pyright' })
      bridge.emit('tools:progress', { id: 'python', part: 'server', line: 'added 1 package' })
      bridge.emit('tools:progress', { id: 'go', part: 'server', line: 'other log' })
      bridge.emit('tools:progress', { id: 'python', part: 'server', line: 'back again' })
    })
    expect(screen.getByLabelText('Install output')).toHaveTextContent('back again')
    await act(async () => {
      release()
      await settle()
    })
    expect(python).toHaveTextContent(/Pyright\s*ready/)
    expect(screen.queryByLabelText('Install output')).toBeNull()
    expect(useLanguages.getState().toolsVersion).toBe(1) // open files pick their server up
  })

  it('a failed install shows why, under its language; checking again reloads the list', async () => {
    const bridge = installBridge({ 'tools:status': () => status(), 'tools:install': () => Promise.reject(new Error('npm ERR! network')) })
    render(<LanguagesCard />)
    await act(settle)
    fireEvent.click(screen.getByRole('button', { name: 'Install Pyright' }))
    await act(settle)
    expect(screen.getByText('Python').closest('li')).toHaveTextContent('npm ERR! network')
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await act(settle)
    expect(bridge.invoke.mock.calls.filter(([c]) => c === 'tools:status')).toHaveLength(2)
  })

  it('a debugger to install; a core that can’t tell', async () => {
    const bridge = installBridge({
      'tools:status': () => status({ python: { id: 'python', name: 'Python', server: { name: 'Pyright', state: 'ready' }, debugger: { name: 'debugpy', state: 'missing', requires: 'python3' } } }),
      'tools:install': () => status()[0]
    })
    render(<LanguagesCard />)
    await act(settle)
    fireEvent.click(screen.getByRole('button', { name: 'Install debugpy' }))
    await act(settle)
    expect(bridge.invoke).toHaveBeenCalledWith('tools:install', { id: 'python', part: 'debugger' })

    installBridge({ 'tools:status': () => Promise.reject(new Error('remote shells are off')) })
    const { container } = render(<LanguagesCard />)
    await act(settle)
    expect(container).toHaveTextContent('remote shells are off')
  })
})

describe('Settings → moving over from VS Code / Cursor', () => {
  const source = (over: Partial<MigrationSource> = {}): MigrationSource => ({
    app: 'Code',
    name: 'Visual Studio Code',
    settings: 3,
    keybindings: 2,
    snippets: 455,
    extensions: [
      { id: 'mhutchie.git-graph', name: 'Git Graph', fate: 'built-in' },
      { id: 'ms-python.python', name: 'Python', fate: 'language', language: 'python' },
      { id: 'ms-python.debugpy', name: 'Python Debugger', fate: 'language', language: 'python' },
      { id: 'x.lang', name: 'Odd', fate: 'language', language: 'cobol' },
      { id: 'dsznajder.es7', name: 'ES7 snippets', fate: 'snippets' },
      { id: 'zhuangtongfa.theme', name: 'One Dark Pro', fate: 'theme' },
      { id: 'random.tool', name: 'Live Server', fate: 'unsupported' }
    ],
    ...over
  })

  it('shows each app with what comes along and what becomes of its extensions; takes it over', async () => {
    let loaded = 0
    useEditorPrefs.setState({ load: async () => void (loaded += 1) })
    const bridge = installBridge({
      'migrate:scan': () => [source(), source({ app: 'Cursor', name: 'Cursor', settings: 0, keybindings: 0, snippets: 0, extensions: [{ id: 'a.b', name: 'Remote SSH', fate: 'unsupported' }] })],
      'migrate:apply': ({ app }: { app: string }) => (app === 'Cursor' ? Promise.reject(new Error('nothing to take')) : { settings: 3, keybindings: 2, snippets: 455 })
    })
    render(<MigrateCard />)
    await act(settle)
    const code = screen.getByText('Visual Studio Code').closest('li')!
    expect(code).toHaveTextContent('3 editor settings · 2 keybindings · 455 snippets')
    expect(code).toHaveTextContent('Already built into MindeckGit Graph')
    expect(code).toHaveTextContent('Python · Python Debugger · Odd → install under Languages: Python, cobol')
    expect(code).toHaveTextContent('Snippets come alongES7 snippets')
    expect(code).toHaveTextContent('Themes — Mindeck keeps its designOne Dark Pro')
    expect(code).toHaveTextContent('Not in Mindeck yetLive Server')

    fireEvent.click(within(code).getByRole('button', { name: /Take over/ }))
    await act(settle)
    expect(bridge.invoke).toHaveBeenCalledWith('migrate:apply', { app: 'Code' })
    expect(within(code).getByRole('status')).toHaveTextContent('Taken over: 3 settings, 2 keybindings, 455 snippets')
    expect(loaded).toBe(1) // the editor applies them right away

    const cursor = screen.getByText('Cursor').closest('li')!
    expect(cursor).not.toHaveTextContent('Languages')
    fireEvent.click(within(cursor).getByRole('button', { name: /Take over/ }))
    await act(settle)
    expect(within(cursor).getByRole('alert')).toHaveTextContent('nothing to take')
  })

  it('nothing installed; a scan that fails; outside the desktop app', async () => {
    installBridge({ 'migrate:scan': () => [] })
    const { unmount } = render(<MigrateCard />)
    expect(screen.getByLabelText('Loading…')).toBeInTheDocument()
    await act(settle)
    expect(screen.getByText('No VS Code, Cursor, VSCodium or Windsurf found on this computer.')).toBeInTheDocument()
    unmount()

    installBridge({ 'migrate:scan': () => Promise.reject(new Error('no access')) })
    const second = render(<MigrateCard />)
    await act(settle)
    expect(screen.getByText('no access')).toBeInTheDocument()
    second.unmount()

    delete (window as { mindeck?: unknown }).mindeck
    installRemote({})
    render(<MigrateCard />)
    expect(screen.getByText('Moving over works in the Mindeck desktop app.')).toBeInTheDocument()
  })
})
