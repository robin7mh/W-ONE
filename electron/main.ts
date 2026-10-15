import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, Notification, powerMonitor, protocol, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { migrateLegacyData, mindeckPaths } from './main/lib/paths'
import { electronCipher, electronPlatform } from './main/platform/electron'
import { createCore, type Core } from './main/core/createCore'
import { bindIpc } from './ipc/registry'
import { autoUpdater } from 'electron-updater'
import { cloudConfig } from './main/services/cloud/config'
import { UpdateService } from './main/services/update/UpdateService'
import { createBrowserHost } from './main/platform/browser/host'
import { isFullScreenKey } from './main/platform/browser/shortcuts'
import { FILE_SCHEME, serveFile } from './main/platform/fileProtocol'

/** After this long without keyboard or mouse, the trial clock pauses. */
const IDLE_SECONDS = 5 * 60

// main/preload are bundled as CommonJS (Electron's well-supported default), so
// __dirname is natively available — no import.meta shim needed.

// electron-vite injects the dev server URL in development.
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

let mainWindow: BrowserWindow | null = null
let core: Core | null = null
let updates: UpdateService | null = null

// Previews in the Files module (images, video, audio) come from local files through this scheme.
protocol.registerSchemesAsPrivileged([{ scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

/** Mindeck's own page — the only one its window ever shows, and the only one IPC answers. */
function isAppUrl(url: string): boolean {
  return DEV_SERVER_URL ? url.startsWith(DEV_SERVER_URL) : url.startsWith(pathToFileURL(join(__dirname, '../renderer/index.html')).href)
}

/**
 * A link clicked in the UI (an agent's answer, a note): web addresses open in
 * Mindeck's browser (or the system's, as the user prefers), mail in the mail
 * app — and nothing else leaves the app.
 */
function openLink(url: string): void {
  if (/^https?:\/\//i.test(url)) {
    if (!core?.browser.openFromApp(url)) void shell.openExternal(url)
  } else if (/^mailto:/i.test(url)) {
    void shell.openExternal(url)
  }
}

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
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = win

  // The browser's web views live in this window (the core starts before any window).
  const browserHost = createBrowserHost(win, core!.browser.hostEvents())
  core!.browser.attach(browserHost)

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    // No shell outlives its window (on macOS the app itself keeps running).
    core?.terminal.killAll()
    core?.browser.detach()
    browserHost.dispose()
    if (mainWindow === win) mainWindow = null
  })

  // Emit maximize state changes so the renderer can swap the maximize/restore icon.
  const emitMaxState = () => win.webContents.send('window:maximized-changed', win.isMaximized())
  win.on('maximize', emitMaxState)
  win.on('unmaximize', emitMaxState)

  // ⌃⌘F / F11: full screen, before the page and the menu see the key (the pages' own views do the same).
  const mac = process.platform === 'darwin'
  win.webContents.on('before-input-event', (event, input) => {
    if (!isFullScreenKey(input, mac)) return
    event.preventDefault()
    win.setFullScreen(!win.isFullScreen())
  })

  // macOS hides the traffic lights in fullscreen; the top bar drops their gap.
  const emitFullScreen = () => win.webContents.send('window:fullscreen-changed', win.isFullScreen())
  win.on('enter-full-screen', emitFullScreen)
  win.on('leave-full-screen', emitFullScreen)

  // Pause telemetry sampling while the window is hidden/minimized (save energy).
  win.on('minimize', () => core?.system.setPaused(true))
  win.on('restore', () => core?.system.setPaused(false))
  win.on('hide', () => core?.system.setPaused(true))
  win.on('show', () => core?.system.setPaused(false))

  // The editor vetoes unloading while files have unsaved edits — ask the user.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Discard changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes in the editor.',
      detail: 'Close anyway and lose them?'
    })
    if (choice === 0) event.preventDefault()
  })

  // The window never navigates away from Mindeck: links go to the browser (or their app) instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openLink(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    openLink(url)
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
ipcMain.on('window:toggle-fullscreen', () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()))
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)
ipcMain.handle('window:is-fullscreen', () => mainWindow?.isFullScreen() ?? false)

/** An agent needs the user: tell them — unless they are looking at Mindeck already. */
function notify(title: string, body: string): void {
  if (!Notification.isSupported() || BrowserWindow.getFocusedWindow()) return
  const n = new Notification({ title, body })
  n.on('click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  n.show()
}

async function startCore(): Promise<void> {
  // ~/Mindeck/{data,vault} holds everything — every location derives from paths.ts.
  const paths = mindeckPaths()
  const legacyDir = join(app.getPath('userData'), 'mindeck')
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
    webRoot: join(__dirname, '../renderer'),
    notify,
    // The packaged app needs a license; `npm run dev` only with MINDECK_LICENSE=required.
    cloud: cloudConfig(app.isPackaged),
    isUserActive: () => powerMonitor.getSystemIdleTime() < IDLE_SECONDS
  })
  core.hub.subscribe(broadcast)

  // Self-update only where it can work: the packaged app (GitHub Releases).
  updates = new UpdateService({
    updater: app.isPackaged ? autoUpdater : null,
    currentVersion: app.getVersion(),
    onStatus: (status) => broadcast('update:status', status)
  })
  const u = updates
  core.router.register('update:status', () => u.status())
  core.router.register('update:check', () => u.check())
  core.router.register('update:install', () => u.install())
  u.start()

  bindIpc(core.router, isAppUrl)
  await core.server.start()
}

app.whenReady().then(async () => {
  protocol.handle(FILE_SCHEME, (request) =>
    serveFile(request, {
      thumbnail: async (path, size) => {
        const image = await nativeImage.createThumbnailFromPath(path, { width: size, height: size })
        return image.isEmpty() ? null : image.toPNG()
      }
    })
  )
  await startCore()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// will-quit, not before-quit: closing the windows can still be cancelled (unsaved
// editor changes), and the core must survive that.
app.on('will-quit', () => {
  const running = core
  core = null
  updates?.dispose()
  void running?.dispose().catch(() => {})
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
