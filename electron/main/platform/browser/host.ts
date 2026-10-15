import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  nativeTheme,
  session,
  shell,
  WebContentsView,
  type HandlerDetails,
  type MenuItemConstructorOptions,
  type WebContents,
  type WindowOpenHandlerResponse
} from 'electron'
import type { BrowserGo, ViewBounds } from '@shared/types/browser'
import { labels } from '../../services/browser/labels'
import type { AutomationTarget, BrowserHost, BrowserHostEvents, MenuEntry, TabNavigation } from '../../services/browser/types'
import { contextMenu, type ContextActions } from './menus'
import { BROWSER_PARTITION, configureBrowserSession, type SessionTarget } from './session'
import { isFullScreenKey, matchShortcut } from './shortcuts'

/** Where views go before the browser was first on screen (agent tabs still need a size). */
const DEFAULT_BOUNDS: ViewBounds = { x: 0, y: 0, width: 1280, height: 800 }
/** CDP stays attached this long after an agent's last command. */
const DEBUGGER_IDLE_MS = 60_000
/** Favicons bigger than this are not worth carrying around. */
const MAX_FAVICON_BYTES = 32 * 1024
const MAC = process.platform === 'darwin'

/** The window's host of the moment — the browser session asks it (one window at a time). */
let current: SessionTarget | null = null

/** Popup size from window.open's features ("width=500,height=600"), within reason. */
export function popupSize(features: string): { width: number; height: number } {
  const get = (key: string, fallback: number) => {
    const m = new RegExp(`(?:^|,)\\s*${key}\\s*=\\s*(\\d+)`, 'i').exec(features)
    return m ? Math.max(320, Math.min(1600, Number(m[1]))) : fallback
  }
  return { width: get('width', 520), height: get('height', 680) }
}

/** Native menu items from the core's entries. */
export function menuTemplate(entries: MenuEntry[]): MenuItemConstructorOptions[] {
  return entries.map((e) =>
    'separator' in e
      ? { type: 'separator' }
      : { label: e.label, enabled: e.enabled ?? true, click: () => e.run(), ...(e.checked !== undefined ? { type: 'checkbox', checked: e.checked } : {}) }
  )
}

/**
 * The browser's web views inside the Mindeck window (architecture §12.9):
 * one WebContentsView per tab, in the `persist:mindeck-browser` profile —
 * sandboxed, no preload, no Node, nothing of Mindeck's bridge. Views sit on
 * top of the UI; the renderer tells where (`setBounds`) and freezes them as a
 * picture while its own menus or dialogs cover that area.
 */
export class ElectronBrowserHost implements BrowserHost {
  private readonly views = new Map<string, WebContentsView>()
  private readonly zooms = new Map<string, number>()
  private readonly idle = new Map<string, NodeJS.Timeout>()
  private shown?: string
  private bounds: ViewBounds | null = null
  /** The browser's pane has the focus: its keys work while the Mindeck UI has the keyboard. */
  private keys = true
  private frozen = false
  /** Bumped by every freeze and unfreeze: a picture that arrives after an unfreeze does not freeze. */
  private freezeSeq = 0
  private readonly target: SessionTarget
  private readonly onMainInput = (event: Electron.Event, input: Electron.Input) => {
    if (!this.bounds || !this.keys) return
    const action = matchShortcut(input, MAC)
    if (!action) return
    event.preventDefault()
    this.events.shortcut(action)
  }

  constructor(
    private readonly win: BrowserWindow,
    private readonly events: BrowserHostEvents
  ) {
    this.target = { events, tabOf: (contents) => this.tabOf(contents) }
    current = this.target
    configureBrowserSession(session.fromPartition(BROWSER_PARTITION), () => current)
    // The browser's keys also work while the Mindeck UI (the address bar) has the focus.
    win.webContents.on('before-input-event', this.onMainInput)
  }

  create(tabId: string, url: string, opts: { agent?: boolean; zoom?: number; muted?: boolean; history?: TabNavigation } = {}): void {
    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
        safeDialogs: true,
        // An agent's tab keeps running while nobody looks at it.
        backgroundThrottling: !opts.agent
      }
    })
    view.setVisible(false)
    this.win.contentView.addChildView(view)
    this.views.set(tabId, view)
    if (opts.zoom && opts.zoom !== 1) this.zooms.set(tabId, opts.zoom)
    const contents = view.webContents
    if (opts.muted) contents.setAudioMuted(true)
    this.wire(tabId, contents)
    this.layout()
    // Failures arrive as did-fail-load. A tab from the last session gets its back/forward list back
    // (and just its page, should the list not come back at all).
    const load = () => void contents.loadURL(url).catch(() => {})
    if (!opts.history) return load()
    void contents.navigationHistory.restore({ entries: opts.history.entries, index: opts.history.index }).catch(() => {
      if (!contents.isDestroyed() && !contents.getURL()) load()
    })
  }

  navigation(tabId: string): TabNavigation | undefined {
    const c = this.contents(tabId)
    if (!c) return undefined
    const entries = c.navigationHistory.getAllEntries().map((e) => ({ url: e.url, title: e.title }))
    return { entries, index: c.navigationHistory.getActiveIndex() }
  }

  destroy(tabId: string): void {
    const view = this.views.get(tabId)
    if (!view) return
    this.views.delete(tabId)
    this.zooms.delete(tabId)
    clearTimeout(this.idle.get(tabId))
    this.idle.delete(tabId)
    // On window close the window is gone already; its views' pages still need closing.
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  load(tabId: string, url: string): void {
    void this.contents(tabId)?.loadURL(url).catch(() => {})
  }

  go(tabId: string, action: BrowserGo): void {
    const c = this.contents(tabId)
    if (!c) return
    if (action === 'back') c.navigationHistory.goBack()
    else if (action === 'forward') c.navigationHistory.goForward()
    else if (action === 'reload') c.reload()
    else if (action === 'hardReload') c.reloadIgnoringCache()
    else c.stop()
  }

  show(tabId: string | undefined): void {
    this.shown = tabId
    this.layout()
  }

  setBounds(bounds: ViewBounds | null, focused = true): void {
    this.bounds = bounds
    this.keys = focused
    this.layout()
  }

  async freeze(): Promise<string | null> {
    const view = this.visible()
    if (!view || this.frozen) return null
    const seq = ++this.freezeSeq
    const image = await view.webContents.capturePage()
    if (seq !== this.freezeSeq || image.isEmpty()) return null
    this.frozen = true
    this.layout()
    return `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}`
  }

  unfreeze(): void {
    this.freezeSeq += 1
    this.frozen = false
    this.layout()
  }

  find(tabId: string, text: string, opts: { forward: boolean; next: boolean }): void {
    // Electron's `findNext` means "start a new search".
    this.contents(tabId)?.findInPage(text, { forward: opts.forward, findNext: !opts.next })
  }

  stopFind(tabId: string): void {
    this.contents(tabId)?.stopFindInPage('clearSelection')
  }

  setZoom(tabId: string, factor: number): void {
    this.zooms.set(tabId, factor)
    this.contents(tabId)?.setZoomFactor(factor)
  }

  setMuted(tabId: string, muted: boolean): void {
    this.contents(tabId)?.setAudioMuted(muted)
  }

  devtools(tabId: string): void {
    const c = this.contents(tabId)
    if (!c) return
    if (c.isDevToolsOpened()) c.closeDevTools()
    else c.openDevTools({ mode: 'detach' })
  }

  print(tabId: string): void {
    this.contents(tabId)?.print()
  }

  popup(entries: MenuEntry[]): void {
    Menu.buildFromTemplate(menuTemplate(entries)).popup({ window: this.win })
  }

  focusUi(): void {
    this.win.webContents.focus()
  }

  setTheme(theme: 'dark' | 'light' | 'system'): void {
    nativeTheme.themeSource = theme
  }

  automation(tabId: string): AutomationTarget {
    const view = this.views.get(tabId)
    if (!view) throw Object.assign(new Error('The tab has no page loaded'), { code: 'not-loaded' })
    const c = view.webContents
    return {
      cdp: async <T>(method: string, params?: Record<string, unknown>) => {
        if (!c.debugger.isAttached()) c.debugger.attach('1.3')
        this.keepAttached(tabId, c)
        return (await c.debugger.sendCommand(method, params)) as T
      },
      capture: async () => {
        let image = await c.capturePage(undefined, { stayHidden: true })
        if (image.getSize().width > 1600) image = image.resize({ width: 1600 })
        const { width, height } = image.getSize()
        return { png: image.toPNG().toString('base64'), width, height }
      }
    }
  }

  dispose(): void {
    if (!this.win.isDestroyed()) this.win.webContents.removeListener('before-input-event', this.onMainInput)
    for (const id of [...this.views.keys()]) this.destroy(id)
    if (current === this.target) current = null
  }

  // --- internals ------------------------------------------------------------------

  private contents(tabId: string): WebContents | undefined {
    return this.views.get(tabId)?.webContents
  }

  private tabOf(contents: WebContents | null | undefined): string | undefined {
    for (const [id, view] of this.views) if (view.webContents === contents) return id
    return undefined
  }

  private visible(): WebContentsView | undefined {
    return this.bounds && this.shown ? this.views.get(this.shown) : undefined
  }

  /** Every view gets the place (hidden ones too, so pictures of them have a size); only the shown one is visible. */
  private layout(): void {
    const zoom = this.win.webContents.getZoomFactor()
    const b = this.bounds ?? DEFAULT_BOUNDS
    const rect = { x: Math.round(b.x * zoom), y: Math.round(b.y * zoom), width: Math.round(b.width * zoom), height: Math.round(b.height * zoom) }
    for (const [id, view] of this.views) {
      view.setBounds(rect)
      view.setVisible(!!this.bounds && !this.frozen && id === this.shown)
    }
  }

  private keepAttached(tabId: string, c: WebContents): void {
    clearTimeout(this.idle.get(tabId))
    this.idle.set(
      tabId,
      setTimeout(() => {
        this.idle.delete(tabId)
        if (!c.isDestroyed() && c.debugger.isAttached()) c.debugger.detach()
      }, DEBUGGER_IDLE_MS)
    )
  }

  private nav(c: WebContents, url: string) {
    return { url, canGoBack: c.navigationHistory.canGoBack(), canGoForward: c.navigationHistory.canGoForward() }
  }

  private wire(tabId: string, c: WebContents): void {
    const ev = this.events
    c.setWindowOpenHandler((details) => this.windowOpen(tabId, details))
    c.on('did-create-window', (child) => this.popupWindow(child))
    c.on('did-start-loading', () => ev.loading(tabId, true))
    c.on('did-stop-loading', () => ev.loading(tabId, false))
    c.on('did-navigate', (_e, url) => {
      // Chromium zooms per site; Mindeck remembers the user's zoom per tab and site.
      const zoom = this.zooms.get(tabId)
      if (zoom) c.setZoomFactor(zoom)
      ev.navigated(tabId, this.nav(c, url))
    })
    c.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) ev.navigated(tabId, { ...this.nav(c, url), inPage: true })
    })
    c.on('page-title-updated', (_e, title) => ev.title(tabId, title))
    c.on('page-favicon-updated', (_e, favicons) => void this.favicon(tabId, favicons[0]))
    c.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      // -3 (ERR_ABORTED): the user went elsewhere or stopped — not a failure.
      if (isMainFrame && code !== -3) ev.failed(tabId, { code, description, url })
    })
    c.on('render-process-gone', () => ev.crashed(tabId))
    c.on('audio-state-changed', (e) => ev.audible(tabId, e.audible))
    c.on('zoom-changed', (_e, direction) => ev.zoomed(tabId, direction))
    c.on('found-in-page', (_e, r) => ev.found({ tabId, active: r.activeMatchOrdinal, matches: r.matches }))
    c.on('console-message', (e) =>
      ev.console(tabId, { level: e.level, message: e.message, ...(e.sourceId ? { source: e.sourceId } : {}), ...(e.lineNumber ? { line: e.lineNumber } : {}), at: new Date().toISOString() })
    )
    c.on('context-menu', (_e, params) =>
      this.popup(contextMenu(params, this.actions(tabId, c), labels(ev.locale()), ev.searchLabel(), app.getApplicationNameForProtocol('https://')))
    )
    c.on('focus', () => ev.focused(tabId))
    c.on('before-input-event', (event, input) => {
      if (isFullScreenKey(input, MAC)) {
        event.preventDefault()
        return this.win.setFullScreen(!this.win.isFullScreen())
      }
      const action = matchShortcut(input, MAC)
      if (!action) return
      event.preventDefault()
      ev.shortcut(action, tabId)
    })
  }

  /** The favicon as a data URL, fetched in the page's own profile (the Mindeck UI loads no remote images). */
  private async favicon(tabId: string, url: string | undefined): Promise<void> {
    if (!url) return this.events.favicon(tabId, undefined)
    if (url.startsWith('data:')) return this.events.favicon(tabId, url.length <= MAX_FAVICON_BYTES * 1.4 ? url : undefined)
    try {
      const res = await session.fromPartition(BROWSER_PARTITION).fetch(url)
      const type = (res.headers.get('content-type')?.split(';')[0] || 'image/x-icon').trim().toLowerCase()
      // Only pictures: some servers answer /favicon.ico with an HTML page.
      if (!res.ok || !type.startsWith('image/')) return
      const bytes = Buffer.from(await res.arrayBuffer())
      if (!bytes.length || bytes.length > MAX_FAVICON_BYTES) return
      this.events.favicon(tabId, `data:${type};base64,${bytes.toString('base64')}`)
    } catch {
      // no icon then
    }
  }

  /** Popups with an opener (sign in with Google, GitHub, Apple) stay real windows; every other new window becomes a tab. */
  private windowOpen(tabId: string, details: HandlerDetails): WindowOpenHandlerResponse {
    const { url, disposition, features } = details
    if (disposition === 'new-window' && features && /^(https?:|about:blank)/i.test(url)) {
      return {
        action: 'allow',
        outlivesOpener: false,
        overrideBrowserWindowOptions: {
          ...popupSize(features),
          autoHideMenuBar: true,
          webPreferences: { partition: BROWSER_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
        }
      }
    }
    if (/^https?:/i.test(url)) this.events.openTab(url, { background: disposition === 'background-tab', opener: tabId })
    return { action: 'deny' }
  }

  private popupWindow(child: BrowserWindow): void {
    child.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) this.events.openTab(url, { background: false })
      return { action: 'deny' }
    })
  }

  private actions(tabId: string, c: WebContents): ContextActions {
    return {
      openTab: (url) => this.events.openTab(url, { background: true, opener: tabId }),
      handoff: (url) => void shell.openExternal(url),
      copyText: (text) => clipboard.writeText(text),
      saveImage: (url) => c.downloadURL(url),
      copyImage: (x, y) => c.copyImageAt(x, y),
      edit: (action) => c[action](),
      replaceMisspelling: (word) => c.replaceMisspelling(word),
      addToDictionary: (word) => void c.session.addWordToSpellCheckerDictionary(word),
      search: (text) => this.events.command(tabId, 'search', text),
      back: () => c.navigationHistory.goBack(),
      forward: () => c.navigationHistory.goForward(),
      reload: () => c.reload(),
      canGoBack: c.navigationHistory.canGoBack(),
      canGoForward: c.navigationHistory.canGoForward(),
      sendToAgent: () => this.events.command(tabId, 'sendToAgent'),
      inspect: (x, y) => c.inspectElement(x, y)
    }
  }
}

export function createBrowserHost(win: BrowserWindow, events: BrowserHostEvents): ElectronBrowserHost {
  return new ElectronBrowserHost(win, events)
}
