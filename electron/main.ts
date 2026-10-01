import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { SystemSnapshot } from '@shared/types/system'
import type { ContextProgress } from '@shared/types/context'
import { ProjectRegistry } from './main/services/projects/registry'
import { ProjectService } from './main/services/projects/ProjectService'
import { registerProjectIpc } from './ipc/projects.ipc'
import { SystemService } from './main/services/system/SystemService'
import { registerSystemIpc } from './ipc/system.ipc'
import { ContextStore } from './main/services/context/contextStore'
import { ContextService } from './main/services/context/ContextService'
import { registerContextIpc } from './ipc/context.ipc'
import { VaultService } from './main/services/memory/VaultService'
import { registerMemoryIpc } from './ipc/memory.ipc'
import { TerminalService } from './main/services/terminal/TerminalService'
import { registerTerminalIpc } from './ipc/terminal.ipc'
import type { MemoryChanged } from '@shared/types/memory'
import { migrateLegacyData, wonePaths } from './main/lib/paths'
import { SettingsService } from './main/services/settings/SettingsService'
import { DbService, createPool, databaseUrl } from './main/services/db/DbService'
import { MIGRATIONS } from './main/services/db/migrations'
import { EventBus, NoopEventSink } from './main/services/events/EventBus'

// main/preload are bundled as CommonJS (Electron's well-supported default), so
// __dirname is natively available — no import.meta shim needed.

// electron-vite injects the dev server URL in development.
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

let mainWindow: BrowserWindow | null = null
let systemService: SystemService | null = null
let vaultService: VaultService | null = null
let terminalService: TerminalService | null = null
let dbService: DbService | null = null

/** Broadcast a push event to every live renderer. */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    // macOS keeps its native traffic lights, centered in the 48px top bar;
    // elsewhere the window is frameless and TopStatusBar draws the controls.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 16, y: 17 } }
      : { frame: false }),
    // Matches --bg-void of the theme the renderer will pick by default (OS appearance).
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#04060b' : '#eef2f7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    // No shell outlives its window (on macOS the app itself keeps running).
    terminalService?.killAll()
    if (mainWindow === win) mainWindow = null
  })

  // Emit maximize state changes so the renderer can swap the maximize/restore icon.
  const emitMaxState = () => win.webContents.send('window:maximized-changed', win.isMaximized())
  win.on('maximize', emitMaxState)
  win.on('unmaximize', emitMaxState)

  // macOS hides the traffic lights in fullscreen; the top bar drops their gap.
  const emitFullScreen = () => win.webContents.send('window:fullscreen-changed', win.isFullScreen())
  win.on('enter-full-screen', emitFullScreen)
  win.on('leave-full-screen', emitFullScreen)

  // Pause telemetry sampling while the window is hidden/minimized (save energy).
  win.on('minimize', () => systemService?.setPaused(true))
  win.on('restore', () => systemService?.setPaused(false))
  win.on('hide', () => systemService?.setPaused(true))
  win.on('show', () => systemService?.setPaused(false))

  // Open external links in the OS browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- Window control IPC (invoked from preload bridge) ---
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)
ipcMain.handle('window:is-fullscreen', () => mainWindow?.isFullScreen() ?? false)

async function registerServices(): Promise<void> {
  // ~/W-ONE/{data,vault} holds everything — every location derives from paths.ts.
  const paths = wonePaths()
  try {
    if (migrateLegacyData(paths)) console.log(`[data] copied ${paths.legacyDataDir} → ${paths.dataDir}`)
  } catch (err) {
    console.error('[data] migration from the old data folder failed — starting fresh\n', err)
  }
  await mkdir(paths.dataDir, { recursive: true })

  const settingsService = new SettingsService(paths.settingsFile)
  await settingsService.init()

  // Postgres runs in Docker (docker-compose.yml). Connected in the background:
  // a stopped container never delays the window, and nothing depends on the
  // database yet (P2B), so W-ONE stays fully usable without it.
  void connectDatabase()

  // Distributes all WoneEvents; persistence sink is a no-op until the events
  // table lands in P2B. No renderer push yet (no channel in the contract).
  const eventBus = new EventBus({ sink: new NoopEventSink() })
  const projectService = new ProjectService(new ProjectRegistry(paths.dataDir))
  await projectService.init()
  registerProjectIpc(projectService)

  systemService = new SystemService((snapshot: SystemSnapshot) => broadcast('system:tick', snapshot))
  registerSystemIpc(systemService)

  const contextService = new ContextService({
    store: new ContextStore(paths.dataDir),
    resolvePath: (id) => projectService.getProjectPath(id),
    onProgress: (progress: ContextProgress) => broadcast('context:progress', progress)
  })
  registerContextIpc(contextService)

  // Memory = Obsidian-compatible markdown vault; created lazily, never at boot.
  vaultService = new VaultService({
    settings: settingsService,
    defaultRoot: paths.defaultVaultRoot,
    onChange: (change: MemoryChanged) => broadcast('memory:changed', change)
  })
  registerMemoryIpc(vaultService)

  // Interactive shells for the user (phase PT) — not an agent tool (§8.1).
  terminalService = new TerminalService({
    emit: (channel: string, payload: unknown) => broadcast(channel, payload),
    resolveProject: (id) => projectService.list().find((p) => p.id === id)
  })
  registerTerminalIpc(terminalService)

  eventBus.emit('app.started', { payload: { version: app.getVersion() } })
}

async function connectDatabase(): Promise<void> {
  const url = databaseUrl()
  const db = new DbService(createPool(url))
  try {
    await db.ping()
    const result = await db.migrate(MIGRATIONS)
    dbService = db
    console.log(`[db] connected — schema v${result.to}`)
  } catch (err) {
    await db.close().catch(() => {})
    console.warn(
      `[db] Postgres not reachable at ${url.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@')} — start it with: npm run db:up\n  ${(err as Error).message}`
    )
  }
}

app.whenReady().then(async () => {
  await registerServices()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  systemService?.dispose()
  vaultService?.dispose()
  terminalService?.killAll()
  void dbService?.close().catch(() => {})
  dbService = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
