import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newDb } from 'pg-mem'
import { tempDir } from './helpers'

const h = vi.hoisted(() => ({
  pool: undefined as unknown,
  ptyData: undefined as undefined | ((d: string) => void),
  ptyEnv: undefined as undefined | Record<string, string>,
  ptyArgs: [] as string[]
}))
vi.mock('node-pty', () => ({
  spawn: (_file: string, args: string[], opts: { env: Record<string, string> }) => ({
    ...((h.ptyEnv = opts.env), (h.ptyArgs = args), {}),
    pid: 1,
    onData: (cb: (d: string) => void) => (h.ptyData = cb),
    onExit: () => {},
    write: () => {},
    resize: () => {},
    kill: () => {}
  })
}))
vi.mock('../../../electron/main/services/system/collectors', () => ({
  collect: async () => ({ cpu: 1 }),
  collectProcesses: async () => [],
  currentUser: async () => ({ name: 'Ada Lovelace', firstName: 'Ada' })
}))
vi.mock('../../../electron/main/services/db/DbService', async (orig) => ({
  ...(await orig<typeof import('../../../electron/main/services/db/DbService')>()),
  createPool: () => h.pool
}))

import { createCore, type Core } from '../../../electron/main/core/createCore'
import { headlessPlatform } from '../../../electron/main/platform/headless'
import { wonePaths } from '../../../electron/main/lib/paths'
import { run, serverConfigFromEnv } from '../../../server/main'

const memPool = () => {
  const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg()
  return new Pool()
}
const deadPool = () => ({
  query: vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))),
  connect: vi.fn(),
  end: vi.fn(async () => Promise.reject(new Error('already closed')))
})

const cores: Core[] = []
let savedHome: string | undefined
beforeEach(async () => {
  savedHome = process.env.WONE_HOME
  process.env.WONE_HOME = await tempDir()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
  if (savedHome === undefined) delete process.env.WONE_HOME
  else process.env.WONE_HOME = savedHome
})

async function core(opts: Partial<Parameters<typeof createCore>[0]> = {}) {
  const c = await createCore({ mode: 'server', version: '1.2.3', paths: wonePaths(), platform: headlessPlatform, ...opts })
  cores.push(c)
  return c
}

describe('createCore', () => {
  it('wires every service onto one router; info reflects the database', async () => {
    h.pool = memPool()
    const c = await core({ serverConfig: { enabled: false, lan: false, port: 0, remoteTerminal: false } })
    await c.dbReady
    expect(await c.router.dispatch('app:info', undefined, { transport: 'ipc' })).toMatchObject({
      ok: true,
      data: { mode: 'server', version: '1.2.3', remoteTerminal: false, db: { connected: true, schema: 1 } }
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
    const project = await c.router.dispatch('projects:add', { path: process.env.WONE_HOME! }, { transport: 'ipc' })
    const projectId = (project as { data: { id: string } }).data.id
    await c.router.dispatch('context:reindex', { projectId }, { transport: 'ipc' })
    const term = await c.router.dispatch('terminal:create', { projectId }, { transport: 'ipc' })
    expect(term).toMatchObject({ ok: true, data: { projectId } })
    h.ptyData!('hello')
    await new Promise((r) => setTimeout(r, 30))
    c.system.setRemoteClients(1)
    await new Promise((r) => setTimeout(r, 30))
    c.system.setRemoteClients(0)
    expect(pushed).toEqual(expect.arrayContaining(['context:progress', 'terminal:data', 'system:tick']))
  })

  it('desktop mode keeps the server config in settings; a dead database is only a warning', async () => {
    h.pool = deadPool()
    const c = await core({ mode: 'desktop' })
    await c.dbReady
    expect(c.info().db).toEqual({ connected: false, schema: undefined })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Postgres not reachable'))
    const status = await c.router.dispatch('server:configure', { remoteTerminal: true }, { transport: 'ipc' })
    expect(status).toMatchObject({ ok: true, data: { config: { remoteTerminal: true } } })
    expect(c.info().remoteTerminal).toBe(true)
    expect(c.settings.get().server?.remoteTerminal).toBe(true)
  })
})

describe('createCore — assistant end to end (scripted model)', () => {
  it('runs an agent through the router: context, tools, permission round-trip, push events', async () => {
    const saved = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    h.pool = deadPool()
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
      await c.dbReady
      await c.router.dispatch('memory:createVault', undefined, { transport: 'ipc' })
      const pushed: string[] = []
      let pending: string | undefined
      c.hub.subscribe((channel, payload) => {
        pushed.push(channel)
        if (channel === 'permission:request') pending = (payload as { id: string }).id
      })
      const added = (await c.router.dispatch('projects:add', { path: process.env.WONE_HOME! }, { transport: 'ipc' })) as { data: { id: string } }
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
      expect(seen[0].context).toContain('Memory vault "W-ONE"')
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
    process.env.WONE_CLAUDE_BIN = '/opt/fake-claude'
    const c = await core({ mode: 'desktop', notify: vi.fn() })
    delete process.env.WONE_CLAUDE_BIN
    const call = async <T,>(channel: string, payload?: unknown) => {
      const res = await c.router.dispatch(channel, payload, { transport: 'ipc' })
      if (!res.ok) throw new Error(res.error.message)
      return res.data as T
    }
    const project = await call<{ id: string }>('projects:add', { path: await tempDir() })
    expect(await call('agents:list')).toEqual([])
    const session = await call<{ id: string; status: string }>('agents:create', { kind: 'claude-code', projectId: project.id })
    expect(session.status).toBe('starting')
    expect(h.ptyArgs.at(-1)).toMatch(/^exec \/opt\/fake-claude --session-id /) // WONE_CLAUDE_BIN
    const { WONE_HOOK_URL: hookUrl, WONE_TOKEN: token } = h.ptyEnv!
    const post = (url: string, body: unknown) =>
      fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

    expect((await post(hookUrl, { hook_event_name: 'UserPromptSubmit', prompt: 'hello' })).status).toBe(204)
    const detail = await call<{ status: string; messages: { role: string }[] }>('agents:get', { id: session.id })
    expect(detail.status).toBe('working')
    expect(detail.messages[0].role).toBe('user')
    const mcp = await post(hookUrl.replace('/hooks/', '/mcp/'), { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(((await mcp.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name)).toContain('memory_search')
    await expect(call('agents:create', { kind: 'claude-code', projectId: 'nope' })).rejects.toThrow('Project not found')
  })

  it('reads its config from the environment', () => {
    expect(serverConfigFromEnv({})).toEqual({ enabled: true, lan: false, port: 7420, remoteTerminal: false })
    expect(serverConfigFromEnv({ WONE_PORT: '8000', WONE_LAN: '1', WONE_REMOTE_TERMINAL: 'true' })).toEqual({
      enabled: true,
      lan: true,
      port: 8000,
      remoteTerminal: true
    })
    expect(serverConfigFromEnv({ WONE_PORT: 'abc' }).port).toBe(7420)
    expect(serverConfigFromEnv({ WONE_PORT: '70000' }).port).toBe(7420)
    expect(serverConfigFromEnv({ WONE_PORT: '0' }).port).toBe(0)
  })

  it('`pair` prints a code without starting anything', async () => {
    expect(await run(['pair'], {})).toBeNull()
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Code: {2}[A-Z2-9]{4}-[A-Z2-9]{4}/))
  })

  it('starts, prints a pairing code while no device is paired, serves the API', async () => {
    h.pool = deadPool()
    const c = (await run([], { WONE_PORT: '0', WONE_WEB_ROOT: join(process.env.WONE_HOME!, 'web') }))!
    cores.push(c)
    expect(c.server.status().running).toBe(true)
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('listening on'))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('W-ONE pairing'))

    // second start with a paired device: no banner; default web root
    const { code } = await c.auth.createPairingCode()
    await c.auth.pair(code, 'x')
    vi.mocked(console.log).mockClear()
    const again = (await run([], { WONE_PORT: '0' }))!
    cores.push(again)
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('W-ONE pairing'))
  })

  it('fails loudly when the port is taken', async () => {
    h.pool = deadPool()
    const first = (await run([], { WONE_PORT: '0' }))!
    cores.push(first)
    const port = String(first.server.status().urls[0].split(':').pop())
    await expect(run([], { WONE_PORT: port })).rejects.toThrow('could not start')
  })
})
