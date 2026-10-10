import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, installBridge, settle } from './bridge'
import type { AgentAvailability, AgentSession } from '@shared/types/agents'
import type { ChatMessage, PermissionRequest } from '@shared/types/ai'
import type { WoneEvent } from '@shared/types/events'

// --- xterm (the session's terminal) and Monaco (diffs): jsdom runs neither ----------
const x = vi.hoisted(() => ({
  terms: [] as { written: string[]; focus: ReturnType<typeof vi.fn>; disposed: boolean }[],
  fitThrows: false,
  diff: { created: 0, models: [] as { value: string; path: string; disposed: boolean }[], disposed: 0 }
}))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown> = {}
    written: string[] = []
    focus = vi.fn()
    disposed = false
    constructor() {
      x.terms.push(this)
    }
    loadAddon() {}
    open() {}
    write(d: string) {
      this.written.push(d)
    }
    onData() {
      return { dispose: vi.fn() }
    }
    onResize() {
      return { dispose: vi.fn() }
    }
    dispose() {
      this.disposed = true
    }
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn(() => {
      if (x.fitThrows) throw new Error('not measurable')
    })
  }
}))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@/features/editor/monaco/setup', () => ({
  THEME: 'wone',
  applyMonacoTheme: vi.fn(),
  monaco: {
    Uri: { file: (path: string) => ({ path }) },
    editor: {
      createModel: (value: string, _l: unknown, uri: { path: string }) => {
        const m = { value, path: uri.path, disposed: false, dispose: () => (m.disposed = true) }
        x.diff.models.push(m)
        return m
      },
      createDiffEditor: () => {
        x.diff.created += 1
        return { setModel: vi.fn(), dispose: () => (x.diff.disposed += 1) }
      }
    }
  }
}))

import { useAgents, useActiveSession } from '@/features/agents/sessions'
import { useAssistant } from '@/features/agents/store'
import { describeEvent } from '@/features/agents/format'
import { AgentsView } from '@/features/agents/components/AgentsView'
import { NewChatDialog } from '@/features/agents/components/NewChatDialog'
import { SessionPane } from '@/features/agents/components/SessionPane'
import { DiffModal, SessionSide } from '@/features/agents/components/SessionSide'
import { AssistantPane } from '@/features/agents/components/AssistantPane'
import { useProjects } from '@/features/projects/store'

const initialAgents = useAgents.getState()
const initialAssistant = useAssistant.getState()
beforeEach(() => {
  useAgents.setState(initialAgents, true)
  useAssistant.setState(initialAssistant, true)
  useProjects.setState({ projects: [project('p1', 'Demo'), project('p2', 'Site')], selectedId: undefined, load: vi.fn(async () => {}) })
  x.terms.length = 0
  x.fitThrows = false
  x.diff = { created: 0, models: [], disposed: 0 }
})

function project(id: string, name: string) {
  return { id, name, path: `/code/${id}`, addedAt: '', lastSeenAt: '' }
}
const session = (over: Partial<AgentSession> = {}): AgentSession => ({
  id: 's1',
  kind: 'claude-code',
  projectId: 'p1',
  projectName: 'Demo',
  title: 'Fix login',
  cwd: '/code/p1',
  isolated: false,
  status: 'idle',
  live: true,
  terminalId: 'pty1',
  plan: [],
  notes: [],
  createdAt: '2026-10-03T08:00:00.000Z',
  updatedAt: '2026-10-03T09:00:00.000Z',
  ...over
})
const claude = (over: Partial<AgentAvailability> = {}): AgentAvailability => ({
  kind: 'claude-code',
  name: 'Claude Code',
  installed: true,
  version: '2.1.287',
  signedIn: true,
  account: 'Pro plan',
  ready: true,
  ...over
})
const codex: AgentAvailability = { kind: 'codex', name: 'Codex', installed: true, version: '1.0.0', ready: false, hint: 'Coming to W-ONE soon' }
const msg = (id: string, role: ChatMessage['role'], text: string): ChatMessage => ({ id, role, parts: [{ type: 'text', text }], createdAt: '', status: 'done' })
const ag = () => useAgents.getState()

describe('useAgents store', () => {
  it('connects once (ref-counted), follows pushes and unsubscribes at the end', async () => {
    const bridge = installBridge({ 'agents:list': () => [session()] })
    const off1 = ag().connect()
    const off2 = ag().connect()
    await act(settle)
    expect(bridge.invoke.mock.calls.filter((c) => c[0] === 'agents:list')).toHaveLength(1)
    expect(ag().sessions).toHaveLength(1)

    act(() => bridge.emit('agents:changed', { session: session({ id: 's2', updatedAt: '2026-10-03T10:00:00.000Z' }) }))
    act(() => bridge.emit('agents:changed', { session: session({ status: 'working' }) }))
    expect(ag().sessions.map((s) => [s.id, s.status])).toEqual([
      ['s2', 'idle'],
      ['s1', 'working']
    ])
    act(() => bridge.emit('agents:message', { sessionId: 's1', message: msg('m', 'user', 'hi') })) // not loaded: ignored
    expect(ag().messages.s1).toBeUndefined()
    useAgents.setState({ messages: { s1: [] }, activeId: 's1', view: 'session' })
    act(() => bridge.emit('agents:message', { sessionId: 's1', message: msg('m', 'user', 'hi') }))
    expect(ag().messages.s1).toHaveLength(1)
    act(() => bridge.emit('agents:changed', { removed: 's2' }))
    expect(ag().view).toBe('session') // another one was removed
    act(() => bridge.emit('agents:changed', { removed: 's1' }))
    expect(ag()).toMatchObject({ sessions: [], activeId: undefined, view: 'empty' })

    off1()
    off2()
    expect(bridge.listenerCount('agents:changed')).toBe(0)
  })

  it('refresh and detect report failures; the dialog detects agents', async () => {
    installBridge({ 'agents:list': () => fail('core down'), 'agents:detect': () => fail('probe failed') })
    await ag().refresh()
    expect(ag().error).toBe('core down')
    ag().openDialog('Fix it')
    expect(ag().dialog).toEqual({ prompt: 'Fix it' })
    await act(settle)
    expect(ag()).toMatchObject({ detecting: false, error: 'probe failed' })
    ag().closeDialog()
    expect(ag().dialog).toBeUndefined()
    installBridge({ 'agents:detect': () => [claude()] })
    await ag().detect()
    expect(ag().availability).toEqual([claude()])
  })

  it('create, open, send and the session actions', async () => {
    const calls: [string, unknown][] = []
    const route = (ch: string, value: unknown) => (p: unknown) => {
      calls.push([ch, p])
      return value
    }
    installBridge({
      'agents:create': route('agents:create', session({ id: 's9' })),
      'agents:get': route('agents:get', { ...session({ id: 's9', status: 'working' }), messages: [msg('u', 'user', 'go')] }),
      'agents:send': route('agents:send', undefined),
      'agents:interrupt': route('agents:interrupt', undefined),
      'agents:stop': route('agents:stop', undefined),
      'agents:resume': route('agents:resume', session()),
      'agents:changes': route('agents:changes', [{ path: 'a.ts', status: 'modified', added: 1, removed: 0 }]),
      'agents:branch': route('agents:branch', { pushed: true, merged: false, uncommitted: 0 }),
      'agents:diff': route('agents:diff', { path: 'a.ts', original: 'a', modified: 'b' }),
      'agents:accept': route('agents:accept', { files: 1 }),
      'agents:discard': route('agents:discard', undefined),
      'agents:remove': route('agents:remove', undefined)
    })
    expect(await ag().send('nobody listening')).toBe(false) // no active session
    await ag().interrupt() // no active session: nothing
    useAgents.setState({ dialog: {} })
    expect(await ag().create({ kind: 'claude-code', projectId: 'p1', prompt: 'go' })).toBe(true)
    expect(ag()).toMatchObject({ activeId: 's9', view: 'session', dialog: undefined, busy: false, messages: { s9: [] } })
    await ag().open('s9')
    expect(ag().messages.s9).toHaveLength(1)
    expect(ag().sessions[0].status).toBe('working')

    expect(await ag().send('hello')).toBe(true)
    await ag().interrupt()
    await ag().stop()
    await ag().resume('other')
    await ag().loadChanges()
    expect(ag().changes.s9).toHaveLength(1)
    await ag().loadBranch()
    expect(ag().branches.s9).toEqual({ pushed: true, merged: false, uncommitted: 0 })
    await ag().showDiff('a.ts')
    expect(ag().diff).toEqual({ path: 'a.ts', original: 'a', modified: 'b' })
    ag().closeDiff()
    expect(ag().diff).toBeUndefined()
    await ag().accept()
    expect(ag().changes.s9).toEqual([])
    await ag().discard()
    expect(ag().busy).toBe(false)
    expect(calls.map(([c]) => c)).toEqual([
      'agents:create',
      'agents:get',
      'agents:send',
      'agents:interrupt',
      'agents:stop',
      'agents:resume',
      'agents:changes',
      'agents:branch',
      'agents:diff',
      'agents:accept',
      'agents:discard'
    ])
    expect(calls[5][1]).toEqual({ id: 'other' })

    useAgents.setState({ sessions: [session({ id: 'keep' }), ...ag().sessions] })
    await ag().remove('keep') // not the active one
    expect(ag().activeId).toBe('s9')
    await ag().remove('s9')
    expect(ag()).toMatchObject({ activeId: undefined, view: 'empty', sessions: [] })
    ag().showAssistant()
    expect(ag().view).toBe('assistant')
  })

  it('rename, a shell for the session, VS Code', async () => {
    installBridge({
      'agents:rename': ({ title }: { title: string }) => session({ title }),
      'agents:shell': () => ({ terminalId: 'sh1' }),
      'agents:openInEditor': () => undefined
    })
    useAgents.setState({ sessions: [session()] })
    await ag().rename('s1', 'Auth fix')
    expect(ag().sessions[0].title).toBe('Auth fix')
    expect(await ag().openShell('s1')).toBe('sh1')
    await ag().openInEditor('s1')
    expect(ag().error).toBeUndefined()

    installBridge({ 'agents:shell': () => fail('folder gone') })
    expect(await ag().openShell('s1')).toBeUndefined()
    expect(ag().error).toBe('folder gone')
  })

  it('failures land in error (and clear)', async () => {
    installBridge({
      'agents:create': () => fail('no claude'),
      'agents:get': () => fail('gone'),
      'agents:send': () => fail('not running'),
      'agents:accept': () => fail('conflict')
    })
    expect(await ag().create({ kind: 'claude-code', projectId: 'p1' })).toBe(false)
    expect(ag()).toMatchObject({ error: 'no claude', busy: false })
    await ag().open('s1')
    expect(ag().error).toBe('gone')
    expect(await ag().send('x')).toBe(false)
    expect(ag().error).toBe('not running')
    await ag().accept()
    expect(ag()).toMatchObject({ error: 'conflict', busy: false })
    ag().clearError()
    expect(ag().error).toBeUndefined()
  })

  it('useActiveSession: the open session and its messages', () => {
    let seen: ReturnType<typeof useActiveSession> | undefined
    const Probe = () => {
      seen = useActiveSession()
      return null
    }
    render(<Probe />)
    expect(seen).toEqual({ session: undefined, messages: [] })
    act(() => useAgents.setState({ sessions: [session()], activeId: 's1', messages: { s1: [msg('m', 'user', 'x')] } }))
    expect(seen!.session!.id).toBe('s1')
    expect(seen!.messages).toHaveLength(1)
  })

  it('describes session events for the activity timeline', () => {
    const e = (type: string, payload: Record<string, unknown>) => ({ id: '1', type, ts: '', actor: { kind: 'agent' }, payload }) as WoneEvent
    expect(describeEvent(e('session.started', { agent: 'Claude Code', title: 'Fix login' }))).toEqual({ text: 'Claude Code started: Fix login', tone: 'cyan' })
    expect(describeEvent(e('session.started', {}))).toEqual({ text: 'Agent started:', tone: 'cyan' })
    expect(describeEvent(e('session.ended', { code: 2 }))).toEqual({ text: 'Session ended (exit code 2)', tone: 'warn' })
    expect(describeEvent(e('session.ended', { code: 0 }))).toEqual({ text: 'Session ended', tone: 'muted' })
  })
})

describe('NewChatDialog', () => {
  const dialog = (props: { prompt?: string; onOpenSettings?: () => void } = {}) => render(<NewChatDialog onOpenSettings={props.onOpenSettings ?? vi.fn()} prompt={props.prompt} />)

  it('picks the ready agent, the project, an own folder when the project is busy; starts with the first message', async () => {
    const create = vi.fn(async () => true)
    useAgents.setState({ availability: [claude(), codex], create, sessions: [session({ projectId: 'p1', terminalId: 'x' })] })
    useProjects.setState({ selectedId: 'p1' })
    dialog({ prompt: 'Fix the login' })
    expect(screen.getByRole('button', { name: /Claude Code/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Pro plan · v2.1.287')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Codex/ })).toBeDisabled()
    expect(screen.getByText('Coming to W-ONE soon')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /W-ONE Assistant/ })).toBeDisabled() // no API key
    expect(screen.getByLabelText('Own working folder')).toBeChecked() // another agent works in p1
    expect(screen.getByText(/Another agent works in this project/)).toBeInTheDocument()
    expect(screen.getByLabelText('First message')).toHaveValue('Fix the login')

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p2' } })
    expect(screen.getByLabelText('Own working folder')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('Own working folder'))
    fireEvent.click(screen.getByText('Start'))
    await act(settle)
    expect(create).toHaveBeenCalledWith({ kind: 'claude-code', projectId: 'p2', isolated: true, prompt: 'Fix the login' })

    fireEvent.change(screen.getByLabelText('First message'), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Start'))
    await act(settle)
    expect(create).toHaveBeenLastCalledWith({ kind: 'claude-code', projectId: 'p2', isolated: true, prompt: undefined })
  })

  it('W-ONE Assistant: chosen when no agent is ready; sends the first message into a new assistant chat', async () => {
    const a = { newChat: vi.fn(), setProject: vi.fn(), send: vi.fn(async () => true) }
    useAssistant.setState({ status: { configured: true, source: 'stored', settings: { model: 'm', effort: 'high' } }, ...a })
    useAgents.setState({ availability: [claude({ ready: false, signedIn: false, hint: 'Sign in once: claude auth login' })] })
    dialog({ prompt: 'Hello' })
    await act(settle)
    expect(screen.getByRole('button', { name: /W-ONE Assistant/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Sign in once: claude auth login')).toBeInTheDocument()
    expect(screen.queryByLabelText('Own working folder')).toBeNull()
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '' } }) // "No project" exists for the assistant
    fireEvent.click(screen.getByText('Start'))
    await act(settle)
    expect(a.newChat).toHaveBeenCalledWith('assistant')
    expect(a.setProject).toHaveBeenCalledWith(undefined)
    expect(a.send).toHaveBeenCalledWith('Hello')
    expect(ag().view).toBe('assistant')
  })

  it('assistant without a first message; switching between agents', async () => {
    const a = { newChat: vi.fn(), setProject: vi.fn(), send: vi.fn(async () => true) }
    useAssistant.setState({ status: { configured: true, source: 'stored', settings: { model: 'm', effort: 'high' } }, ...a })
    useAgents.setState({ availability: [claude()], create: vi.fn(async () => true) })
    dialog()
    fireEvent.click(screen.getByRole('button', { name: /W-ONE Assistant/ }))
    fireEvent.click(screen.getByText('Start'))
    await act(settle)
    expect(a.setProject).toHaveBeenCalledWith('p1')
    expect(a.send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Claude Code/ }))
    expect(screen.getByLabelText('Own working folder')).toBeInTheDocument()
  })

  it('waits for detection, links to Settings, closes; no projects / no choice: nothing to start', async () => {
    const onOpenSettings = vi.fn()
    useAgents.setState({ detecting: true, availability: [] })
    useProjects.setState({ projects: [] })
    dialog({ onOpenSettings })
    expect(screen.getByText('Looking for your agents…')).toBeInTheDocument()
    expect(screen.getByText('Add a project in Projects first.')).toBeInTheDocument()
    expect(screen.getByText('Start')).toBeDisabled()
    fireEvent.submit(screen.getByText('Start').closest('form')!) // no choice: ignored
    fireEvent.click(screen.getByText(/API keys and agent sign-in live in Settings/))
    expect(onOpenSettings).toHaveBeenCalled()

    useAgents.setState({ dialog: {}, detecting: false, availability: [claude()], error: 'no claude', busy: true })
    await act(settle)
    expect(screen.getByText('no claude')).toBeInTheDocument()
    expect(screen.getByText('Start').querySelector('.animate-spin')).not.toBeNull()
    act(() => useAgents.setState({ busy: false }))
    fireEvent.submit(screen.getByText('Start').closest('form')!) // no project: ignored
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' })
    expect(ag().dialog).toEqual({})
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(ag().dialog).toBeUndefined()
    useAgents.setState({ dialog: {} })
    fireEvent.click(screen.getByLabelText('Close'))
    useAgents.setState({ dialog: {} })
    fireEvent.click(screen.getByText('Cancel'))
    expect(ag().dialog).toBeUndefined()
  })
})

describe('SessionPane', () => {
  const pane = (s: AgentSession, messages: ChatMessage[] = []) => render(<SessionPane session={s} messages={messages} />)

  it('starting: explains, shows the terminal by itself; ends', async () => {
    installBridge({ 'terminal:attach': () => ({ buffer: 'trust?', end: 6 }) })
    const stop = vi.fn(async () => {})
    useAgents.setState({ stop })
    pane(session({ status: 'starting', branch: 'wone/abc' }))
    expect(screen.getByText(/Claude Code is starting/)).toBeInTheDocument()
    expect(screen.getByText(/wone\/abc/)).toBeInTheDocument()
    expect(screen.getByText('· Starting…')).toBeInTheDocument()
    await act(settle)
    expect(x.terms).toHaveLength(1)
    expect(x.terms[0].written).toContain('trust?')
    expect(screen.getByLabelText('Hide terminal')).toBeInTheDocument()
    await act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))))
    expect(x.terms[0].focus).toHaveBeenCalled() // ready to answer the prompt
    fireEvent.click(screen.getByLabelText('End session'))
    expect(stop).toHaveBeenCalledWith('s1')
  })

  it('working: interrupt, terminal toggle, approvals inline, messages go to the agent', async () => {
    const bridge = installBridge({ 'terminal:attach': () => ({ buffer: '', end: 0 }) })
    const interrupt = vi.fn(async () => {})
    const send = vi.fn(async () => true)
    const respond = vi.fn(async () => {})
    const req = { id: 'req1', conversationId: 's1', toolTitle: 'Run command', risk: 'execute', summary: 'Run command: npm test', allowAlways: false } as PermissionRequest
    useAgents.setState({ interrupt, send })
    useAssistant.setState({ pending: [req, { ...req, id: 'other', conversationId: 'x' }], respond })
    const messages: ChatMessage[] = [
      msg('u', 'user', 'run the tests'),
      { id: 'a', role: 'assistant', createdAt: '', status: 'streaming', parts: [{ type: 'tool', id: 't', name: 'Bash', title: 'Run command', risk: 'execute', input: { command: 'npm test' }, status: 'awaiting-approval', requestId: 'req1' }] }
    ]
    const { rerender } = pane(session({ status: 'approval' }), messages)
    expect(screen.getByText('· Needs your approval')).toBeInTheDocument()
    expect(x.terms).toHaveLength(0) // terminal only on request
    fireEvent.click(screen.getByLabelText('Interrupt'))
    fireEvent.click(screen.getByLabelText('Stop')) // the composer's stop does the same
    expect(interrupt).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByText('Allow once'))
    expect(respond).toHaveBeenCalledWith('req1', 'once')

    fireEvent.click(screen.getByLabelText('Show terminal'))
    await act(settle)
    expect(x.terms).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('Hide terminal'))
    expect(x.terms[0].disposed).toBe(true)

    rerender(<SessionPane session={session({ status: 'idle' })} messages={messages} />)
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'next step' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })
    await act(settle)
    expect(send).toHaveBeenCalledWith('next step')
    expect(screen.queryByLabelText('Interrupt')).toBeNull()
    void bridge
  })

  it('waiting: the terminal opens (even when it can\'t be measured yet); its end is noted', async () => {
    const bridge = installBridge({ 'terminal:attach': () => ({ buffer: '', end: 0 }) })
    x.fitThrows = true
    pane(session({ status: 'waiting' }))
    await act(settle)
    await act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))))
    expect(x.terms[0].focus).toHaveBeenCalled()
    act(() => bridge.emit('terminal:exit', { id: 'pty1', exitCode: 0 }))
    expect(x.terms[0].written.join('')).toContain('[the agent ended]')
  })

  it('ended: resume; errors from the session and the store (dismissible); empty state', async () => {
    const resume = vi.fn(async () => {})
    const clearError = vi.fn()
    useAgents.setState({ resume, clearError, error: 'not running' })
    const { rerender } = pane(session({ status: 'error', live: false, terminalId: undefined, error: 'Claude Code stopped right away' }))
    expect(screen.getByText('not running')).toBeInTheDocument() // the newer, store error wins
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(clearError).toHaveBeenCalled()
    act(() => useAgents.setState({ error: undefined }))
    rerender(<SessionPane session={session({ status: 'error', live: false, terminalId: undefined, error: 'Claude Code stopped right away' })} messages={[]} />)
    expect(screen.getByText('Claude Code stopped right away')).toBeInTheDocument()
    expect(screen.queryByLabelText('Dismiss')).toBeNull()
    expect(screen.getByText(/Runs with your own Claude Code sign-in/)).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toBeDisabled()
    expect(screen.getByLabelText('Message')).toHaveAttribute('placeholder', 'Resume the session to continue')
    expect(screen.getByLabelText('Show terminal')).toHaveAttribute('title', "A shell in the session's folder") // the agent's own is gone
    expect(screen.queryByText('VS Code')).toBeNull() // no desktop bridge
    fireEvent.click(screen.getByLabelText('Resume'))
    expect(resume).toHaveBeenCalledWith('s1')
  })

  it('the name: click, edit, Enter or leaving saves; Esc or nothing new keeps it', () => {
    const rename = vi.fn(async () => {})
    useAgents.setState({ rename })
    const { rerender } = pane(session())
    const input = screen.getByLabelText('Session name')
    expect(input).toHaveValue('Fix login')
    fireEvent.change(input, { target: { value: '  Auth fix ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(rename).toHaveBeenCalledWith('s1', 'Auth fix')

    rerender(<SessionPane session={session({ title: 'Auth fix' })} messages={[]} />)
    const fresh = screen.getByLabelText('Session name')
    expect(fresh).toHaveValue('Auth fix')
    fireEvent.change(fresh, { target: { value: 'Oops' } })
    fireEvent.keyDown(fresh, { key: 'Escape' })
    expect(fresh).toHaveValue('Auth fix')
    fireEvent.change(fresh, { target: { value: '   ' } })
    fireEvent.blur(fresh)
    expect(fresh).toHaveValue('Auth fix')
    fireEvent.keyDown(fresh, { key: 'a' })
    expect(rename).toHaveBeenCalledTimes(1)
  })

  it('the repo page (GitHub, GitLab, any host) and the folder in VS Code', () => {
    installBridge()
    const openInEditor = vi.fn(async () => {})
    useAgents.setState({ openInEditor })
    const { rerender } = pane(session({ repoUrl: 'https://github.com/me/demo', worktree: '/wt', cwd: '/wt' }))
    expect(screen.getByText('GitHub').closest('a')).toHaveAttribute('href', 'https://github.com/me/demo')
    fireEvent.click(screen.getByText('VS Code'))
    expect(openInEditor).toHaveBeenCalledWith('s1')
    expect(screen.getByText('VS Code').closest('button')).toHaveAttribute('title', 'Open /wt in VS Code')

    rerender(<SessionPane session={session({ repoUrl: 'https://gitlab.example.com/g/demo' })} messages={[]} />)
    expect(screen.getByText('GitLab')).toBeInTheDocument()
    rerender(<SessionPane session={session({ repoUrl: 'https://git.example.org/me/demo' })} messages={[]} />)
    expect(screen.getByText('git.example.org')).toBeInTheDocument()
    rerender(<SessionPane session={session()} messages={[]} />)
    expect(screen.queryByText('git.example.org')).toBeNull()
  })
})

describe('SessionPane for ACP agents', () => {
  it('Codex: no terminal of its own; starting needs nothing from the user; messages go to the agent', () => {
    render(<SessionPane session={session({ kind: 'codex', status: 'starting', terminalId: undefined })} messages={[]} />)
    expect(screen.getByText('Codex is starting.')).toBeInTheDocument()
    expect(screen.getByLabelText('Show terminal')).toBeInTheDocument() // a shell, on request only
    expect(screen.queryByLabelText('Hide terminal')).toBeNull()
    expect(screen.getByText('Codex · Demo')).toBeInTheDocument()
    expect(screen.getByText(/Runs with your own Codex sign-in/)).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveAttribute('placeholder', 'Message Codex…')
    expect(x.terms).toHaveLength(0)
  })
})

describe('SessionPane: a shell for agents without a terminal', () => {
  it('opens a shell in the session\'s folder on request, hides it, notes its end; a failure shows nothing', async () => {
    const bridge = installBridge({ 'terminal:attach': () => ({ buffer: '$ ', end: 2 }) })
    const openShell = vi.fn(async () => 'sh1')
    useAgents.setState({ openShell })
    render(<SessionPane session={session({ kind: 'codex', terminalId: undefined })} messages={[]} />)
    fireEvent.click(screen.getByLabelText('Show terminal'))
    await act(settle)
    expect(openShell).toHaveBeenCalledWith('s1')
    expect(x.terms).toHaveLength(1)
    expect(x.terms[0].written).toContain('$ ')
    act(() => bridge.emit('terminal:exit', { id: 'sh1', exitCode: 0 }))
    expect(x.terms[0].written.join('')).toContain('[the shell ended]')
    fireEvent.click(screen.getByLabelText('Hide terminal'))
    expect(x.terms[0].disposed).toBe(true)

    openShell.mockResolvedValueOnce(undefined as never)
    fireEvent.click(screen.getByLabelText('Show terminal'))
    await act(settle)
    expect(x.terms).toHaveLength(1)
    expect(screen.getByLabelText('Show terminal')).toBeInTheDocument()
  })
})

describe('SessionSide and diffs', () => {
  it('changes with diffs; own working folder: take over or (after asking) discard', async () => {
    const loadChanges = vi.fn(async () => {})
    const loadBranch = vi.fn(async () => {})
    const showDiff = vi.fn(async () => {})
    const accept = vi.fn(async () => {})
    const discard = vi.fn(async () => {})
    useAgents.setState({
      loadChanges,
      loadBranch,
      showDiff,
      accept,
      discard,
      changes: {
        s1: [
          { path: 'a.ts', status: 'modified', added: 2, removed: 1 },
          { path: 'new.ts', status: 'added', added: 5, removed: 0 },
          { path: 'old.ts', status: 'deleted', added: 0, removed: 3 }
        ]
      }
    })
    const { rerender } = render(<SessionSide session={session({ worktree: '/wt', branch: 'wone/x' })} onOpenNote={vi.fn()} />)
    expect(loadChanges).toHaveBeenCalledWith('s1')
    expect(loadBranch).toHaveBeenCalledWith('s1')
    expect(screen.getByText('In its own working folder')).toBeInTheDocument()
    expect(screen.getByText('/wt')).toBeInTheDocument()
    expect(screen.getByText(/not on GitHub/)).toBeInTheDocument()
    act(() => useAgents.setState({ branches: { s1: { pushed: true, merged: false, uncommitted: 0 } } }))
    expect(screen.getByText(/also on GitHub/)).toBeInTheDocument()
    act(() => useAgents.setState({ branches: { s1: { pushed: true, pr: { number: 7, url: 'https://github.com/me/web/pull/7', state: 'open' }, merged: false, uncommitted: 0 } } }))
    expect(screen.getByText('— PR #7 open.').closest('a')).toHaveAttribute('href', 'https://github.com/me/web/pull/7')
    expect(screen.getByText(/commit and push them as usual/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Changes 3' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByText(/^[AMD]$/).map((n) => n.textContent)).toEqual(['M', 'A', 'D'])
    fireEvent.click(screen.getByText('a.ts'))
    expect(showDiff).toHaveBeenCalledWith('a.ts')
    fireEvent.click(screen.getByLabelText('Refresh changes'))
    expect(loadChanges).toHaveBeenCalledTimes(2)

    act(() => useAgents.setState({ busy: true }))
    expect(screen.getByText('Take over').closest('button')).toBeDisabled()
    act(() => useAgents.setState({ busy: false }))
    fireEvent.click(screen.getByText('Take over'))
    expect(accept).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Discard changes'))
    fireEvent.click(screen.getByText('Keep'))
    expect(discard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Discard changes'))
    fireEvent.click(screen.getByText('Discard'))
    expect(discard).toHaveBeenCalled()

    rerender(<SessionSide session={session({ status: 'working' })} onOpenNote={vi.fn()} />)
    expect(loadChanges).toHaveBeenCalledTimes(3) // a new step finished
    expect(screen.getByText('Since the session started')).toBeInTheDocument()
    expect(screen.queryByText('Take over')).toBeNull()
  })

  it('a merged pull request: update the project and clean up (asking first when files would be lost); fresh on focus and every minute', async () => {
    const loadChanges = vi.fn(async () => {})
    const loadBranch = vi.fn(async () => {})
    const discard = vi.fn(async () => {})
    let finish: (error?: string) => void = () => {}
    const pull = vi.fn((_id: string) => new Promise<string | undefined>((r) => (finish = r)))
    useProjects.setState({ pull })
    useAgents.setState({
      loadChanges,
      loadBranch,
      discard,
      changes: { s1: [{ path: 'a.ts', status: 'modified', added: 1, removed: 0 }] },
      branches: { s1: { pushed: true, pr: { number: 1, url: 'https://github.com/me/web/pull/1', state: 'merged' }, merged: true, uncommitted: 0 } }
    })
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { rerender, unmount } = render(<SessionSide session={session({ worktree: '/wt', branch: 'wone/x' })} onOpenNote={vi.fn()} />)
    expect(screen.getByText('Merged on GitHub')).toBeInTheDocument()
    expect(screen.getByText('— PR #1 merged.').closest('a')).toHaveAttribute('href', 'https://github.com/me/web/pull/1')
    expect(screen.queryByText('Take over')).toBeNull() // the work is in main already

    fireEvent.click(screen.getByText('Update project'))
    expect(pull).toHaveBeenCalledWith('p1')
    expect(screen.getByText('Update project').closest('button')).toBeDisabled()
    await act(async () => finish())
    expect(screen.getByText('The project is up to date.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Update project'))
    await act(async () => finish('fatal: Not possible to fast-forward'))
    expect(screen.getByText('fatal: Not possible to fast-forward')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Clean up')) // nothing uncommitted: no question
    expect(discard).toHaveBeenCalledTimes(1)
    act(() => useAgents.setState({ branches: { s1: { pushed: true, merged: true, uncommitted: 2 } } }))
    expect(screen.getByText(/2 files here are not committed/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Clean up'))
    fireEvent.click(screen.getByText('Keep'))
    fireEvent.click(screen.getByText('Clean up'))
    fireEvent.click(screen.getByText('Discard'))
    expect(discard).toHaveBeenCalledTimes(2)

    // Fresh when you come back to the window, and once a minute.
    const before = loadBranch.mock.calls.length
    act(() => void window.dispatchEvent(new Event('focus')))
    act(() => void vi.advanceTimersByTime(60_000))
    expect(loadBranch.mock.calls.length).toBe(before + 2)
    rerender(<SessionSide session={session({ id: 's2', worktree: '/wt2', branch: 'wone/y' })} onOpenNote={vi.fn()} />)
    expect(screen.queryByText(/Not possible to fast-forward/)).toBeNull() // that was another session's
    unmount()
    const after = loadBranch.mock.calls.length
    act(() => void vi.advanceTimersByTime(60_000))
    expect(loadBranch.mock.calls.length).toBe(after) // gone with the panel
    vi.useRealTimers()
  })

  it('plan and memory tabs; empty states', () => {
    const onOpenNote = vi.fn()
    useAgents.setState({ loadChanges: vi.fn(async () => {}) })
    const s = session({ plan: [{ id: '1', text: 'find bug', done: true }, { id: '2', text: 'add test', done: false }], notes: ['Projekte/Demo.md'], journal: 'Agents/Demo/j.md' })
    const { rerender } = render(<SessionSide session={s} onOpenNote={onOpenNote} />)
    expect(screen.getByText('No changes yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Plan 1' }))
    expect(screen.getByText('find bug')).toHaveClass('line-through')
    expect(screen.getByText('add test')).not.toHaveClass('line-through')
    fireEvent.click(screen.getByRole('tab', { name: 'Memory 1' }))
    fireEvent.click(screen.getByText('Session journal'))
    fireEvent.click(screen.getByText('Projekte/Demo.md'))
    expect(onOpenNote.mock.calls).toEqual([['Agents/Demo/j.md'], ['Projekte/Demo.md']])

    rerender(<SessionSide session={session()} onOpenNote={onOpenNote} />)
    expect(screen.getByText(/Notes the agent reads or writes show up here/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Plan' }))
    expect(screen.getByText(/No plan yet/)).toBeInTheDocument()
  })

  it('the diff opens in Monaco\'s diff editor and closes', async () => {
    render(<DiffModal />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => useAgents.setState({ diff: { path: 'src/a.ts', original: 'old', modified: 'new' } }))
    expect(screen.getByRole('dialog', { name: 'Changes in src/a.ts' })).toBeInTheDocument()
    await waitFor(() => expect(x.diff.created).toBe(1))
    expect(x.diff.models.map((m) => [m.value, m.path])).toEqual([
      ['old', expect.stringMatching(/before\/src\/a\.ts$/)],
      ['new', expect.stringMatching(/after\/src\/a\.ts$/)]
    ])
    fireEvent.click(screen.getByLabelText('Close diff'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(x.diff.disposed).toBe(1)
    expect(x.diff.models.every((m) => m.disposed)).toBe(true)
  })
})

describe('AgentsView', () => {
  const view = (props: { onOpenNote?: (p: string) => void; onOpenSettings?: () => void } = {}) =>
    render(<AgentsView onOpenNote={props.onOpenNote ?? vi.fn()} onOpenSettings={props.onOpenSettings ?? vi.fn()} />)

  it('empty: a way to start; "New chat" opens the dialog', async () => {
    installBridge({ 'agents:list': () => [], 'agents:detect': () => [claude()] })
    view()
    await act(settle)
    expect(screen.getByText('Your agents, in one place')).toBeInTheDocument()
    expect(screen.getByText('No chats yet')).toBeInTheDocument()
    expect(screen.getByText('All activity')).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('New chat')[1]) // the one in the middle
    await act(settle)
    expect(screen.getByRole('dialog', { name: 'New chat' })).toBeInTheDocument()
    act(() => ag().closeDialog())
    fireEvent.click(screen.getAllByText('New chat')[0]) // and the one above the list
    expect(ag().dialog).toEqual({ prompt: undefined })
    expect(useProjects.getState().load).toHaveBeenCalled()
  })

  it('one list of sessions and assistant chats: open, delete after asking', async () => {
    installBridge({ 'agents:list': () => ag().sessions })
    const open = vi.fn(async () => {})
    const remove = vi.fn(async () => {})
    const aOpen = vi.fn(async () => {})
    const aRemove = vi.fn(async () => {})
    useAgents.setState({ open, remove, sessions: [session({ status: 'working', worktree: '/wt' }), session({ id: 's2', title: 'Old', status: 'ended', updatedAt: '2026-10-01T00:00:00.000Z' }), session({ id: 's3', kind: 'codex', title: 'Codex', status: 'ended', updatedAt: '2026-08-01T00:00:00.000Z' })] })
    useAssistant.setState({
      open: aOpen,
      remove: aRemove,
      conversations: [
        { id: 'c1', title: 'Ask', agentId: 'assistant', createdAt: '', updatedAt: '2026-10-02T00:00:00.000Z', running: true },
        { id: 'c2', title: 'Quiet', agentId: 'chat', createdAt: '', updatedAt: '2026-09-01T00:00:00.000Z', running: false }
      ],
      running: { c1: true }
    })
    view()
    await act(settle)
    expect(screen.getAllByText(/^(Fix login|Ask|Old|Quiet)$/).map((n) => n.textContent)).toEqual(['Fix login', 'Ask', 'Old', 'Quiet'])
    expect(screen.getAllByText(/W-ONE Assistant ·/)).toHaveLength(2)
    expect(screen.getAllByText(/^Claude Code · Demo ·/)).toHaveLength(2) // renamed: the agent moves to the second line
    expect(screen.getAllByText(/^Demo ·/)).toHaveLength(1) // still named after its agent
    expect(screen.getByLabelText('Delete Fix login')).toHaveAttribute('title', 'Deletes its working folder too')

    fireEvent.click(screen.getByText('Fix login'))
    expect(open).toHaveBeenCalledWith('s1')
    fireEvent.click(screen.getByText('Ask'))
    expect(aOpen).toHaveBeenCalledWith('c1')
    expect(ag().view).toBe('assistant')

    fireEvent.click(screen.getByLabelText('Delete Old'))
    fireEvent.click(screen.getByText('Delete'))
    expect(remove).toHaveBeenCalledWith('s2')
    fireEvent.click(screen.getByLabelText('Delete Ask'))
    fireEvent.click(screen.getByText('Delete'))
    expect(aRemove).toHaveBeenCalledWith('c1')
  })

  it('shows the open session with its side panel; the assistant view with its activity', async () => {
    installBridge({ 'agents:list': () => ag().sessions, 'agents:changes': () => [] })
    useAgents.setState({ sessions: [session()], activeId: 's1', view: 'session', messages: { s1: [] } })
    useAssistant.setState({
      activeId: 'c1',
      activity: [
        { id: 'e1', type: 'agent.cancelled', ts: '2026-10-02T08:00:00.000Z', actor: { kind: 'agent' }, payload: {}, conversationId: 'c1' },
        { id: 'e2', type: 'db.migrated', ts: '2026-10-02T08:00:00.000Z', actor: { kind: 'system' }, payload: {} }
      ] as WoneEvent[]
    })
    const { rerender } = view()
    await act(settle)
    expect(screen.getByRole('tab', { name: 'Changes' })).toBeInTheDocument()
    expect(screen.getByText(/Runs with your own Claude Code sign-in/)).toBeInTheDocument()

    act(() => useAgents.setState({ view: 'assistant' }))
    rerender(<AgentsView onOpenNote={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.getByText('Run activity')).toBeInTheDocument()
    expect(screen.getByText('Run cancelled')).toBeInTheDocument()
    expect(screen.queryByText('Database schema updated')).toBeNull()

    act(() => useAgents.setState({ view: 'session', activeId: 'gone' })) // a session that isn't loaded (yet)
    expect(screen.getByText('Your agents, in one place')).toBeInTheDocument()
    expect(screen.getByText('Database schema updated')).toBeInTheDocument()
  })
})

describe('AssistantPane', () => {
  it('new chat: personas, a Settings link without a key; the open chat: messages, approvals, stop, project', async () => {
    const onOpenSettings = vi.fn()
    const a = {
      newChat: vi.fn(),
      cancel: vi.fn(async () => {}),
      respond: vi.fn(async () => {}),
      setProject: vi.fn(),
      clearError: vi.fn()
    }
    useAssistant.setState({
      ...a,
      status: { configured: false, source: null, settings: { model: 'claude-opus-5-5', effort: 'high' } },
      agents: [
        { id: 'assistant', name: 'Assistant', description: 'Personal', tools: [], web: false },
        { id: 'research', name: 'Research', description: 'Web', tools: [], web: true },
        { id: 'odd', name: 'Odd', description: 'Unknown icon', tools: [], web: false }
      ],
      error: 'key missing'
    })
    const { rerender } = render(<AssistantPane onOpenSettings={onOpenSettings} />)
    expect(screen.getByText('New chat · Assistant')).toBeInTheDocument()
    expect(screen.getByText('W-ONE Assistant · claude-opus-5-5 · high')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Research' }))
    expect(a.newChat).toHaveBeenCalledWith('research')
    fireEvent.click(screen.getByText(/Add an API key in Settings/))
    expect(onOpenSettings).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(a.clearError).toHaveBeenCalled()
    expect(screen.getByLabelText('Message')).toBeDisabled()

    act(() =>
      useAssistant.setState({
        status: { configured: true, source: 'stored', settings: { model: 'm', effort: 'low' } },
        error: undefined,
        conversations: [{ id: 'c1', title: 'Chat one', agentId: 'odd', createdAt: '', updatedAt: '', running: true }],
        activeId: 'c1',
        running: { c1: true },
        messages: {
          c1: [
            msg('u', 'user', 'Question'),
            { id: 'a', role: 'assistant', createdAt: '', status: 'streaming', parts: [{ type: 'tool', id: 't', name: 'memory_create_note', title: 'Create note', risk: 'write', input: {}, status: 'awaiting-approval', requestId: 'r1' }] }
          ]
        },
        pending: [{ id: 'r1', conversationId: 'c1', toolTitle: 'Create note', risk: 'write', summary: 'Create the note', allowAlways: true } as PermissionRequest]
      })
    )
    rerender(<AssistantPane onOpenSettings={onOpenSettings} />)
    expect(screen.getByText('Chat one')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Deny'))
    expect(a.respond).toHaveBeenCalledWith('r1', 'deny')
    expect(screen.getByText('Question')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Stop'))
    expect(a.cancel).toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Project context'), { target: { value: 'p1' } })
    expect(a.setProject).toHaveBeenCalledWith('p1')

    act(() => useAssistant.setState({ status: undefined, agents: [], agentId: 'ghost', activeId: undefined, messages: {} }))
    expect(screen.getByText('New chat · Assistant')).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveAttribute('placeholder', 'Message the assistant…')
  })
})
