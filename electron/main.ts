import { app, BrowserWindow, ipcMain, shell } from 'electron'
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
import { wonePaths } from './main/lib/paths'
import { SettingsService } from './main/services/settings/SettingsService'
import { DbService } from './main/services/db/DbService'
import { MIGRATIONS } from './main/services/db/migrations'
import { runSelfCheck } from './main/services/db/selfCheck'
import { EventBus, NoopEventSink } from './main/services/events/EventBus'

// main/preload are bundled as CommonJS (Electron's well-supported default), so
// __dirname is natively available — no import.meta shim needed.

// electron-vite injects the dev server URL in development.
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

let mainWindow: BrowserWindow | null = null
let systemService: SystemService | null = null
let dbService: DbService | null = null

/** Broadcast a push event to every live renderer. */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false, // frameless — custom window controls live in TopStatusBar
    titleBarStyle: 'hidden',
    backgroundColor: '#04060b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Emit maximize state changes so the renderer can swap the maximize/restore icon.
  const emitMaxState = () =>
    mainWindow?.webContents.send('window:maximized-changed', mainWindow.isMaximized())
  mainWindow.on('maximize', emitMaxState)
  mainWindow.on('unmaximize', emitMaxState)

  // Pause telemetry sampling while the window is hidden/minimized (save energy).
  mainWindow.on('minimize', () => systemService?.setPaused(true))
  mainWindow.on('restore', () => systemService?.setPaused(false))
  mainWindow.on('hide', () => systemService?.setPaused(true))
  mainWindow.on('show', () => systemService?.setPaused(false))

  // Open external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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

async function registerServices(): Promise<void> {
  // userData/wone holds all local app data — every location derives from paths.ts.
  const paths = wonePaths()
  await mkdir(paths.dataDir, { recursive: true })

  const settingsService = new SettingsService(paths.settingsFile)
  await settingsService.init()

  // A native-module/ABI mismatch must not white-screen the app: log an
  // actionable message and boot without the DB (P2A has no DB consumers yet).
  try {
    dbService = new DbService({ file: paths.dbFile, backupsDir: paths.backupsDir })
    const result = dbService.migrate(MIGRATIONS)
    console.log(`[db] open — schema v${result.to}`)
  } catch (err) {
    dbService = null
    console.error('[db] failed to open. Native module mismatch? Run: npm run rebuild\n', err)
  }

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

  eventBus.emit('app.started', { payload: { version: app.getVersion() } })

  if (!app.isPackaged && dbService) {
    const expectedVersion = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0)
    try {
      await runSelfCheck({ dataDir: paths.dataDir, db: dbService, expectedVersion })
      console.log('[selfcheck] ok')
    } catch (err) {
      console.error('[selfcheck] FAILED\n', err)
    }
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
  dbService?.close()
  dbService = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
