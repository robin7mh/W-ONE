import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { SystemSnapshot } from '@shared/types/system'
import { ProjectRegistry } from './main/services/projects/registry'
import { ProjectService } from './main/services/projects/ProjectService'
import { registerProjectIpc } from './ipc/projects.ipc'
import { SystemService } from './main/services/system/SystemService'
import { registerSystemIpc } from './ipc/system.ipc'

// main/preload are bundled as CommonJS (Electron's well-supported default), so
// __dirname is natively available — no import.meta shim needed.

// electron-vite injects the dev server URL in development.
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

let mainWindow: BrowserWindow | null = null
let systemService: SystemService | null = null

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
  // userData/wone holds all local app data (registry now, DB/vault later).
  const dataDir = join(app.getPath('userData'), 'wone')
  const projectService = new ProjectService(new ProjectRegistry(dataDir))
  await projectService.init()
  registerProjectIpc(projectService)

  systemService = new SystemService((snapshot: SystemSnapshot) => broadcast('system:tick', snapshot))
  registerSystemIpc(systemService)
}

app.whenReady().then(async () => {
  await registerServices()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => systemService?.dispose())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
