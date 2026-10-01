import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- electron double -----------------------------------------------------------
type Handler = (...a: unknown[]) => unknown
class FakeWindow {
  static all: FakeWindow[] = []
  static getAllWindows = () => FakeWindow.all
  handlers = new Map<string, Handler>()
  opts: Record<string, unknown>
  destroyed = false
  maximized = false
  fullScreen = false
  openHandler?: (d: { url: string }) => unknown
  webContents = {
    send: vi.fn(),
    isDestroyed: () => this.destroyed,
    setWindowOpenHandler: (fn: (d: { url: string }) => unknown) => (this.openHandler = fn)
  }
  show = vi.fn()
  minimize = vi.fn()
  maximize = vi.fn()
  unmaximize = vi.fn()
  close = vi.fn()
  loadURL = vi.fn(async () => {})
  loadFile = vi.fn(async () => {})
  isMaximized = () => this.maximized
  isFullScreen = () => this.fullScreen
  constructor(opts: Record<string, unknown>) {
    this.opts = opts
    FakeWindow.all.push(this)
  }
  on(event: string, fn: Handler) {
    this.handlers.set(event, fn)
    return this
  }
  emit(event: string) {
    this.handlers.get(event)?.()
  }
}

const h = vi.hoisted(() => ({
  ready: undefined as undefined | (() => void),
  appHandlers: new Map<string, (...a: unknown[]) => unknown>(),
  ipcOn: new Map<string, (...a: unknown[]) => unknown>(),
  ipcHandle: new Map<string, (...a: unknown[]) => unknown>(),
  quit: vi.fn(),
  openExternal: vi.fn(async () => {}),
  dark: true,
  migrate: vi.fn((): boolean => false),
  db: { ping: vi.fn(async () => {}), migrate: vi.fn(async () => ({ from: 0, to: 0, applied: [] })), close: vi.fn(async () => {}) },
  services: {} as Record<string, { opts?: Record<string, unknown>; [k: string]: unknown }>,
  registered: [] as string[]
}))

vi.mock('electron', () => ({
  app: {
    whenReady: () => new Promise<void>((r) => (h.ready = r)),
    on: (event: string, fn: (...a: unknown[]) => unknown) => h.appHandlers.set(event, fn),
    getVersion: () => '0.1.0',
    quit: h.quit
  },
  BrowserWindow: FakeWindow,
  ipcMain: {
    on: (ch: string, fn: (...a: unknown[]) => unknown) => h.ipcOn.set(ch, fn),
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => h.ipcHandle.set(ch, fn)
  },
  nativeTheme: {
    get shouldUseDarkColors() {
      return h.dark
    }
  },
  shell: { openExternal: h.openExternal }
}))
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(async () => {}) }))

const service = (name: string, methods: Record<string, unknown> = {}) =>
  class {
    opts: Record<string, unknown> | undefined
    constructor(...args: unknown[]) {
      this.opts = args[0] as Record<string, unknown>
      Object.assign(this, methods)
      h.services[name] = this as never
    }
  }
vi.mock('../../../electron/main/lib/paths', () => ({
  wonePaths: () => ({
    homeDir: '/h',
    dataDir: '/h/data',
    settingsFile: '/h/data/settings.json',
    defaultVaultRoot: '/h/vault',
    legacyDataDir: '/old/wone'
  }),
  migrateLegacyData: () => h.migrate()
}))
vi.mock('../../../electron/main/services/settings/SettingsService', () => ({
  SettingsService: service('settings', { init: vi.fn(async () => {}) })
}))
vi.mock('../../../electron/main/services/projects/registry', () => ({ ProjectRegistry: service('registry') }))
vi.mock('../../../electron/main/services/projects/ProjectService', () => ({
  ProjectService: service('projects', {
    init: vi.fn(async () => {}),
    getProjectPath: (id: string) => `/p/${id}`,
    list: () => [{ id: 'p1', name: 'demo', path: '/p/p1' }]
  })
}))
vi.mock('../../../electron/main/services/system/SystemService', () => ({
  SystemService: class {
    send: (s: unknown) => void
    setPaused = vi.fn()
    dispose = vi.fn()
    constructor(send: (s: unknown) => void) {
      this.send = send
      h.services.system = this as never
    }
  }
}))
vi.mock('../../../electron/main/services/context/contextStore', () => ({ ContextStore: service('contextStore') }))
vi.mock('../../../electron/main/services/context/ContextService', () => ({ ContextService: service('context') }))
vi.mock('../../../electron/main/services/memory/VaultService', () => ({ VaultService: service('vault', { dispose: vi.fn() }) }))
vi.mock('../../../electron/main/services/terminal/TerminalService', () => ({
  TerminalService: service('terminal', { killAll: vi.fn() })
}))
vi.mock('../../../electron/main/services/events/EventBus', () => ({
  EventBus: service('events', { emit: vi.fn() }),
  NoopEventSink: class {}
}))
vi.mock('../../../electron/main/services/db/DbService', () => ({
  DbService: class {
    ping = h.db.ping
    migrate = h.db.migrate
    close = h.db.close
  },
  createPool: vi.fn(() => ({})),
  databaseUrl: () => 'postgres://wone:secret@127.0.0.1:54329/wone'
}))
vi.mock('../../../electron/main/services/db/migrations', () => ({ MIGRATIONS: [] }))
vi.mock('../../../electron/ipc/projects.ipc', () => ({ registerProjectIpc: () => h.registered.push('projects') }))
vi.mock('../../../electron/ipc/system.ipc', () => ({ registerSystemIpc: () => h.registered.push('system') }))
vi.mock('../../../electron/ipc/context.ipc', () => ({ registerContextIpc: () => h.registered.push('context') }))
vi.mock('../../../electron/ipc/memory.ipc', () => ({ registerMemoryIpc: () => h.registered.push('memory') }))
vi.mock('../../../electron/ipc/terminal.ipc', () => ({ registerTerminalIpc: () => h.registered.push('terminal') }))

const realPlatform = process.platform
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

/** Fresh module instance (main.ts runs its top-level wiring on import). */
async function boot(opts: { platform?: NodeJS.Platform; devUrl?: string; ready?: boolean } = {}) {
  Object.defineProperty(process, 'platform', { value: opts.platform ?? 'darwin' })
  if (opts.devUrl) process.env.ELECTRON_RENDERER_URL = opts.devUrl
  else delete process.env.ELECTRON_RENDERER_URL
  vi.resetModules()
  await import('../../../electron/main')
  if (opts.ready !== false) {
    h.ready!()
    await flush()
  }
  return FakeWindow.all[0]
}

beforeEach(() => {
  FakeWindow.all = []
  h.appHandlers.clear()
  h.ipcOn.clear()
  h.ipcHandle.clear()
  h.registered.length = 0
  h.services = {}
  h.dark = true
  h.migrate.mockReset().mockReturnValue(false)
  h.db.ping.mockReset().mockResolvedValue(undefined)
  h.db.migrate.mockReset().mockResolvedValue({ from: 0, to: 0, applied: [] })
  h.db.close.mockReset().mockResolvedValue(undefined)
  h.quit.mockReset()
})
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform })
  delete process.env.ELECTRON_RENDERER_URL
})

describe('main process boot', () => {
  it('wires every service and IPC module, connects the database, then opens the window (dev, macOS, dark)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const win = await boot({ devUrl: 'http://localhost:5173' })
    expect(h.registered).toEqual(['projects', 'system', 'context', 'memory', 'terminal'])
    expect(win.opts).toMatchObject({ titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 17 }, backgroundColor: '#04060b' })
    expect(win.opts).not.toHaveProperty('frame')
    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173')
    expect(log).toHaveBeenCalledWith('[db] connected — schema v0')
    expect((h.services.events.emit as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('app.started', { payload: { version: '0.1.0' } })
  })

  it('packaged on Linux in light mode: frameless window, file URL, DB unreachable is only a warning', async () => {
    h.dark = false
    h.db.ping.mockRejectedValue(new Error('ECONNREFUSED'))
    h.db.close.mockRejectedValue(new Error('already closed'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const win = await boot({ platform: 'linux' })
    expect(win.opts).toMatchObject({ frame: false, backgroundColor: '#eef2f7' })
    expect(win.loadFile).toHaveBeenCalledWith(expect.stringMatching(/renderer[\\/]index\.html$/))
    expect(warn.mock.calls[0][0]).toContain('postgres://wone:***@127.0.0.1:54329/wone')
    expect(warn.mock.calls[0][0]).toContain('ECONNREFUSED')
  })

  it('logs a successful legacy-data copy and survives a failing one', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    h.migrate.mockReturnValueOnce(true)
    await boot()
    expect(log).toHaveBeenCalledWith('[data] copied /old/wone → /h/data')

    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.migrate.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    await boot()
    expect(err.mock.calls[0][0]).toContain('migration from the old data folder failed')
  })
})

describe('window wiring', () => {
  it('forwards window state, pauses telemetry, routes links outside, cleans up on close', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const win = await boot()
    const system = h.services.system as unknown as { setPaused: ReturnType<typeof vi.fn> }

    win.emit('ready-to-show')
    expect(win.show).toHaveBeenCalled()
    win.maximized = true
    win.emit('maximize')
    win.emit('unmaximize')
    expect(win.webContents.send).toHaveBeenCalledWith('window:maximized-changed', true)
    win.fullScreen = true
    win.emit('enter-full-screen')
    win.emit('leave-full-screen')
    expect(win.webContents.send).toHaveBeenCalledWith('window:fullscreen-changed', true)

    for (const [event, paused] of [['minimize', true], ['restore', false], ['hide', true], ['show', false]] as const) {
      win.emit(event)
      expect(system.setPaused).toHaveBeenLastCalledWith(paused)
    }

    expect(win.openHandler!({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(h.openExternal).toHaveBeenCalledWith('https://example.com')

    win.emit('closed')
    expect(h.services.terminal.killAll).toHaveBeenCalled()
  })

  it('window-control IPC acts on the current window, and is safe without one', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await boot({ ready: false })
    // before any window exists
    h.ipcOn.get('window:minimize')!()
    h.ipcOn.get('window:toggle-maximize')!()
    h.ipcOn.get('window:close')!()
    expect(h.ipcHandle.get('window:is-maximized')!()).toBe(false)
    expect(h.ipcHandle.get('window:is-fullscreen')!()).toBe(false)

    h.ready!()
    await flush()
    const win = FakeWindow.all[0]
    h.ipcOn.get('window:minimize')!()
    h.ipcOn.get('window:toggle-maximize')!()
    expect(win.maximize).toHaveBeenCalled()
    win.maximized = true
    h.ipcOn.get('window:toggle-maximize')!()
    expect(win.unmaximize).toHaveBeenCalled()
    expect(h.ipcHandle.get('window:is-maximized')!()).toBe(true)
    win.fullScreen = true
    expect(h.ipcHandle.get('window:is-fullscreen')!()).toBe(true)
    h.ipcOn.get('window:close')!()
    expect(win.minimize).toHaveBeenCalled()
    expect(win.close).toHaveBeenCalled()

    // after the window closed, a second window from "activate" becomes current
    win.emit('closed')
    expect(h.ipcHandle.get('window:is-maximized')!()).toBe(false)
    FakeWindow.all = []
    h.appHandlers.get('activate')!()
    expect(FakeWindow.all).toHaveLength(1)
    const second = FakeWindow.all[0]
    win.emit('closed') // a stale window closing must not clear the new one
    second.maximized = true
    expect(h.ipcHandle.get('window:is-maximized')!()).toBe(true)
    h.appHandlers.get('activate')!() // windows exist → no new one
    expect(FakeWindow.all).toHaveLength(1)
  })
})

describe('service callbacks and broadcast', () => {
  it('pushes events to every live window and resolves projects', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const win = await boot()
    const dead = new FakeWindow({})
    dead.destroyed = true

    ;(h.services.system as unknown as { send: (s: unknown) => void }).send({ cpu: 1 })
    expect(win.webContents.send).toHaveBeenCalledWith('system:tick', { cpu: 1 })
    expect(dead.webContents.send).not.toHaveBeenCalled()

    const ctx = h.services.context.opts as { resolvePath: (id: string) => string; onProgress: (p: unknown) => void }
    expect(ctx.resolvePath('p1')).toBe('/p/p1')
    ctx.onProgress({ done: true })
    expect(win.webContents.send).toHaveBeenCalledWith('context:progress', { done: true })

    ;(h.services.vault.opts as { onChange: (c: unknown) => void }).onChange({ paths: ['a.md'] })
    expect(win.webContents.send).toHaveBeenCalledWith('memory:changed', { paths: ['a.md'] })

    const term = h.services.terminal.opts as { emit: (c: string, p: unknown) => void; resolveProject: (id: string) => unknown }
    term.emit('terminal:data', { id: 't' })
    expect(win.webContents.send).toHaveBeenCalledWith('terminal:data', { id: 't' })
    expect(term.resolveProject('p1')).toMatchObject({ name: 'demo' })
    expect(term.resolveProject('nope')).toBeUndefined()
  })
})

describe('app lifecycle', () => {
  it('disposes services and closes the database before quitting', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await boot()
    h.appHandlers.get('before-quit')!()
    expect((h.services.system as unknown as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled()
    expect(h.services.vault.dispose).toHaveBeenCalled()
    expect(h.services.terminal.killAll).toHaveBeenCalled()
    expect(h.db.close).toHaveBeenCalled()
    h.db.close.mockRejectedValueOnce(new Error('x'))
    h.appHandlers.get('before-quit')!() // second quit: db already released
    expect(h.db.close).toHaveBeenCalledTimes(1)
  })

  it('quit before anything started is harmless; a failing DB close is swallowed', async () => {
    await boot({ ready: false })
    expect(() => h.appHandlers.get('before-quit')!()).not.toThrow()

    vi.spyOn(console, 'log').mockImplementation(() => {})
    h.db.close.mockRejectedValue(new Error('pool gone'))
    await boot()
    h.appHandlers.get('before-quit')!()
    await flush()
  })

  it('quits when all windows close, except on macOS', async () => {
    await boot({ ready: false })
    h.appHandlers.get('window-all-closed')!()
    expect(h.quit).not.toHaveBeenCalled()
    await boot({ platform: 'win32', ready: false })
    h.appHandlers.get('window-all-closed')!()
    expect(h.quit).toHaveBeenCalled()
  })
})
