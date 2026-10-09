import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { newDb } from 'pg-mem'
import { tempDir } from './helpers'

// --- electron double -------------------------------------------------------
const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, req: unknown) => unknown>()
  const rendererListeners = new Map<string, Set<(...a: unknown[]) => void>>()
  return {
    handlers,
    rendererListeners,
    userData: '/tmp/wone-userdata',
    ipcMain: { handle: vi.fn((ch: string, fn: (e: unknown, r: unknown) => unknown) => handlers.set(ch, fn)) },
    app: { getPath: vi.fn(() => electron.userData) },
    exposed: {} as Record<string, unknown>,
    contextBridge: {
      exposeInMainWorld: vi.fn((key: string, api: unknown) => {
        electron.exposed[key] = api
      })
    },
    ipcRenderer: {
      send: vi.fn(),
      invoke: vi.fn(async (...a: unknown[]) => ({ invoked: a })),
      on: vi.fn((ch: string, fn: (...a: unknown[]) => void) => {
        if (!rendererListeners.has(ch)) rendererListeners.set(ch, new Set())
        rendererListeners.get(ch)!.add(fn)
      }),
      removeListener: vi.fn((ch: string, fn: (...a: unknown[]) => void) => rendererListeners.get(ch)?.delete(fn))
    }
  }
})
vi.mock('electron', () => ({
  ipcMain: electron.ipcMain,
  app: electron.app,
  contextBridge: electron.contextBridge,
  ipcRenderer: electron.ipcRenderer
}))

import { bindIpc } from '../../../electron/ipc/registry'
import { Router } from '../../../electron/ipc/router'
import { IPC_CHANNELS } from '../../../src/shared/ipc/contract'
import { registerContextIpc } from '../../../electron/ipc/context.ipc'
import { registerProjectIpc } from '../../../electron/ipc/projects.ipc'
import { registerSystemIpc } from '../../../electron/ipc/system.ipc'
import { registerMemoryIpc } from '../../../electron/ipc/memory.ipc'
import { registerTerminalIpc } from '../../../electron/ipc/terminal.ipc'
import { registerFilesIpc } from '../../../electron/ipc/files.ipc'
import { registerAgentsIpc } from '../../../electron/ipc/agents.ipc'
import { DbService, DEFAULT_DB_URL, createPool, databaseUrl, type DbPool } from '../../../electron/main/services/db/DbService'
import { migrateLegacyData, wonePaths } from '../../../electron/main/lib/paths'

const call = (channel: string, req?: unknown) => electron.handlers.get(channel)!({}, req)

describe('ipc router', () => {
  const ipcCtx = { transport: 'ipc' as const }
  const remoteCtx = { transport: 'remote' as const, deviceId: 'd1' }

  it('wraps results as { ok: true, data } and passes the call context', async () => {
    const router = new Router()
    const seen = vi.fn(() => [])
    router.register('projects:list', seen)
    expect(router.has('projects:list')).toBe(true)
    expect(router.has('nope')).toBe(false)
    expect(await router.dispatch('projects:list', undefined, ipcCtx)).toEqual({ ok: true, data: [] })
    expect(seen).toHaveBeenCalledWith(undefined, ipcCtx)
  })

  it('turns thrown errors into { ok: false } with code and message', async () => {
    const router = new Router()
    router.register('projects:list', () => {
      throw Object.assign(new Error('nope'), { code: 'not-found' })
    })
    expect(await router.dispatch('projects:list', undefined, ipcCtx)).toEqual({ ok: false, error: { code: 'not-found', message: 'nope' } })
  })

  it('falls back to a generic code and String(err) for odd throwables', async () => {
    const router = new Router()
    router.register('projects:list', () => {
      throw 'plain string'
    })
    expect(await router.dispatch('projects:list', undefined, ipcCtx)).toEqual({ ok: false, error: { code: 'error', message: 'plain string' } })
    router.register('projects:list', () => {
      throw null
    })
    expect(await router.dispatch('projects:list', undefined, ipcCtx)).toEqual({ ok: false, error: { code: 'error', message: 'null' } })
  })

  it('rejects unknown channels and invalid payloads before the handler runs', async () => {
    const router = new Router()
    const handler = vi.fn()
    router.register('memory:read', handler)
    expect(await router.dispatch('evil:channel', {}, ipcCtx)).toMatchObject({ ok: false, error: { code: 'unknown-channel' } })
    const bad = await router.dispatch('memory:read', { path: 42 }, ipcCtx)
    expect(bad).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect((bad as { error: { message: string } }).error.message).toContain('path:')
    expect(await router.dispatch('memory:read', null, ipcCtx)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(handler).not.toHaveBeenCalled()
  })

  it('applies the access rules to remote callers only', async () => {
    let terminal = false
    const router = new Router({ remoteTerminal: () => terminal })
    router.register('projects:pickFolder', () => null)
    router.register('terminal:list', () => [])
    expect(await router.dispatch('projects:pickFolder', undefined, ipcCtx)).toEqual({ ok: true, data: null })
    expect(await router.dispatch('projects:pickFolder', undefined, remoteCtx)).toMatchObject({ ok: false, error: { code: 'desktop-only' } })
    expect(await router.dispatch('terminal:list', undefined, remoteCtx)).toMatchObject({ ok: false, error: { code: 'remote-terminal-disabled' } })
    terminal = true
    expect(await router.dispatch('terminal:list', undefined, remoteCtx)).toEqual({ ok: true, data: [] })
    expect(await new Router().dispatch('terminal:list', undefined, remoteCtx)).toMatchObject({ ok: false, error: { code: 'unknown-channel' } })
    const defaults = new Router()
    defaults.register('terminal:list', () => [])
    expect(await defaults.dispatch('terminal:list', undefined, remoteCtx)).toMatchObject({ error: { code: 'remote-terminal-disabled' } })
  })

  it('binds every contract channel to the window IPC through the router', async () => {
    electron.handlers.clear()
    const router = new Router()
    router.register('projects:list', () => ['p'] as never)
    bindIpc(router)
    expect([...electron.handlers.keys()].sort()).toEqual([...IPC_CHANNELS].sort())
    expect(await call('projects:list')).toEqual({ ok: true, data: ['p'] })
  })
})

describe('ipc handler modules bind every channel to its service', () => {
  /** A service double whose every method records its call and echoes args. */
  const spyService = () =>
    new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
      get: (target, key: string) => (target[key] ??= vi.fn((...args: unknown[]) => ({ method: key, args })))
    })

  it.each([
    ['context', registerContextIpc, [['context:get', { projectId: 'p' }, 'get', ['p']], ['context:reindex', { projectId: 'p' }, 'reindex', ['p']]]],
    [
      'projects',
      registerProjectIpc,
      [
        ['projects:list', undefined, 'list', []],
        ['projects:pickFolder', undefined, 'pickFolder', []],
        ['projects:add', { path: '/x' }, 'add', ['/x']],
        ['projects:remove', { id: 'i' }, 'remove', ['i']],
        ['projects:refresh', { id: 'i' }, 'refresh', ['i']],
        ['projects:openInEditor', { id: 'i' }, 'openInEditor', ['i']],
        ['projects:githubDesktop', undefined, 'githubDesktop', []],
        ['projects:openInGitHubDesktop', { id: 'i' }, 'openInGitHubDesktop', ['i']],
        ['projects:openFile', { id: 'i', file: 'f', line: 3 }, 'openFile', ['i', 'f', 3]]
      ]
    ],
    [
      'system',
      registerSystemIpc,
      [
        ['system:subscribe', undefined, 'subscribe', []],
        ['system:unsubscribe', undefined, 'unsubscribe', []],
        ['system:snapshot', undefined, 'snapshot', []],
        ['system:user', undefined, 'user', []]
      ]
    ],
    [
      'memory',
      registerMemoryIpc,
      [
        ['memory:status', undefined, 'status', []],
        ['memory:createVault', undefined, 'createVault', []],
        ['memory:pickVault', undefined, 'pickVault', []],
        ['memory:list', undefined, 'list', []],
        ['memory:read', { path: 'a.md' }, 'read', ['a.md']],
        ['memory:write', { path: 'a.md', raw: 'r' }, 'write', ['a.md', 'r']],
        ['memory:create', { title: 't', folder: 'f' }, 'create', ['t', 'f']],
        ['memory:trash', { path: 'a.md' }, 'trash', ['a.md']],
        ['memory:graph', undefined, 'graph', []],
        ['memory:search', { query: 'q' }, 'search', ['q']],
        ['memory:setGraphStyle', { mode: 'single', color: 'pink' }, 'setGraphStyle', [{ mode: 'single', color: 'pink' }]],
        ['memory:reveal', undefined, 'reveal', []],
        ['memory:folders', undefined, 'folders', []],
        ['memory:writeBody', { path: 'a.md', body: 'b' }, 'writeBody', ['a.md', 'b']],
        ['memory:createFolder', { parent: 'p', name: 'n' }, 'createFolder', ['p', 'n']],
        ['memory:rename', { path: 'a.md', title: 't' }, 'rename', ['a.md', 't']],
        ['memory:move', { path: 'a.md', folder: 'f' }, 'move', ['a.md', 'f']],
        ['memory:moveFolder', { folder: 'f', into: 'g' }, 'moveFolder', ['f', 'g']],
        ['memory:link', { from: 'a.md', to: 'b.md' }, 'link', ['a.md', 'b.md']],
        ['memory:unlink', { from: 'a.md', to: 'b.md' }, 'unlink', ['a.md', 'b.md']],
        ['memory:setVault', { path: '/v' }, 'setVault', ['/v']]
      ]
    ],
    [
      'terminal',
      registerTerminalIpc,
      [
        ['terminal:create', { projectId: 'p' }, 'create', [{ projectId: 'p' }]],
        ['terminal:create', undefined, 'create', [{}]],
        ['terminal:create', { cols: 80, rows: 24 }, 'create', [{ cols: 80, rows: 24 }]],
        ['terminal:list', undefined, 'list', []],
        ['terminal:attach', { id: 'i' }, 'attach', ['i']],
        ['terminal:write', { id: 'i', data: 'ls' }, 'write', ['i', 'ls']],
        ['terminal:resize', { id: 'i', cols: 80, rows: 24 }, 'resize', ['i', 80, 24]],
        ['terminal:kill', { id: 'i' }, 'kill', ['i']]
      ]
    ],
    [
      'files',
      registerFilesIpc,
      [
        ['files:list', { projectId: 'p' }, 'list', ['p', undefined]],
        ['files:list', { projectId: 'p', dir: 'src' }, 'list', ['p', 'src']],
        ['files:read', { projectId: 'p', path: 'a.ts' }, 'read', ['p', 'a.ts']],
        ['files:stat', { projectId: 'p', paths: ['a.ts'] }, 'stat', ['p', ['a.ts']]],
        ['files:write', { projectId: 'p', path: 'a.ts', content: 'x' }, 'write', ['p', 'a.ts', 'x', undefined]],
        ['files:write', { projectId: 'p', path: 'a.ts', content: 'x', expectedMtime: 5 }, 'write', ['p', 'a.ts', 'x', 5]]
      ]
    ],
    [
      'agents',
      registerAgentsIpc,
      [
        ['agents:detect', undefined, 'detect', []],
        ['agents:list', undefined, 'list', []],
        ['agents:get', { id: 'i' }, 'get', ['i']],
        ['agents:create', { kind: 'claude-code', projectId: 'p', isolated: true }, 'create', [{ kind: 'claude-code', projectId: 'p', isolated: true }]],
        ['agents:send', { id: 'i', text: 'hi' }, 'send', ['i', 'hi']],
        ['agents:interrupt', { id: 'i' }, 'interrupt', ['i']],
        ['agents:stop', { id: 'i' }, 'stop', ['i']],
        ['agents:resume', { id: 'i' }, 'resume', ['i']],
        ['agents:remove', { id: 'i' }, 'remove', ['i']],
        ['agents:changes', { id: 'i' }, 'changes', ['i']],
        ['agents:diff', { id: 'i', path: 'a.ts' }, 'diff', ['i', 'a.ts']],
        ['agents:accept', { id: 'i' }, 'accept', ['i']],
        ['agents:discard', { id: 'i' }, 'discard', ['i']]
      ]
    ]
  ] as const)('%s', async (_name, register, cases) => {
    const service = spyService()
    const router = new Router()
    ;(register as (r: Router, s: unknown) => void)(router, service)
    for (const [channel, req, method, args] of cases) {
      expect(await router.dispatch(channel, req, { transport: 'ipc' })).toEqual({ ok: true, data: { method, args } })
    }
  })
})

describe('DbService', () => {
  const memPool = (): DbPool => {
    // noAstCoverageCheck: pg-mem refuses re-running CREATE TABLE IF NOT EXISTS otherwise
    const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg()
    return new Pool() as unknown as DbPool
  }

  it('pings, reports version 0, migrates in order and is idempotent', async () => {
    const db = new DbService(memPool())
    await db.ping()
    expect(await db.version()).toBe(0)

    const migrations = [
      { version: 2, name: 'second', up: 'CREATE TABLE b (id TEXT PRIMARY KEY)' },
      { version: 1, name: 'first', up: 'CREATE TABLE a (id TEXT PRIMARY KEY)' }
    ]
    expect(await db.migrate(migrations)).toEqual({ from: 0, to: 2, applied: ['1_first', '2_second'] })
    expect(await db.migrate(migrations)).toEqual({ from: 2, to: 2, applied: [] })
    expect(await db.version()).toBe(2)
    await db.close()
  })

  it('rolls a failing migration back and rethrows', async () => {
    const pool = memPool()
    const db = new DbService(pool)
    await expect(
      db.migrate([{ version: 1, name: 'bad', up: 'CREATE TABLE ok_t (id TEXT); SELECT * FROM missing_table' }])
    ).rejects.toThrow()
    expect(await db.version()).toBe(0)
  })

  it('treats an empty ledger result as version 0', async () => {
    const pool: DbPool = {
      query: vi.fn(async () => ({ rows: [] })),
      connect: vi.fn(),
      end: vi.fn(async () => {})
    }
    expect(await new DbService(pool).version()).toBe(0)
  })

  it('reads the URL from WONE_DB_URL, else the docker-compose default', () => {
    expect(databaseUrl({})).toBe(DEFAULT_DB_URL)
    expect(databaseUrl({ WONE_DB_URL: 'postgres://x' })).toBe('postgres://x')
    expect(databaseUrl()).toBe(process.env.WONE_DB_URL || DEFAULT_DB_URL)
  })

  it('creates a real pg pool lazily (no connection until the first query)', async () => {
    const pool = createPool('postgres://u:p@127.0.0.1:1/db', { max: 1 }) as unknown as { options: Record<string, unknown>; end(): Promise<void> }
    expect(pool.options).toMatchObject({ connectionString: 'postgres://u:p@127.0.0.1:1/db', max: 1, connectionTimeoutMillis: 3000 })
    await pool.end()
    const defaults = createPool('postgres://u:p@127.0.0.1:1/db') as unknown as { options: Record<string, unknown>; end(): Promise<void> }
    expect(defaults.options).toMatchObject({ max: 5 })
    await defaults.end()
  })
})

describe('paths', () => {
  it('puts everything under ~/W-ONE unless WONE_HOME overrides it', () => {
    const saved = process.env.WONE_HOME
    try {
      delete process.env.WONE_HOME
      expect(wonePaths()).toEqual({
        homeDir: join(homedir(), 'W-ONE'),
        dataDir: join(homedir(), 'W-ONE', 'data'),
        settingsFile: join(homedir(), 'W-ONE', 'data', 'settings.json'),
        defaultVaultRoot: join(homedir(), 'W-ONE', 'vault'),
        devicesFile: join(homedir(), 'W-ONE', 'data', 'devices.json'),
        secretsFile: join(homedir(), 'W-ONE', 'data', 'secrets.json'),
        cloudFile: join(homedir(), 'W-ONE', 'data', 'cloud.json'),
        grantsFile: join(homedir(), 'W-ONE', 'data', 'grants.json'),
        agentsDir: join(homedir(), 'W-ONE', 'data', 'agents'),
        worktreesDir: join(homedir(), 'W-ONE', 'worktrees')
      })
      process.env.WONE_HOME = '/custom'
      expect(wonePaths().dataDir).toBe(join('/custom', 'data'))
    } finally {
      if (saved === undefined) delete process.env.WONE_HOME
      else process.env.WONE_HOME = saved
    }
  })

  it('copies the legacy data folder once and leaves a note in the original', async () => {
    const dir = await tempDir()
    const legacy = join(dir, 'userData', 'wone')
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, 'projects.json'), '{"projects":[]}')
    const paths = { ...wonePaths(), homeDir: join(dir, 'W-ONE'), dataDir: join(dir, 'W-ONE', 'data') }

    expect(migrateLegacyData(paths, legacy)).toBe(true)
    expect(await readFile(join(paths.dataDir, 'projects.json'), 'utf8')).toBe('{"projects":[]}')
    expect(existsSync(join(legacy, 'MOVED-TO-W-ONE-DATA.txt'))).toBe(true)
    expect(existsSync(join(legacy, 'projects.json'))).toBe(true) // original untouched

    expect(migrateLegacyData(paths, legacy)).toBe(false) // already migrated
    expect(migrateLegacyData({ ...paths, dataDir: join(dir, 'other') }, join(dir, 'missing'))).toBe(false)
  })
})

describe('preload bridge', () => {
  it('exposes window controls, the allowlisted invoke/on, and the platform', async () => {
    await import('../../../electron/preload')
    const api = electron.exposed.wone as Record<string, (...a: unknown[]) => unknown>
    expect(api.platform).toBe(process.platform)

    api.minimize()
    api.toggleMaximize()
    api.close()
    expect(electron.ipcRenderer.send.mock.calls.map((c) => c[0])).toEqual(['window:minimize', 'window:toggle-maximize', 'window:close'])

    await api.isMaximized()
    await api.isFullScreen()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith('window:is-maximized')
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith('window:is-fullscreen')

    expect(await api.invoke('projects:list', { x: 1 })).toEqual({ invoked: ['projects:list', { x: 1 }] })
    await expect(api.invoke('evil:channel')).rejects.toThrow('Blocked IPC channel: evil:channel')
    expect(() => api.on('evil:event', () => {})).toThrow('Blocked IPC event: evil:event')
  })

  it('forwards push events without the IPC event object and unsubscribes cleanly', async () => {
    await import('../../../electron/preload')
    const api = electron.exposed.wone as Record<string, (...a: unknown[]) => unknown>
    const emit = (ch: string, ...args: unknown[]) => [...(electron.rendererListeners.get(ch) ?? [])].forEach((l) => l({}, ...args))

    for (const [method, channel] of [
      ['onMaximizedChange', 'window:maximized-changed'],
      ['onFullScreenChange', 'window:fullscreen-changed'],
      ['on', 'system:tick']
    ] as const) {
      const cb = vi.fn()
      const off = (method === 'on' ? api.on(channel, cb) : api[method](cb)) as () => void
      emit(channel, true)
      expect(cb).toHaveBeenCalledWith(true)
      off()
      emit(channel, false)
      expect(cb).toHaveBeenCalledTimes(1)
    }
  })
})
