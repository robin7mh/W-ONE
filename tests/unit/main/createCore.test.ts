import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tempDir } from './helpers'

const h = vi.hoisted(() => ({
  ptyData: undefined as undefined | ((d: string) => void),
  ptyExit: undefined as undefined | ((e: { exitCode: number }) => void),
  ptyEnv: undefined as undefined | Record<string, string>,
  ptyArgs: [] as string[]
}))
vi.mock('node-pty', () => ({
  spawn: (_file: string, args: string[], opts: { env: Record<string, string> }) => ({
    ...((h.ptyEnv = opts.env), (h.ptyArgs = args), {}),
    pid: 1,
    onData: (cb: (d: string) => void) => (h.ptyData = cb),
    onExit: (cb: (e: { exitCode: number }) => void) => (h.ptyExit = cb),
    write: () => {},
    resize: () => {},
    kill: () => {}
  })
}))
vi.mock('../../../electron/main/services/system/collectors', () => ({
  collect: async () => ({ cpu: 1 }),
  collectProcesses: async () => [],
  currentUser: async () => ({ name: 'Ada Lovelace', firstName: 'Ada' }),
  startSampling: () => {},
  stopSampling: () => {}
}))
// Never start the real VS Code from a test.
vi.mock('../../../electron/main/lib/openInVsCode', () => ({ openInVsCode: vi.fn(async () => {}) }))

import { createCore, type Core } from '../../../electron/main/core/createCore'
import { openInVsCode } from '../../../electron/main/lib/openInVsCode'
import { headlessPlatform } from '../../../electron/main/platform/headless'
import { mindeckPaths } from '../../../electron/main/lib/paths'
import { run, serverConfigFromEnv } from '../../../server/main'


const cores: Core[] = []
let savedHome: string | undefined
beforeEach(async () => {
  savedHome = process.env.MINDECK_HOME
  process.env.MINDECK_HOME = await tempDir()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
  if (savedHome === undefined) delete process.env.MINDECK_HOME
  else process.env.MINDECK_HOME = savedHome
})

async function core(opts: Partial<Parameters<typeof createCore>[0]> = {}) {
  const c = await createCore({ mode: 'server', version: '1.2.3', paths: mindeckPaths(), platform: headlessPlatform, ...opts })
  cores.push(c)
  return c
}

describe('createCore', () => {
  it('wires every service onto one router', async () => {
    const c = await core({ serverConfig: { enabled: false, lan: false, port: 0, remoteTerminal: false } })
    expect(await c.router.dispatch('app:info', undefined, { transport: 'ipc' })).toMatchObject({
      ok: true,
      data: { mode: 'server', version: '1.2.3', remoteTerminal: false }
    })
    for (const [channel, req] of [
      ['projects:list', undefined],
      ['system:user', undefined],
      ['context:get', { projectId: 'none' }],
      ['memory:status', undefined],
      ['terminal:list', undefined],
      ['fs:dirs', {}],
      ['server:status', undefined],
      ['server:devices', undefined],
      ['server:createPairingCode', undefined]
    ] as const) {
      expect(await c.router.dispatch(channel, req, { transport: 'ipc' })).toMatchObject({ ok: true })
    }
    expect(await c.router.dispatch('server:configure', { lan: true }, { transport: 'ipc' })).toMatchObject({
      ok: false,
      error: { code: 'not-configurable' }
    })
    expect(await c.router.dispatch('server:revokeDevice', { id: 'x' }, { transport: 'ipc' })).toEqual({ ok: true })

    // assistant, permissions and the event log are wired too
    for (const [channel, req] of [
      ['ai:status', undefined],
      ['ai:configure', { effort: 'low' }],
      ['ai:clearKey', undefined],
      ['ai:agents', undefined],
      ['ai:tools', undefined],
      ['ai:conversations', undefined],
      ['ai:runs', {}],
      ['ai:cancel', { conversationId: 'none' }],
      ['ai:deleteConversation', { id: 'none' }],
      ['permission:pending', undefined],
      ['permission:grants', undefined],
      ['permission:revoke', { agentId: 'a', toolName: 't' }],
      ['events:recent', {}]
    ] as const) {
      expect(await c.router.dispatch(channel, req, { transport: 'ipc' })).toMatchObject({ ok: true })
    }
    expect(await c.router.dispatch('ai:setKey', { key: 'short' }, { transport: 'ipc' })).toMatchObject({ error: { code: 'bad-key' } })
    expect(await c.router.dispatch('ai:conversation', { id: 'none' }, { transport: 'ipc' })).toMatchObject({ error: { code: 'not-found' } })
    expect(await c.router.dispatch('permission:respond', { id: 'none', decision: 'once' }, { transport: 'remote', deviceId: 'd' })).toMatchObject({
      error: { code: 'not-pending' }
    })
    expect(await c.router.dispatch('terminal:list', undefined, { transport: 'remote' })).toMatchObject({
      error: { code: 'remote-terminal-disabled' }
    })

    const ticks: unknown[] = []
    c.hub.subscribe((channel, payload) => channel === 'memory:changed' && ticks.push(payload))
    await c.router.dispatch('memory:createVault', undefined, { transport: 'ipc' })
    await c.router.dispatch('memory:create', { title: 'Hello' }, { transport: 'ipc' })
    expect(ticks.length).toBeGreaterThan(0)

    // service callbacks publish on the hub
    const pushed: string[] = []
    c.hub.subscribe((channel) => pushed.push(channel))
    const project = await c.router.dispatch('projects:add', { path: process.env.MINDECK_HOME! }, { transport: 'ipc' })
    const projectId = (project as { data: { id: string } }).data.id
    await c.router.dispatch('context:reindex', { projectId }, { transport: 'ipc' })
    const term = await c.router.dispatch('terminal:create', { projectId }, { transport: 'ipc' })
    expect(term).toMatchObject({ ok: true, data: { projectId } })
    h.ptyData!('hello\x1b]7;file://h/tmp\x07') // the shell reports its folder too
    await new Promise((r) => setTimeout(r, 30))
    c.system.setRemoteClients(1)
    await new Promise((r) => setTimeout(r, 30))
    c.system.setRemoteClients(0)
    expect(pushed).toEqual(expect.arrayContaining(['context:progress', 'terminal:data', 'terminal:info', 'system:tick']))

    // The editor's language service and debugger find projects the same way; the debugger publishes its session.
    expect(await c.router.dispatch('lsp:open', { projectId: 'none', path: 'a.ts', text: '' }, { transport: 'ipc' })).toMatchObject({ error: { code: 'not-found' } })
    await writeFile(join(process.env.MINDECK_HOME!, 'run.js'), '')
    expect(await c.router.dispatch('debug:start', { projectId, program: 'run.js', breakpoints: [] }, { transport: 'ipc' })).toMatchObject({ ok: true, data: { status: 'starting' } })
    expect(pushed).toContain('debug:session')
    expect(await c.router.dispatch('debug:stop', undefined, { transport: 'ipc' })).toEqual({ ok: true })

    // Live Server and Sass find the project and the user's settings.
    await writeFile(join(process.env.MINDECK_HOME!, 'a.scss'), 'a { b: c }')
    const served = await c.router.dispatch('liveServer:start', { projectId }, { transport: 'ipc' })
    expect(served).toMatchObject({ ok: true, data: { projectId } })
    expect(pushed).toContain('liveServer:changed')
    expect(await c.router.dispatch('liveServer:stop', { projectId }, { transport: 'ipc' })).toEqual({ ok: true })
    expect(await c.router.dispatch('sass:compile', { projectId, path: 'a.scss' }, { transport: 'ipc' })).toMatchObject({ ok: true, data: { written: ['a.css'] } })
    // With the user's settings (moved over from VS Code) both follow them.
    await c.settings.update({ editor: { liveServer: { noBrowser: true }, sass: { formats: [{ format: 'compressed', extensionName: '.min.css' }] } } })
    expect(await c.router.dispatch('sass:compile', { projectId, path: 'a.scss' }, { transport: 'ipc' })).toMatchObject({ ok: true, data: { written: ['a.min.css'] } })
    expect(await c.router.dispatch('liveServer:start', { projectId }, { transport: 'ipc' })).toMatchObject({ ok: true })
    expect(await c.router.dispatch('liveServer:stop', { projectId }, { transport: 'ipc' })).toEqual({ ok: true })
    // SFTP reads the project's .vscode/sftp.json.
    expect(await c.router.dispatch('sftp:targets', { projectId }, { transport: 'ipc' })).toEqual({ ok: true, data: [] })
    await mkdir(join(process.env.MINDECK_HOME!, '.vscode'), { recursive: true })
    await writeFile(join(process.env.MINDECK_HOME!, '.vscode/sftp.json'), JSON.stringify({ name: 'T', host: '127.0.0.1', port: 1, connectTimeout: 300 }))
    expect(await c.router.dispatch('sftp:list', { projectId, target: 'T' }, { transport: 'ipc' })).toMatchObject({ error: {} })
    // Pull requests go through gh, for known projects only.
    expect(await c.router.dispatch('github:view', { projectId: 'none', number: 1 }, { transport: 'ipc' })).toMatchObject({ error: { code: 'not-found' } })
    // MongoDB keeps its connections in the secret store.
    expect(await c.router.dispatch('mongo:connections', undefined, { transport: 'ipc' })).toEqual({ ok: true, data: [] })
    // Settings Sync works through the account (signed out here).
    expect(await c.router.dispatch('cloud:syncStatus', undefined, { transport: 'ipc' })).toEqual({ ok: true, data: { signedIn: false, remote: null, local: null } })
    expect(await c.router.dispatch('cloud:syncPush', { force: true }, { transport: 'ipc' })).toMatchObject({ error: { code: 'session_expired' } })
    expect(await c.router.dispatch('cloud:syncPull', undefined, { transport: 'ipc' })).toMatchObject({ error: { code: 'session_expired' } })
    // Remote: none yet; an unknown project has no container; the follower channel refuses a core that signs in itself.
    expect(await c.router.dispatch('remote:list', undefined, { transport: 'ipc' })).toEqual({ ok: true, data: [] })
    // The user's ssh, nobody listening: the connection fails (and the license knows no remote window is open).
    expect(await c.router.dispatch('remote:ssh', { target: 'nobody@127.0.0.1:1' }, { transport: 'ipc' })).toMatchObject({ error: { code: 'remote-unreachable' } })
    expect(pushed).toContain('remote:changed')
    // ESLint and Prettier run in the project (none here: nothing to lint, the editor formats).
    expect(await c.router.dispatch('lint:file', { projectId, path: 'a.js', text: 'x' }, { transport: 'ipc' })).toEqual({ ok: true, data: { available: false, diagnostics: [] } })
    expect(await c.router.dispatch('format:document', { projectId, path: 'a.js', text: 'x' }, { transport: 'ipc' })).toEqual({ ok: true, data: null })
    expect(await c.router.dispatch('editor:update', { tabSize: 3 }, { transport: 'ipc' })).toMatchObject({ ok: true, data: { tabSize: 3 } })
    // AI in the editor: suggestions are off until switched on; an edit needs a key.
    expect(await c.router.dispatch('ai:inlineComplete', { requestId: 'r', path: 'a.ts', language: 'typescript', prefix: 'x', suffix: '' }, { transport: 'ipc' })).toEqual({ ok: true, data: '' })
    expect(await c.router.dispatch('ai:inlineCancel', { requestId: 'r' }, { transport: 'ipc' })).toEqual({ ok: true, data: undefined })
    expect(await c.router.dispatch('ai:inlineEdit', { requestId: 'e', path: 'a.ts', language: 'typescript', before: '', selection: '', after: '', instruction: 'x' }, { transport: 'ipc' })).toMatchObject({ error: { code: 'no-key' } })
    // Notebooks: no kernel before one starts; closing one without a kernel is fine.
    expect(await c.router.dispatch('notebook:execute', { projectId, path: 'a.ipynb', cell: 'c', code: 'x' }, { transport: 'ipc' })).toMatchObject({ error: { code: 'not-started' } })
    expect(await c.router.dispatch('notebook:shutdown', { projectId, path: 'a.ipynb' }, { transport: 'ipc' })).toEqual({ ok: true, data: undefined })
    expect(await c.router.dispatch('notebook:start', { projectId, path: '../a.ipynb', kernel: 'python3' }, { transport: 'ipc' })).toMatchObject({ error: { code: 'not-found' } })
    // The test explorer finds the project's tests (none here) and runs them with Mindeck's debugger at hand.
    expect(await c.router.dispatch('tests:discover', { projectId }, { transport: 'ipc' })).toEqual({ ok: true, data: [] })
    expect(await c.router.dispatch('tests:state', { projectId }, { transport: 'ipc' })).toEqual({ ok: true, data: { projectId, running: false, results: {}, output: '' } })
    expect(await c.router.dispatch('tests:debug', { projectId, id: 'none', breakpoints: [] }, { transport: 'ipc' })).toMatchObject({ error: { code: 'not-found' } })
    expect(await c.router.dispatch('remote:hasContainer', { projectId: 'none' }, { transport: 'ipc' })).toMatchObject({ error: { code: 'not-found' } })
    expect(await c.router.dispatch('remote:hasContainer', { projectId }, { transport: 'ipc' })).toEqual({ ok: true, data: false })
    expect(await c.router.dispatch('cloud:adopt', { token: 'mindeck1.x.y.zzzz', account: { email: 'a@b', name: null } }, { transport: 'ipc' })).toMatchObject({ error: { code: 'not-follower' } })
  })

  it('wires the browser and Files: dev servers from terminals, the Live Server in a tab, the files under Home', async () => {
    const home = await tempDir()
    const savedHomeEnv = process.env.HOME
    process.env.HOME = home // Files works under Home: a throwaway one
    const realPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' }) // no Spotlight here: Files walks
    const openExternal = vi.fn(async () => {})
    const c = await core({ mode: 'desktop', serverConfig: { enabled: false, lan: false, port: 0, remoteTerminal: false }, platform: { ...headlessPlatform, kind: 'desktop', openExternal } })
    Object.defineProperty(process, 'platform', { value: realPlatform })
    const pushed: string[] = []
    c.hub.subscribe((channel) => pushed.push(channel))
    const site = await tempDir()
    await writeFile(join(site, 'index.html'), '<h1>site</h1>')
    const { data: project } = (await c.router.dispatch('projects:add', { path: site }, { transport: 'ipc' })) as { data: { id: string } }

    // a dev server announced in a project's terminal shows up in the browser — and goes with its terminal
    await c.router.dispatch('terminal:create', { projectId: project.id }, { transport: 'ipc' })
    h.ptyData!('  ➜  Local:   http://localhost:5173/\n')
    await new Promise((r) => setTimeout(r, 20))
    expect(c.browser.state().devServers).toEqual([expect.objectContaining({ url: 'http://localhost:5173/', projectId: project.id })])
    h.ptyExit!({ exitCode: 0 })
    expect(c.browser.state().devServers).toEqual([])

    // without a window the Live Server opens in the system browser; with one, in a tab of Mindeck's
    const served = await c.router.dispatch('liveServer:start', { projectId: project.id }, { transport: 'ipc' })
    expect(served).toMatchObject({ ok: true })
    expect(openExternal).toHaveBeenCalled()
    await c.router.dispatch('liveServer:stop', { projectId: project.id }, { transport: 'ipc' })
    const host = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, { get: (t, k: string) => (t[k] ??= vi.fn()) })
    c.browser.attach(host as never)
    await c.router.dispatch('liveServer:start', { projectId: project.id }, { transport: 'ipc' })
    expect(c.browser.state().tabs.some((t) => t.url.startsWith('http://127.0.0.1:'))).toBe(true)
    await c.router.dispatch('liveServer:stop', { projectId: project.id }, { transport: 'ipc' })
    await new Promise((r) => setTimeout(r, 50))
    expect(pushed).toContain('browser:state')

    // Files: the machine's files, deletes into a recoverable trash
    await writeFile(join(home, 'old.txt'), 'x')
    expect(await c.router.dispatch('finder:trash', { paths: [join(home, 'old.txt')] }, { transport: 'ipc' })).toEqual({ ok: true })
    expect(await c.router.dispatch('finder:list', { path: home }, { transport: 'ipc' })).toMatchObject({ ok: true, data: { entries: [] } })
    expect(await c.router.dispatch('finder:list', { path: home, hidden: true }, { transport: 'ipc' })).toMatchObject({ ok: true, data: { entries: [expect.objectContaining({ name: '.trash' })] } })
    if (savedHomeEnv === undefined) delete process.env.HOME
    else process.env.HOME = savedHomeEnv
  })

  it('desktop mode keeps the server config in settings; history is kept as files in the data folder', async () => {
    const c = await core({ mode: 'desktop' })
    expect(c.info()).not.toHaveProperty('db')
    const status = await c.router.dispatch('server:configure', { remoteTerminal: true }, { transport: 'ipc' })
    expect(status).toMatchObject({ ok: true, data: { config: { remoteTerminal: true } } })
    expect(c.info().remoteTerminal).toBe(true)
    expect(c.settings.get().server?.remoteTerminal).toBe(true)
  })
})

describe('createCore — Mindeck license', () => {
  it('a licensed core refuses work until its account may run Mindeck; signing in stays possible', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_credentials' } }), { status: 401 }))
    const c = await core({ cloud: { url: 'http://cloud.test', enforced: true, fetch: fetch as unknown as typeof globalThis.fetch } })
    const ipcCall = (channel: string, payload?: unknown) => c.router.dispatch(channel, payload, { transport: 'ipc' })
    expect(await ipcCall('projects:list')).toMatchObject({ ok: false, error: { code: 'license-required' } })
    expect(await ipcCall('cloud:status')).toMatchObject({ ok: true, data: { enforced: true, allowed: false, state: 'signed_out' } })
    expect(await ipcCall('app:info')).toMatchObject({ ok: true })
    expect(await ipcCall('cloud:login', { email: 'a@b.de', password: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_credentials' }
    })
    expect(fetch).toHaveBeenCalledWith('http://cloud.test/v1/auth/login', expect.objectContaining({ method: 'POST' }))
    for (const channel of ['cloud:logout', 'cloud:refresh']) expect(await ipcCall(channel)).toMatchObject({ ok: true })
    for (const [channel, payload] of [
      ['cloud:register', { email: 'a@b.de', password: 'long enough!', locale: 'de' }],
      ['cloud:forgotPassword', { email: 'a@b.de' }],
      ['cloud:resendVerification', undefined],
      ['cloud:checkout', undefined]
    ] as const) {
      expect((await ipcCall(channel, payload)).ok).toBe(false) // the fake cloud refuses everything — but it was asked
    }
  })
})

describe('createCore — assistant end to end (scripted model)', () => {
  it('runs an agent through the router: context, tools, permission round-trip, push events', async () => {
    const saved = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    const steps = [
      { blocks: [{ type: 'tool_call', id: 't1', name: 'memory_create_note', input: { title: 'Plan', body: 'b', reason: 'remember' } }], stopReason: 'tool_use' },
      { blocks: [{ type: 'tool_call', id: 't2', name: 'shell_run', input: { command: 'ls', reason: 'look' } }], stopReason: 'tool_use' },
      { blocks: [{ type: 'text', text: 'done' }], stopReason: 'end_turn' }
    ]
    const seen: { system: string; context: string }[] = []
    const provider = {
      stream: async (req: { system: string; messages: { blocks: { text?: string }[] }[] }, onText: (t: string) => void) => {
        seen.push({ system: req.system, context: String(req.messages[0].blocks[0].text) })
        const step = steps.shift()!
        if (step.stopReason === 'end_turn') onText('done')
        return { message: { role: 'assistant', blocks: step.blocks }, stopReason: step.stopReason, model: 'm', usage: { inputTokens: 1, outputTokens: 1 }, serverTools: [] }
      },
      verify: async () => {}
    }
    try {
      const c = await core({
        serverConfig: { enabled: false, lan: false, port: 0, remoteTerminal: false },
        providerFactory: { create: () => provider as never }
      })
      await c.router.dispatch('memory:createVault', undefined, { transport: 'ipc' })
      const pushed: string[] = []
      let pending: string | undefined
      c.hub.subscribe((channel, payload) => {
        pushed.push(channel)
        if (channel === 'permission:request') pending = (payload as { id: string }).id
      })
      const added = (await c.router.dispatch('projects:add', { path: process.env.MINDECK_HOME! }, { transport: 'ipc' })) as { data: { id: string } }
      const sent = await c.router.dispatch(
        'ai:send',
        { text: 'Plan my week', agentId: 'coding', projectId: added.data.id },
        { transport: 'remote', deviceId: 'phone' }
      )
      expect(sent).toMatchObject({ ok: true })
      for (let i = 0; i < 100 && !pending; i += 1) await new Promise((r) => setTimeout(r, 5))
      expect(await c.router.dispatch('permission:respond', { id: pending!, decision: 'once' }, { transport: 'remote', deviceId: 'phone' })).toEqual({ ok: true })
      await c.assistant.idle()
      const id = (sent as { data: { conversationId: string } }).data.conversationId
      const conv = (await c.router.dispatch('ai:conversation', { id }, { transport: 'ipc' })) as { data: { messages: { parts: { status?: string; output?: string }[] }[] } }
      const parts = conv.data.messages[1].parts
      expect(parts[0]).toMatchObject({ status: 'done', output: 'Created Plan.md' })
      expect(parts[1]).toMatchObject({ status: 'denied' }) // remote + shell switch off
      expect(seen[0].context).toContain('Memory vault "Mindeck"')
      expect(seen[0].context).toContain('Active project:')
      expect(pushed).toEqual(expect.arrayContaining(['ai:delta', 'ai:message', 'permission:request', 'permission:resolved', 'events:event', 'ai:conversationsChanged']))
      const recent = (await c.router.dispatch('events:recent', { conversationId: id }, { transport: 'ipc' })) as { data: { type: string }[] }
      expect(recent.data.map((e) => e.type)).toEqual(expect.arrayContaining(['agent.started', 'permission.granted', 'tool.completed', 'tool.denied', 'agent.completed']))
      expect((await c.router.dispatch('ai:runs', {}, { transport: 'ipc' })) as { data: unknown[] }).toMatchObject({ data: [{ status: 'completed' }] })
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = saved
    }
  })
})

describe('standalone server entry', () => {
  it('runs a coding agent session: hooks and memory reach it over the local endpoint', async () => {
    process.env.MINDECK_CLAUDE_BIN = '/opt/fake-claude'
    const c = await core({ mode: 'desktop', notify: vi.fn() })
    delete process.env.MINDECK_CLAUDE_BIN
    const call = async <T,>(channel: string, payload?: unknown) => {
      const res = await c.router.dispatch(channel, payload, { transport: 'ipc' })
      if (!res.ok) throw new Error(res.error.message)
      return res.data as T
    }
    const project = await call<{ id: string }>('projects:add', { path: await tempDir() })
    expect(await call('agents:list')).toEqual([])
    const session = await call<{ id: string; status: string }>('agents:create', { kind: 'claude-code', projectId: project.id })
    expect(session.status).toBe('starting')
    expect(h.ptyArgs.at(-1)).toMatch(/^exec \/opt\/fake-claude --session-id /) // MINDECK_CLAUDE_BIN
    const { MINDECK_HOOK_URL: hookUrl, MINDECK_TOKEN: token } = h.ptyEnv!
    const post = (url: string, body: unknown) =>
      fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

    expect((await post(hookUrl, { hook_event_name: 'UserPromptSubmit', prompt: 'hello' })).status).toBe(204)
    const detail = await call<{ status: string; messages: { role: string }[] }>('agents:get', { id: session.id })
    expect(detail.status).toBe('working')
    expect(detail.messages[0].role).toBe('user')
    const mcp = await post(hookUrl.replace('/hooks/', '/mcp/'), { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(((await mcp.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name)).toContain('memory_search')
    await expect(call('agents:create', { kind: 'claude-code', projectId: 'nope' })).rejects.toThrow('Project not found')
    await call('agents:openInEditor', { id: session.id })
    expect(openInVsCode).toHaveBeenCalledWith(expect.any(String), expect.anything())
  })

  it('reads its config from the environment', () => {
    expect(serverConfigFromEnv({})).toEqual({ enabled: true, lan: false, port: 7420, remoteTerminal: false })
    expect(serverConfigFromEnv({ MINDECK_PORT: '8000', MINDECK_LAN: '1', MINDECK_REMOTE_TERMINAL: 'true' })).toEqual({
      enabled: true,
      lan: true,
      port: 8000,
      remoteTerminal: true
    })
    expect(serverConfigFromEnv({ MINDECK_PORT: 'abc' }).port).toBe(7420)
    expect(serverConfigFromEnv({ MINDECK_PORT: '70000' }).port).toBe(7420)
    expect(serverConfigFromEnv({ MINDECK_PORT: '0' }).port).toBe(0)
  })

  it('`pair` prints a code without starting anything', async () => {
    expect(await run(['pair'], {})).toBeNull()
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Code: {2}[A-Z2-9]{4}-[A-Z2-9]{4}/))
  })

  it('starts, prints a pairing code while no device is paired, serves the API', async () => {
    const c = (await run([], { MINDECK_PORT: '0', MINDECK_WEB_ROOT: join(process.env.MINDECK_HOME!, 'web') }))!
    cores.push(c)
    expect(c.server.status().running).toBe(true)
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('listening on'))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Mindeck pairing'))

    // second start with a paired device: no banner; default web root
    const { code } = await c.auth.createPairingCode()
    await c.auth.pair(code, 'x')
    vi.mocked(console.log).mockClear()
    const again = (await run([], { MINDECK_PORT: '0' }))!
    cores.push(again)
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Mindeck pairing'))
  })

  it('fails loudly when the port is taken', async () => {
    const first = (await run([], { MINDECK_PORT: '0' }))!
    cores.push(first)
    const port = String(first.server.status().urls[0].split(':').pop())
    await expect(run([], { MINDECK_PORT: port })).rejects.toThrow('could not start')
  })
})
