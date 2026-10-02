import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newDb } from 'pg-mem'
import { tempDir } from './helpers'

const h = vi.hoisted(() => ({ pool: undefined as unknown, ptyData: undefined as undefined | ((d: string) => void) }))
vi.mock('node-pty', () => ({
  spawn: () => ({
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
      data: { mode: 'server', version: '1.2.3', remoteTerminal: false, db: { connected: true, schema: 0 } }
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

describe('standalone server entry', () => {
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
