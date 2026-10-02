import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { migrateLegacyData, wonePaths } from './main/lib/paths'
import { electronCipher, electronPlatform } from './main/platform/electron'
import { createCore, type Core } from './main/core/createCore'
import { bindIpc } from './ipc/registry'

// main/preload are bundled as CommonJS (Electron's well-supported default), so
// __dirname is natively available — no import.meta shim needed.

// electron-vite injects the dev server URL in development.
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

let mainWindow: BrowserWindow | null = null
let core: Core | null = null

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
    core?.terminal.killAll()
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
  win.on('minimize', () => core?.system.setPaused(true))
  win.on('restore', () => core?.system.setPaused(false))
  win.on('hide', () => core?.system.setPaused(true))
  win.on('show', () => core?.system.setPaused(false))

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

async function startCore(): Promise<void> {
  // ~/W-ONE/{data,vault} holds everything — every location derives from paths.ts.
  const paths = wonePaths()
  const legacyDir = join(app.getPath('userData'), 'wone')
  try {
    if (migrateLegacyData(paths, legacyDir)) console.log(`[data] copied ${legacyDir} → ${paths.dataDir}`)
  } catch (err) {
    console.error('[data] migration from the old data folder failed — starting fresh\n', err)
  }

  core = await createCore({
    mode: 'desktop',
    version: app.getVersion(),
    paths,
    platform: electronPlatform,
    cipher: electronCipher(),
    // The embedded network API (opt-in) serves the packaged renderer as web UI.
    webRoot: join(__dirname, '../renderer')
  })
  core.hub.subscribe(broadcast)
  bindIpc(core.router)
  await core.server.start()
}

app.whenReady().then(async () => {
  await startCore()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  const running = core
  core = null
  void running?.dispose().catch(() => {})
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
