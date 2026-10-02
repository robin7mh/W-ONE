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
  contentsHandlers = new Map<string, Handler>()
  webContents = {
    send: vi.fn(),
    on: (event: string, fn: Handler) => this.contentsHandlers.set(event, fn),
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
  messageBox: vi.fn((): number => 1),
  dark: true,
  migrate: vi.fn((_legacy?: string): boolean => false),
  coreOpts: undefined as undefined | Record<string, unknown>,
  hubListener: undefined as undefined | ((channel: string, payload: unknown) => void),
  bound: vi.fn(),
  core: {
    system: { setPaused: vi.fn() },
    terminal: { killAll: vi.fn() },
    server: { start: vi.fn(async () => {}) },
    dispose: vi.fn(async () => {}),
    router: { id: 'router' }
  }
}))
vi.mock('electron', () => ({
  app: {
    whenReady: () => new Promise<void>((r) => (h.ready = r)),
    on: (event: string, fn: (...a: unknown[]) => unknown) => h.appHandlers.set(event, fn),
    getVersion: () => '0.1.0',
    getPath: () => '/userData',
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
  shell: { openExternal: h.openExternal },
  dialog: { showMessageBoxSync: (...a: unknown[]) => h.messageBox(...(a as [])) }
}))
vi.mock('../../../electron/main/lib/paths', () => ({
  wonePaths: () => ({ homeDir: '/h', dataDir: '/h/data' }),
  migrateLegacyData: (_paths: unknown, legacy: string) => h.migrate(legacy)
}))
vi.mock('../../../electron/main/platform/electron', () => ({ electronPlatform: { kind: 'desktop' }, electronCipher: () => ({ kind: 'cipher' }) }))
vi.mock('../../../electron/ipc/registry', () => ({ bindIpc: h.bound }))
vi.mock('../../../electron/main/core/createCore', () => ({
  createCore: vi.fn(async (opts: Record<string, unknown>) => {
    h.coreOpts = opts
    return {
      ...h.core,
      hub: {
        subscribe: (fn: (channel: string, payload: unknown) => void) => {
          h.hubListener = fn
          return () => {}
        }
      }
    }
  })
}))

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
  h.dark = true
  h.coreOpts = undefined
  h.hubListener = undefined
  h.bound.mockReset()
  h.migrate.mockReset().mockReturnValue(false)
  h.core.system.setPaused.mockReset()
  h.core.terminal.killAll.mockReset()
  h.core.server.start.mockReset().mockResolvedValue(undefined)
  h.core.dispose.mockReset().mockResolvedValue(undefined)
  h.quit.mockReset()
})
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform })
  delete process.env.ELECTRON_RENDERER_URL
})

describe('main process boot', () => {
  it('builds the desktop core, binds its router to IPC, starts the embedded server, then opens the window (dev, macOS, dark)', async () => {
    const win = await boot({ devUrl: 'http://localhost:5173' })
    expect(h.coreOpts).toMatchObject({ mode: 'desktop', version: '0.1.0', platform: { kind: 'desktop' }, cipher: { kind: 'cipher' } })
    expect(String(h.coreOpts!.webRoot)).toMatch(/renderer$/)
    expect(h.bound).toHaveBeenCalledWith(h.core.router)
    expect(h.core.server.start).toHaveBeenCalled()
    expect(win.opts).toMatchObject({ titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 17 }, backgroundColor: '#04060b' })
    expect(win.opts).not.toHaveProperty('frame')
    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173')
  })

  it('packaged on Linux in light mode: frameless window, file URL', async () => {
    h.dark = false
    const win = await boot({ platform: 'linux' })
    expect(win.opts).toMatchObject({ frame: false, backgroundColor: '#eef2f7' })
    expect(win.loadFile).toHaveBeenCalledWith(expect.stringMatching(/renderer[\\/]index\.html$/))
  })

  it('logs a successful legacy-data copy and survives a failing one', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    h.migrate.mockReturnValueOnce(true)
    await boot()
    expect(h.migrate).toHaveBeenCalledWith(expect.stringMatching(/userData[\\/]wone$/))
    expect(log.mock.calls[0][0]).toMatch(/^\[data\] copied .*wone → \/h\/data$/)

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
    const win = await boot()
    const system = h.core.system

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
    expect(h.core.terminal.killAll).toHaveBeenCalled()
  })

  it('asks before an unload the editor vetoed: Cancel keeps the window, Discard closes it', async () => {
    const win = await boot()
    const veto = win.contentsHandlers.get('will-prevent-unload')!
    const cancel = { preventDefault: vi.fn() }
    veto(cancel)
    expect(h.messageBox).toHaveBeenCalledWith(win, expect.objectContaining({ message: 'You have unsaved changes in the editor.' }))
    expect(cancel.preventDefault).not.toHaveBeenCalled() // the veto stands
    h.messageBox.mockReturnValueOnce(0)
    const discard = { preventDefault: vi.fn() }
    veto(discard)
    expect(discard.preventDefault).toHaveBeenCalled() // ignore the veto → close
  })

  it('window-control IPC acts on the current window, and is safe without one', async () => {
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

describe('core push events', () => {
  it('forwards every hub event to each live window', async () => {
    const win = await boot()
    const dead = new FakeWindow({})
    dead.destroyed = true
    h.hubListener!('system:tick', { cpu: 1 })
    expect(win.webContents.send).toHaveBeenCalledWith('system:tick', { cpu: 1 })
    expect(dead.webContents.send).not.toHaveBeenCalled()
  })
})

describe('app lifecycle', () => {
  it('disposes the core once before quitting', async () => {
    await boot()
    h.appHandlers.get('will-quit')!()
    expect(h.core.dispose).toHaveBeenCalledTimes(1)
    h.appHandlers.get('will-quit')!() // second quit: core already released
    expect(h.core.dispose).toHaveBeenCalledTimes(1)
  })

  it('quit before anything started is harmless; a failing dispose is swallowed', async () => {
    await boot({ ready: false })
    expect(() => h.appHandlers.get('will-quit')!()).not.toThrow()
    h.core.dispose.mockRejectedValue(new Error('pool gone'))
    await boot()
    h.appHandlers.get('will-quit')!()
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
