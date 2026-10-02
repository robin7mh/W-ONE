import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, installBridge, settle } from './bridge'
import type { AgentInfo, AiStatus, ChatMessage, Conversation, ConversationSummary, PermissionRequest } from '@shared/types/ai'
import type { WoneEvent } from '@shared/types/events'
import { applyDelta, upsertMessage, useActiveMessages, useAssistant } from '@/features/agents/store'
import { clock, describeEvent, relativeTime } from '@/features/agents/format'
import { ActivityTimeline } from '@/features/agents/components/ActivityTimeline'
import { ApprovalCard } from '@/features/agents/components/ApprovalCard'
import { ApprovalToasts } from '@/features/agents/components/ApprovalToasts'
import { ChatThread, inputPreview, interceptLinks } from '@/features/agents/components/ChatThread'
import { Composer } from '@/features/agents/components/Composer'
import { KeySetup } from '@/features/agents/components/KeySetup'
import { AgentsView } from '@/features/agents/components/AgentsView'
import { useProjects } from '@/features/projects/store'

const initial = useAssistant.getState()
beforeEach(() => {
  useAssistant.setState(initial, true)
  useProjects.setState({ projects: [], load: vi.fn(async () => {}) })
})

const status = (over: Partial<AiStatus> = {}): AiStatus => ({ configured: true, source: 'stored', keyHint: 'ABCD', settings: { model: 'claude-opus-5-5', effort: 'high' }, ...over })
const agents: AgentInfo[] = [
  { id: 'assistant', name: 'Assistant', description: 'Personal', tools: ['memory_search'], web: false },
  { id: 'research', name: 'Research', description: 'Web', tools: [], web: true },
  { id: 'chat', name: 'Chat', description: 'Plain', tools: [], web: false },
  { id: 'mystery', name: 'Mystery', description: 'Unknown icon', tools: [], web: false }
]
const summary = (id: string, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id,
  title: `Chat ${id}`,
  agentId: 'assistant',
  createdAt: '2026-10-02T08:00:00.000Z',
  updatedAt: new Date().toISOString(),
  running: false,
  ...over
})
const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: 'assistant', parts: [], createdAt: '', status: 'done', ...over })
const request = (over: Partial<PermissionRequest> = {}): PermissionRequest => ({
  id: 'req1',
  runId: 'r',
  conversationId: 'c1',
  agentId: 'assistant',
  agentName: 'Assistant',
  toolName: 'memory_create_note',
  toolTitle: 'Create note',
  risk: 'write',
  summary: 'Create the note "X"',
  reason: 'to remember',
  input: {},
  allowAlways: true,
  createdAt: '',
  ...over
})
const event = (id: string, type: string, payload: Record<string, unknown> = {}, conversationId?: string): WoneEvent =>
  ({ id, type, ts: '2026-10-02T08:00:00.000Z', actor: { kind: 'agent' }, payload, conversationId }) as WoneEvent

// --- pure helpers ----------------------------------------------------------------

describe('message helpers', () => {
  it('applies deltas like the core: extend the last text part, else start one', () => {
    const list = [msg('a', { parts: [{ type: 'text', text: 'He' }] }), msg('b', { parts: [{ type: 'tool', id: 't', name: 'x', title: 'X', risk: 'read', input: {}, status: 'done' }] })]
    expect((applyDelta(list, 'a', 'llo')[0].parts[0] as { text: string }).text).toBe('Hello')
    expect(applyDelta(list, 'b', 'Next')[1].parts[1]).toEqual({ type: 'text', text: 'Next' })
    expect(applyDelta(list, 'zz', 'x')).toBe(list)
    expect(upsertMessage(list, msg('a', { status: 'error' }))[0].status).toBe('error')
    expect(upsertMessage(list, msg('c'))).toHaveLength(3)
  })

  it('formats times and describes every event type', () => {
    const now = Date.parse('2026-10-02T12:00:00.000Z')
    expect(relativeTime('2026-10-02T11:59:50.000Z', now)).toBe('just now')
    expect(relativeTime('2026-10-02T11:50:00.000Z', now)).toBe('10 min ago')
    expect(relativeTime('2026-10-02T09:00:00.000Z', now)).toBe('3 h ago')
    expect(relativeTime('2026-09-20T09:00:00.000Z', now)).toMatch(/20/)
    expect(relativeTime(new Date().toISOString())).toBe('just now')
    expect(clock('2026-10-02T08:00:00.000Z')).toMatch(/\d/)

    const cases: [string, Record<string, unknown>, string, string][] = [
      ['agent.started', { agent: 'Coding', goal: 'fix' }, 'Coding started: fix', 'cyan'],
      ['agent.started', {}, 'Agent started:', 'cyan'],
      ['agent.status.updated', { text: 'Step 2' }, 'Step 2', 'muted'],
      ['agent.status.updated', {}, 'Working', 'muted'],
      ['agent.completed', { iterations: 2, outputTokens: 9 }, 'Run completed · 2 steps · 9 tokens out', 'ok'],
      ['agent.completed', {}, 'Run completed · 0 steps · 0 tokens out', 'ok'],
      ['agent.failed', { status: 'timeout' }, 'Run timed out', 'error'],
      ['agent.failed', { status: 'failed', error: 'x' }, 'Run failed: x', 'error'],
      ['agent.cancelled', {}, 'Run cancelled', 'warn'],
      ['tool.started', { summary: 'Read A' }, 'Read A', 'cyan'],
      ['tool.started', { tool: 't' }, 'Tool t', 'cyan'],
      ['tool.completed', { tool: 't' }, 'Done: t', 'ok'],
      ['tool.failed', { summary: 'S', error: 'e' }, 'Failed: S — e', 'error'],
      ['tool.failed', { tool: 't' }, 'Failed: t', 'error'],
      ['tool.denied', { summary: 'S', reason: 'user' }, 'Blocked: S', 'warn'],
      ['tool.denied', { tool: 't', reason: 'not-allowed' }, 'Blocked: t (not-allowed)', 'warn'],
      ['tool.denied', { tool: 't' }, 'Blocked: t', 'warn'],
      ['permission.requested', { tool: 't' }, 'Approval requested: t', 'warn'],
      ['permission.requested', { summary: 'S' }, 'Approval requested: S', 'warn'],
      ['permission.granted', { tool: 't', decision: 'always' }, 'Approved (always): t', 'ok'],
      ['permission.granted', { tool: 't', decision: 'once' }, 'Approved (once): t', 'ok'],
      ['permission.denied', { tool: 't' }, 'Denied: t', 'error'],
      ['db.migrated', {}, 'Database schema updated', 'muted'],
      ['app.started', {}, 'app.started', 'muted']
    ]
    for (const [type, payload, text, tone] of cases) expect(describeEvent(event('e', type, payload))).toEqual({ text, tone })
    expect(describeEvent({ ...event('e', 'agent.cancelled'), payload: undefined } as never).text).toBe('Run cancelled')
  })

  it('previews tool input and opens web links outside', () => {
    expect(inputPreview(null)).toBe('')
    expect(inputPreview('x')).toBe('')
    expect(inputPreview({ command: 'npm test', path: 'a' })).toBe('npm test')
    expect(inputPreview({ other: 1 })).toBe('')
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const container = document.createElement('div')
    container.innerHTML = '<a href="https://example.com">x</a><a class="wikilink">w</a><span>t</span>'
    const click = (el: Element) => {
      const e = { target: el, preventDefault: vi.fn() }
      interceptLinks(e as never)
      return e.preventDefault
    }
    expect(click(container.querySelector('a[href]')!)).toHaveBeenCalled()
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    click(container.querySelector('a.wikilink')!)
    expect(open).toHaveBeenCalledTimes(1)
    expect(click(container.querySelector('span')!)).not.toHaveBeenCalled()
  })
})

// --- store ---------------------------------------------------------------------

function core(over: Record<string, (p: never) => unknown> = {}) {
  const conv: Conversation = { ...summary('c1'), messages: [msg('u1', { role: 'user', parts: [{ type: 'text', text: 'hi' }] }), msg('a1', { parts: [{ type: 'text', text: 'old' }] })] }
  return installBridge({
    'ai:status': () => status(),
    'ai:agents': () => agents,
    'ai:conversations': () => [summary('c1', { running: true }), summary('c2')],
    'permission:pending': () => [request()],
    'events:recent': () => [event('e1', 'tool.completed', { tool: 't' }, 'c1')],
    'ai:conversation': () => conv,
    'ai:send': () => ({ conversationId: 'c9', messageId: 'm9' }),
    'ai:cancel': () => undefined,
    'ai:deleteConversation': () => undefined,
    'permission:respond': () => undefined,
    'ai:setKey': () => status({ keyHint: 'WXYZ' }),
    'ai:clearKey': () => status({ configured: false, source: null }),
    'ai:configure': (p: { effort: string }) => status({ settings: { model: 'claude-opus-5-5', effort: p.effort as never } }),
    ...over
  })
}

describe('assistant store', () => {
  it('connects once (ref-counted), loads everything and follows push events', async () => {
    const bridge = core()
    const off1 = useAssistant.getState().connect()
    const off2 = useAssistant.getState().connect()
    await settle()
    const s = useAssistant.getState()
    expect(s.status?.keyHint).toBe('ABCD')
    expect(s.agents).toHaveLength(4)
    expect(s.conversations.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(s.running).toEqual({ c1: true, c2: false })
    expect(s.pending).toHaveLength(1)
    expect(s.activity).toHaveLength(1)
    expect(bridge.listenerCount('ai:delta')).toBe(1)

    await useAssistant.getState().open('c1')
    act(() => bridge.emit('ai:delta', { conversationId: 'c1', messageId: 'a1', text: '!' }))
    expect((useAssistant.getState().messages.c1[1].parts[0] as { text: string }).text).toBe('old!')
    act(() => bridge.emit('ai:delta', { conversationId: 'nope', messageId: 'a1', text: '!' }))
    act(() => bridge.emit('ai:message', { conversationId: 'c3', message: msg('x'), running: true }))
    expect(useAssistant.getState().messages.c3).toHaveLength(1)
    expect(useAssistant.getState().running.c3).toBe(true)
    act(() => bridge.emit('permission:request', request({ id: 'req2' })))
    act(() => bridge.emit('permission:request', request({ id: 'req2', summary: 'updated' })))
    expect(useAssistant.getState().pending.map((p) => p.id)).toEqual(['req1', 'req2'])
    act(() => bridge.emit('permission:resolved', { id: 'req1', decision: 'once' }))
    expect(useAssistant.getState().pending.map((p) => p.id)).toEqual(['req2'])
    act(() => bridge.emit('events:event', event('e2', 'agent.started')))
    expect(useAssistant.getState().activity[0].id).toBe('e2')
    act(() => bridge.emit('ai:conversationsChanged', { reason: 'updated', id: 'c2' }))
    await settle()
    expect(useAssistant.getState().activeId).toBe('c1')
    act(() => bridge.emit('ai:conversationsChanged', { reason: 'deleted', id: 'c1' }))
    await settle()
    expect(useAssistant.getState().activeId).toBeUndefined()

    off1()
    expect(bridge.listenerCount('ai:delta')).toBe(1)
    off2()
    expect(bridge.listenerCount('ai:delta')).toBe(0)
  })

  it('merges fetched history with live messages (live wins)', async () => {
    core()
    useAssistant.setState({ messages: { c1: [msg('a1', { parts: [{ type: 'text', text: 'live' }] }), msg('a2')] } })
    await useAssistant.getState().open('c1')
    expect(useAssistant.getState().messages.c1.map((m) => m.id)).toEqual(['u1', 'a1', 'a2'])
    expect((useAssistant.getState().messages.c1[1].parts[0] as { text: string }).text).toBe('live')
  })

  it('sends to a new or open conversation, cancels, removes, responds, manages the key', async () => {
    const bridge = core()
    useAssistant.setState({ agentId: 'research', projectId: 'p1' })
    expect(await useAssistant.getState().send('   ')).toBe(false)
    expect(await useAssistant.getState().send('Hello')).toBe(true)
    expect(bridge.invoke).toHaveBeenCalledWith('ai:send', { text: 'Hello', agentId: 'research', projectId: 'p1' })
    expect(useAssistant.getState().activeId).toBe('c9')
    bridge.routes['ai:send'] = (() => ({ conversationId: 'c9', messageId: 'm10' })) as never
    await useAssistant.getState().send('Again')
    expect(bridge.invoke).toHaveBeenCalledWith('ai:send', { text: 'Again', conversationId: 'c9', projectId: undefined })
    useAssistant.setState({ sending: true })
    expect(await useAssistant.getState().send('busy')).toBe(false)
    useAssistant.setState({ sending: false })

    await useAssistant.getState().cancel()
    expect(bridge.invoke).toHaveBeenCalledWith('ai:cancel', { conversationId: 'c9' })
    useAssistant.setState({ activeId: undefined })
    await useAssistant.getState().cancel() // nothing open: no call
    expect(bridge.invoke.mock.calls.filter(([c]) => c === 'ai:cancel')).toHaveLength(1)

    useAssistant.setState({ activeId: 'c1', messages: { c1: [], c2: [] } })
    await useAssistant.getState().remove('c1')
    expect(useAssistant.getState().activeId).toBeUndefined()
    expect(useAssistant.getState().messages).toEqual({ c2: [] })
    useAssistant.setState({ activeId: 'c2' })
    await useAssistant.getState().remove('c1')
    expect(useAssistant.getState().activeId).toBe('c2')

    useAssistant.setState({ pending: [request()] })
    await useAssistant.getState().respond('req1', 'once')
    expect(useAssistant.getState().pending).toEqual([])

    expect(await useAssistant.getState().setKey('sk-x')).toBe(true)
    expect(useAssistant.getState().status?.keyHint).toBe('WXYZ')
    await useAssistant.getState().configure({ effort: 'low' })
    expect(useAssistant.getState().status?.settings.effort).toBe('low')
    await useAssistant.getState().clearKey()
    expect(useAssistant.getState().status?.configured).toBe(false)

    useAssistant.getState().newChat('chat')
    expect(useAssistant.getState()).toMatchObject({ activeId: undefined, agentId: 'chat' })
    useAssistant.getState().newChat()
    expect(useAssistant.getState().agentId).toBe('chat')
    useAssistant.getState().setProject(undefined)
    expect(useAssistant.getState().projectId).toBeUndefined()
  })

  it('reports every failure', async () => {
    const all = ['ai:status', 'ai:conversation', 'ai:send', 'ai:cancel', 'ai:deleteConversation', 'permission:respond', 'ai:setKey', 'ai:clearKey', 'ai:configure']
    core(Object.fromEntries(all.map((ch) => [ch, () => fail(`${ch} failed`)])))
    const s = useAssistant.getState()
    const expectError = async (run: () => Promise<unknown>, text: string) => {
      useAssistant.setState({ error: undefined })
      await run()
      expect(useAssistant.getState().error).toBe(text)
    }
    await expectError(() => s.refresh(), 'ai:status failed')
    expect(useAssistant.getState().loading).toBe(false)
    await expectError(() => s.open('c1'), 'ai:conversation failed')
    await expectError(() => s.send('x'), 'ai:send failed')
    expect(useAssistant.getState().sending).toBe(false)
    await expectError(() => s.stop('c1'), 'ai:cancel failed')
    await expectError(() => s.remove('c1'), 'ai:deleteConversation failed')
    useAssistant.setState({ pending: [request()] })
    await expectError(() => s.respond('req1', 'deny'), 'permission:respond failed')
    expect(useAssistant.getState().pending).toEqual([]) // stale request dropped
    expect(await s.setKey('x')).toBe(false)
    await expectError(() => s.clearKey(), 'ai:clearKey failed')
    await expectError(() => s.configure({}), 'ai:configure failed')
    s.clearError()
    expect(useAssistant.getState().error).toBeUndefined()

    // a failing list refresh after a push is reported too
    const bridge = core({ 'ai:conversations': () => fail('list failed') })
    const off = useAssistant.getState().connect()
    await settle()
    act(() => bridge.emit('ai:conversationsChanged', { reason: 'created', id: 'x' }))
    await settle()
    expect(useAssistant.getState().error).toBe('list failed')
    off()
  })

  it('useActiveMessages is stable without an open conversation', () => {
    let seen: ChatMessage[] = []
    function Probe() {
      seen = useActiveMessages()
      return null
    }
    render(<Probe />)
    const first = seen
    act(() => useAssistant.setState({ activity: [] }))
    expect(seen).toBe(first)
    act(() => useAssistant.setState({ activeId: 'c1' }))
    expect(seen).toEqual([])
    act(() => useAssistant.setState({ messages: { c1: [msg('a')] } }))
    expect(seen).toHaveLength(1)
  })
})

// --- components ------------------------------------------------------------------

describe('ActivityTimeline, ApprovalCard, ApprovalToasts', () => {
  it('renders events or an empty state', () => {
    const { rerender } = render(<ActivityTimeline events={[]} empty="Nothing" />)
    expect(screen.getByText('Nothing')).toBeInTheDocument()
    rerender(<ActivityTimeline events={[event('a', 'agent.cancelled'), event('b', 'tool.completed', { tool: 'x' })]} compact max={1} />)
    expect(screen.getByText('Run cancelled')).toBeInTheDocument()
    expect(screen.queryByText('Done: x')).toBeNull()
    rerender(<ActivityTimeline events={[]} />)
    expect(screen.getByText('No activity yet')).toBeInTheDocument()
  })

  it('offers once / always / deny — never "always" for commands', () => {
    const onRespond = vi.fn()
    const { rerender } = render(<ApprovalCard request={request()} onRespond={onRespond} />)
    expect(screen.getByText('Assistant wants to make a change')).toBeInTheDocument()
    expect(screen.getByText('Why: to remember')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Allow once'))
    fireEvent.click(screen.getByText('Always allow'))
    fireEvent.click(screen.getByText('Deny'))
    expect(onRespond.mock.calls.map((c) => c[0])).toEqual(['once', 'always', 'deny'])
    rerender(<ApprovalCard request={request({ risk: 'execute', allowAlways: false, reason: '' })} onRespond={onRespond} compact />)
    expect(screen.getByText('Assistant wants to run a command')).toBeInTheDocument()
    expect(screen.queryByText('Always allow')).toBeNull()
    expect(screen.queryByText(/Why:/)).toBeNull()
  })

  it('floats pending approvals (except the open chat), at most three', () => {
    const respond = vi.fn(async () => {})
    useAssistant.setState({ pending: [], respond })
    const { container, rerender } = render(<ApprovalToasts />)
    expect(container.innerHTML).toBe('')
    act(() => useAssistant.setState({ pending: ['1', '2', '3', '4', '5'].map((id) => request({ id, conversationId: id === '5' ? 'open' : 'c' })) }))
    rerender(<ApprovalToasts hideConversation="open" />)
    expect(screen.getAllByRole('alertdialog')).toHaveLength(3)
    expect(screen.getByText('+1 more waiting')).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('Deny')[0])
    expect(respond).toHaveBeenCalledWith('1', 'deny')
  })
})

describe('ChatThread', () => {
  it('renders user and assistant messages, tool cards with inline approval, states and usage', () => {
    const onRespond = vi.fn()
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const messages: ChatMessage[] = [
      msg('u', { role: 'user', parts: [{ type: 'text', text: 'Please help' }, { type: 'tool', id: 'x', name: 'n', title: 'T', risk: 'read', input: {}, status: 'done' }] }),
      msg('a', {
        model: 'claude-opus-5-5',
        usage: { inputTokens: 10, outputTokens: 5 },
        parts: [
          { type: 'text', text: '**Bold** answer' },
          { type: 'tool', id: 't1', name: 'memory_search', title: 'Search memory', risk: 'read', input: { query: 'x' }, status: 'done', output: 'hits' },
          { type: 'tool', id: 't2', name: 'project_write_file', title: 'Write file', risk: 'write', input: { path: 'a' }, status: 'awaiting-approval', requestId: 'req1' },
          { type: 'tool', id: 't3', name: 'shell_run', title: 'Run command', risk: 'execute', input: { command: 'ls' }, status: 'running' },
          { type: 'tool', id: 't4', name: 'web_search', title: 'Web search', risk: 'read', input: 5, status: 'error', server: true },
          { type: 'tool', id: 't5', name: 'projects_list', title: 'List projects', risk: 'read', input: {}, status: 'pending' },
          { type: 'tool', id: 't6', name: 'memory_append', title: 'Append', risk: 'write', input: {}, status: 'denied' }
        ]
      }),
      msg('s1', { status: 'streaming' }),
      msg('s2', { status: 'streaming', parts: [{ type: 'text', text: 'typing' }] }),
      msg('e1', { status: 'error', error: 'boom' }),
      msg('e2', { status: 'error' }),
      msg('c', { status: 'cancelled', model: 'm' })
    ]
    render(<ChatThread messages={messages} pending={[request()]} onRespond={onRespond} />)
    expect(screen.getByText('Please help')).toBeInTheDocument()
    expect(screen.getByText('Bold').tagName).toBe('STRONG')
    expect(screen.getByText('waiting for you')).toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('queued')).toBeInTheDocument()
    expect(screen.getByText('blocked')).toBeInTheDocument()
    expect(screen.getByText('thinking…')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.getByText('The run failed.')).toBeInTheDocument()
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.getByText('claude-opus-5-5 · 10 in / 5 out')).toBeInTheDocument()
    expect(screen.getByText('m')).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalled()

    fireEvent.click(screen.getByText('Search memory'))
    expect(screen.getByText('hits')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Search memory'))
    expect(screen.queryByText('hits')).toBeNull()
    fireEvent.click(screen.getByText('Run command'))
    expect(screen.queryByText('Result')).toBeNull() // no output yet
    fireEvent.click(screen.getByText('Allow once'))
    expect(onRespond).toHaveBeenCalledWith('req1', 'once')
  })
})

describe('ChatThread (empty)', () => {
  it('renders nothing but the scroll anchor', () => {
    const { container } = render(<ChatThread messages={[]} pending={[]} onRespond={vi.fn()} />)
    expect(container.textContent).toBe('')
  })
})

describe('Composer', () => {
  const props = () => ({
    running: false,
    sending: false,
    projects: [{ id: 'p1', name: 'demo', path: '/p', addedAt: '', lastSeenAt: '' }],
    placeholder: 'Message…',
    onProject: vi.fn(),
    onSend: vi.fn(async () => true),
    onStop: vi.fn()
  })

  it('sends on Enter (not Shift+Enter or IME), clears on success, picks a project, stops', async () => {
    const p = props()
    const { rerender } = render(<Composer {...p} />)
    const box = screen.getByLabelText('Message')
    fireEvent.keyDown(box, { key: 'Enter' }) // empty: nothing
    fireEvent.change(box, { target: { value: 'Hi' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(box, { key: 'a' })
    expect(p.onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    await act(settle)
    expect(p.onSend).toHaveBeenCalledWith('Hi')
    expect(box).toHaveValue('')

    p.onSend.mockResolvedValueOnce(false)
    fireEvent.change(box, { target: { value: 'Keep' } })
    fireEvent.click(screen.getByLabelText('Send'))
    await act(settle)
    expect(box).toHaveValue('Keep')

    fireEvent.change(screen.getByLabelText('Project context'), { target: { value: 'p1' } })
    expect(p.onProject).toHaveBeenCalledWith('p1')
    rerender(<Composer {...p} projectId="p1" />)
    fireEvent.change(screen.getByLabelText('Project context'), { target: { value: '' } })
    expect(p.onProject).toHaveBeenLastCalledWith(undefined)

    rerender(<Composer {...p} running />)
    fireEvent.keyDown(box, { key: 'Enter' }) // running: ignored
    fireEvent.click(screen.getByLabelText('Stop'))
    expect(p.onStop).toHaveBeenCalled()
    rerender(<Composer {...p} sending />)
    expect(screen.getByLabelText('Send')).toBeDisabled()
    rerender(<Composer {...p} disabled />)
    expect(screen.getByLabelText('Message')).toBeDisabled()
  })
})

describe('KeySetup', () => {
  it('verifies the key and clears it on success', async () => {
    const onSave = vi.fn(async () => false)
    render(<KeySetup onSave={onSave} error="rejected" />)
    expect(screen.getByText('rejected')).toBeInTheDocument()
    const input = screen.getByLabelText('Anthropic API key')
    fireEvent.submit(input.closest('form')!) // empty: ignored
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'sk-1' } })
    fireEvent.click(screen.getByText('Verify & save key'))
    await act(settle)
    expect(input).toHaveValue('sk-1')
    onSave.mockResolvedValueOnce(true)
    fireEvent.click(screen.getByText('Verify & save key'))
    await act(settle)
    expect(input).toHaveValue('')
  })
})

describe('AgentsView', () => {
  const view = (over: Record<string, unknown> = {}) => {
    const actions = {
      open: vi.fn(async () => {}),
      newChat: vi.fn(),
      remove: vi.fn(async () => {}),
      respond: vi.fn(async () => {}),
      send: vi.fn(async () => true),
      cancel: vi.fn(async () => {}),
      setKey: vi.fn(async () => true),
      setProject: vi.fn(),
      clearError: vi.fn()
    }
    useAssistant.setState({ status: status(), agents, conversations: [summary('c1', { running: true }), summary('c2', { agentId: 'mystery' })], ...actions, ...over })
    return actions
  }

  it('lists agents and conversations, opens / deletes / starts chats', () => {
    const a = view({ running: { c1: true } })
    render(<AgentsView />)
    expect(screen.getByText('New chat · Assistant')).toBeInTheDocument()
    expect(screen.getAllByText('Personal').length).toBeGreaterThan(0)
    expect(screen.getByText(/Tools: memory_search/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Chat c1'))
    expect(a.open).toHaveBeenCalledWith('c1')
    fireEvent.click(screen.getByLabelText('Delete Chat c2'))
    expect(a.remove).toHaveBeenCalledWith('c2')
    fireEvent.click(screen.getAllByText('New chat')[0])
    fireEvent.click(screen.getByText('New'))
    fireEvent.click(screen.getByRole('button', { name: 'Research' }))
    expect(a.newChat).toHaveBeenCalledWith('research')
    expect(useProjects.getState().load).toHaveBeenCalled()
  })

  it('shows the open conversation with its activity, sends and stops', async () => {
    const a = view({
      activeId: 'c1',
      running: { c1: true },
      messages: {
        c1: [
          msg('u', { role: 'user', parts: [{ type: 'text', text: 'Question' }] }),
          msg('a', { status: 'streaming', parts: [{ type: 'tool', id: 't', name: 'memory_create_note', title: 'Create note', risk: 'write', input: {}, status: 'awaiting-approval', requestId: 'req1' }] })
        ]
      },
      pending: [request()],
      activity: [event('e1', 'agent.started', { agent: 'Assistant', goal: 'Q' }, 'c1'), event('e2', 'agent.cancelled', {}, 'other')]
    })
    render(<AgentsView />)
    expect(screen.getAllByText('Chat c1').length).toBeGreaterThan(1)
    expect(screen.getByText('Run activity')).toBeInTheDocument()
    expect(screen.getByText('Assistant started: Q')).toBeInTheDocument()
    expect(screen.queryByText('Run cancelled')).toBeNull()
    fireEvent.click(screen.getByLabelText('Stop'))
    expect(a.cancel).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Deny'))
    expect(a.respond).toHaveBeenCalledWith('req1', 'deny')
    fireEvent.change(screen.getByLabelText('Project context'), { target: { value: '' } })
    expect(a.setProject).toHaveBeenCalledWith(undefined)
  })

  it('asks for a key first; shows and dismisses errors; web agents mention web search', async () => {
    const a = view({ status: status({ configured: false }), error: 'Something broke' })
    const { rerender } = render(<AgentsView />)
    expect(screen.getByText('Connect the assistant')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(a.clearError).toHaveBeenCalled()
    act(() => useAssistant.setState({ status: status(), agentId: 'research', error: undefined }))
    rerender(<AgentsView />)
    expect(screen.queryByText(/Tools:/)).toBeNull() // research has no own tools listed
    act(() => useAssistant.setState({ agents: [{ ...agents[1], tools: ['memory_search'] }] }))
    expect(screen.getByText(/, web search/)).toBeInTheDocument()
    act(() => useAssistant.setState({ conversations: [] }))
    expect(screen.getByText('No conversations yet')).toBeInTheDocument()
    act(() => useAssistant.setState({ status: undefined, agents: [], agentId: 'ghost' }))
    expect(screen.getByText('New chat · Agent')).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveAttribute('placeholder', 'Message the assistant…')
  })
})
