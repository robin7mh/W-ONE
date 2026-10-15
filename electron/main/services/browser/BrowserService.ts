import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IpcEvents } from '@shared/ipc/contract'
import {
  DEFAULT_BROWSER_SETTINGS,
  type AgentAction,
  type AgentActivity,
  type BrowserAuthRequest,
  type BrowserCommand,
  type BrowserDownload,
  type BrowserGo,
  type BrowserPermissionRequest,
  type BrowserProfile,
  type BrowserSettings,
  type BrowserState,
  type BrowserSuggestion,
  type BrowserTab,
  type BrowserTool,
  type HistoryEntry,
  type TabError,
  type ViewBounds
} from '@shared/types/browser'
import type { AppSettings } from '@shared/types/settings'
import { readJson } from '../../lib/jsonFile'
import { writeAtomic } from '../../lib/writeAtomic'
import { AdblockService, type RequestVerdict } from './adblock'
import { drmFailure, needsDrm } from './drm'
import { ExtensionService, type FetchResponse } from './extensions/ExtensionService'
import { browserRoots, type BrowserRoot } from './extensions/profiles'
import { bareUrl, BrowserHistory } from './history'
import { DevServerDetector } from './devServers'
import { ENGINE_NAMES, labels } from './labels'
import type { AutomationTarget, BrowserHost, BrowserHostEvents, ConsoleEntry, LoginAsk, MenuEntry, PermissionAsk, ShortcutAction } from './types'
import { hostOf, isLoopback, isPageUrl, isWebUrl, originOf, resolveInput, searchUrl } from './url'

type BrowserEvent = 'browser:state' | 'browser:find' | 'browser:command' | 'browser:reveal'

export interface BrowserDeps {
  /** ~/Mindeck/data/browser — the session, the history, per-site choices. */
  dir: string
  settings: { get(): AppSettings; update(patch: Partial<AppSettings>): Promise<AppSettings> }
  publish: <K extends BrowserEvent>(channel: K, payload: IpcEvents[K]) => void
  /** The host's link handlers (the system browser, mailto:, other apps). */
  openExternal?: (url: string) => Promise<void>
  /** Name of the app that opens links like `url`. */
  appForUrl?: (url: string) => string
  openPath?: (path: string) => Promise<void>
  revealPath?: (path: string) => void
  /** State pushes are coalesced over this long (ms). */
  publishDelayMs?: number
  now?: () => number
  /** Network for filter lists and the Chrome Web Store (default: the global fetch). */
  fetch?: (url: string) => Promise<FetchResponse>
  /** Chrome's version, which the Web Store asks for (the desktop app's Chromium). */
  chromeVersion?: string
  /** Native folder picker (extension folders, the downloads folder). */
  pickFolder?: (title: string) => Promise<string | null>
  /** Where other browsers keep their profiles (default: this computer's). */
  browserRoots?: () => BrowserRoot[]
}

interface Tab {
  id: string
  url: string
  title: string
  favicon?: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  audible: boolean
  muted: boolean
  pinned: boolean
  zoom: number
  /** The user's sharing choice — it holds for the site it was made on. */
  share?: { on: boolean; origin: string }
  openedBy?: string
  agent?: AgentActivity
  error?: TabError
  crashed?: boolean
  /** Its view exists. Tabs restored from the last session load when first shown. */
  live: boolean
  profile?: BrowserProfile
  /** Requests blocked on the page. */
  blocked: number
  playing?: boolean
  drm?: boolean
  /** The site whose DRM bar the user closed. */
  drmOff?: string
  /** The address the malware list stopped. */
  danger?: string
}

type SavedTab = Pick<Tab, 'id' | 'url' | 'title'> & Partial<Pick<Tab, 'favicon' | 'pinned' | 'muted' | 'share' | 'openedBy' | 'profile'>>
type ClosedTab = Pick<Tab, 'url' | 'title' | 'pinned' | 'profile'> & { index: number }

interface SiteData {
  zoom?: number
  /** Decisions the user asked to remember, by permission (`external:<scheme>` for other apps). */
  permissions?: Record<string, boolean>
}

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
const MAX_CLOSED = 25
const MAX_DOWNLOADS = 30
const MAX_CONSOLE = 300
const MAX_FAVICON = 8 * 1024
const SAVE_DELAY_MS = 400
const LOAD_TIMEOUT_MS = 15_000
/** What the Web Store is told when the host did not say (a headless core installs nothing anyway). */
const CHROME_VERSION = '140.0.0.0'
const noop = () => {}

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** The next zoom step in `direction` (or 100 %). */
export function zoomStep(current: number, direction: 'in' | 'out' | 'reset'): number {
  if (direction === 'reset') return 1
  if (direction === 'in') return ZOOM_STEPS.find((z) => z > current + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? ZOOM_STEPS[0]
}

/**
 * The Mindeck browser's core (architecture §12.9): tabs and their order,
 * what was typed, history, downloads, a page's requests, the session across
 * restarts — and which tabs agents may use. It never touches Electron: the
 * desktop app attaches a BrowserHost that owns the real web views and reports
 * back through `hostEvents()`. Without a host (a headless core) the browser
 * reports itself unavailable.
 */
export class BrowserService {
  readonly history: BrowserHistory
  readonly devServers: DevServerDetector
  readonly adblock: AdblockService
  readonly extensions: ExtensionService
  private host: BrowserHost | null = null
  private tabs: Tab[] = []
  private activeId?: string
  private closed: ClosedTab[] = []
  private auth: BrowserAuthRequest[] = []
  private readonly authResponders = new Map<string, (credentials: { username: string; password: string } | null) => void>()
  private downloads: BrowserDownload[] = []
  private readonly downloadControls = new Map<string, { cancel(): void }>()
  private permissions: BrowserPermissionRequest[] = []
  private readonly responders = new Map<string, ((allow: boolean) => void)[]>()
  private sites: Record<string, SiteData> = {}
  private readonly consoles = new Map<string, ConsoleEntry[]>()
  private readonly waiters = new Map<string, (() => void)[]>()
  private bounds: ViewBounds | null = null
  private ui: { theme: 'dark' | 'light' | 'system'; locale: 'de' | 'en' } = { theme: 'system', locale: 'en' }
  private publishTimer?: NodeJS.Timeout
  private saveTimer?: NodeJS.Timeout
  private sitesTimer?: NodeJS.Timeout
  /** Unsaved changes (written on a timer, and at the latest on dispose). */
  private sessionDirty = false
  private sitesDirty = false

  constructor(private readonly deps: BrowserDeps) {
    this.history = new BrowserHistory(join(deps.dir, 'history.jsonl'), deps.now)
    this.devServers = new DevServerDetector(() => this.changed())
    const fetch = deps.fetch ?? ((url: string) => globalThis.fetch(url))
    const wanted = () => ({ ads: this.settings().adblock, malware: this.settings().malwareProtection })
    this.adblock = new AdblockService({ dir: deps.dir, fetch, wanted, now: deps.now })
    this.extensions = new ExtensionService({
      dir: deps.dir,
      fetch,
      chromeVersion: deps.chromeVersion ?? CHROME_VERSION,
      locale: () => this.ui.locale,
      pickFolder: deps.pickFolder,
      roots: deps.browserRoots ?? (() => browserRoots(process.platform, homedir(), process.env)),
      onChange: () => this.changed(),
      now: deps.now
    })
  }

  /** Loads the last session (tabs stay unloaded until shown), the history and per-site choices. */
  async init(): Promise<void> {
    await Promise.all([this.history.load(), this.adblock.init(), this.extensions.init()])
    const sites = await readJson<{ sites?: Record<string, SiteData> }>(this.file('sites.json'))
    this.sites = sites?.sites && typeof sites.sites === 'object' ? sites.sites : {}
    const saved = await readJson<{ tabs?: SavedTab[]; activeId?: string }>(this.file('session.json'))
    for (const t of Array.isArray(saved?.tabs) ? saved.tabs : []) {
      if (typeof t?.id !== 'string' || typeof t.url !== 'string') continue
      const share = t.share && typeof t.share.on === 'boolean' && typeof t.share.origin === 'string' ? { on: t.share.on, origin: t.share.origin } : undefined
      this.tabs.push(
        this.model({
          id: t.id,
          url: t.url,
          title: typeof t.title === 'string' ? t.title : '',
          favicon: typeof t.favicon === 'string' ? t.favicon : undefined,
          pinned: t.pinned === true,
          muted: t.muted === true,
          share,
          openedBy: typeof t.openedBy === 'string' ? t.openedBy : undefined,
          ...(t.profile === 'agents' ? { profile: 'agents' as const } : {}),
          zoom: this.siteZoom(t.url)
        })
      )
    }
    this.tabs = [...this.tabs.filter((t) => t.pinned), ...this.tabs.filter((t) => !t.pinned)]
    if (!this.tabs.length) this.tabs.push(this.model({ url: '' }))
    this.activeId = this.tabs.find((t) => t.id === saved?.activeId)?.id ?? this.tabs[0].id
  }

  // --- the desktop host ---------------------------------------------------------

  attach(host: BrowserHost): void {
    this.host = host
    host.setTheme(this.ui.theme)
    this.adblock.start()
    void this.extensions.attach(host)
    this.changed()
  }

  /** The window closed: its views are gone, and so are the requests of their pages. */
  detach(): void {
    this.host = null
    this.bounds = null
    for (const t of this.tabs) {
      t.live = false
      t.loading = false
      this.wake(t.id)
    }
    for (const fns of this.responders.values()) fns.forEach((fn) => fn(false))
    this.responders.clear()
    this.permissions = []
    for (const respond of this.authResponders.values()) respond(null)
    this.authResponders.clear()
    this.auth = []
    this.extensions.detach()
    this.changed()
  }

  hostEvents(): BrowserHostEvents {
    return {
      navigated: (id, nav) => this.onNavigated(id, nav),
      title: (id, title) => this.patch(id, (t) => {
        t.title = title
        if (t.profile !== 'private') this.history.title(t.url, title)
      }),
      favicon: (id, url) => this.patch(id, (t) => (t.favicon = url)),
      loading: (id, loading) => this.onLoading(id, loading),
      failed: (id, error) => this.onEnded(id, (t) => (t.error = t.danger === error.url ? { ...error, danger: 'malware' } : error)),
      crashed: (id) => this.onEnded(id, (t) => (t.crashed = true)),
      audible: (id, audible) => this.patch(id, (t) => (t.audible = audible), false),
      zoomed: (id, direction) => void (this.lookup(id) && this.zoom(id, direction)),
      openTab: (url, opts) => void this.open({ url, background: opts.background, opener: opts.opener, private: opts.private }),
      found: (result) => this.deps.publish('browser:find', result),
      console: (id, entry) => this.onConsole(id, entry),
      shortcut: (action) => this.onShortcut(action),
      // The UI moves its focus to the browser's pane.
      focused: () => this.deps.publish('browser:command', { command: 'focused' }),
      command: (id, command, arg) => this.lookup(id) && this.onCommand(id, command, arg),
      permission: (ask, respond) => this.onPermission(ask, respond),
      permissionCheck: (origin, kind) => this.sites[origin]?.permissions?.[kind] === true,
      download: (download, control) => {
        this.downloads = [download, ...this.downloads].slice(0, MAX_DOWNLOADS)
        this.downloadControls.set(download.id, control)
        this.changed()
      },
      downloadUpdated: (download) => {
        this.downloads = this.downloads.map((d) => (d.id === download.id ? download : d))
        if (download.state !== 'progressing') this.downloadControls.delete(download.id)
        this.changed()
      },
      locale: () => this.ui.locale,
      searchLabel: () => ENGINE_NAMES[this.settings().searchEngine],
      downloadPrefs: () => ({ ask: this.settings().askDownloadLocation, dir: this.settings().downloadDir }),
      request: (id, req) => this.onRequest(id, req),
      cosmetics: (id, url) => (this.lookup(id) ? this.adblock.cosmetics(url) : ''),
      media: (id, playing) => this.patch(id, (t) => (t.playing = playing), false),
      login: (id, ask, respond) => this.onLogin(id, ask, respond)
    }
  }

  // --- the UI's view of the browser -----------------------------------------------

  state(): BrowserState {
    return {
      available: !!this.host,
      tabs: this.tabs.map((t) => this.view(t)),
      activeId: this.activeId,
      closed: this.closed.length,
      downloads: this.downloads.map((d) => ({ ...d })),
      permissions: this.permissions.map((p) => ({ ...p })),
      devServers: this.devServers.list(),
      auth: this.auth.map((a) => ({ ...a })),
      extensions: this.extensions.list()
    }
  }

  /**
   * A new tab with what was typed (an address or search words); nothing = the new-tab page.
   * It stays in its opener's profile; `private` makes a private tab, and agents' tabs go to
   * their container unless the user lets agents use the logins.
   */
  open(req: { url?: string; background?: boolean; opener?: string; openedBy?: string; private?: boolean } = {}): BrowserTab {
    let url = ''
    if (req.url) {
      const target = this.target(req.url)
      if (target?.kind === 'external') {
        void this.external(target.url)
        return this.view(this.active())
      }
      url = target?.url ?? ''
    }
    const opener = req.opener ? this.lookup(req.opener) : undefined
    const profile = req.private ? 'private' : (opener?.profile ?? (req.openedBy && !this.settings().agentsUseLogins ? 'agents' : undefined))
    const tab = this.model({ url, openedBy: req.openedBy ?? opener?.openedBy, zoom: this.siteZoom(url), ...(profile ? { profile } : {}) })
    this.insert(tab, opener)
    if (url && this.host) this.goLive(tab)
    if (!req.background) this.activeId = tab.id
    this.touched()
    return this.view(tab)
  }

  close(id: string): void {
    const tab = this.require(id)
    const index = this.tabs.indexOf(tab)
    // Private tabs leave nothing behind — not even in the list of closed tabs.
    if (tab.url && tab.profile !== 'private')
      this.closed = [{ url: tab.url, title: tab.title, index, pinned: tab.pinned, profile: tab.profile }, ...this.closed].slice(0, MAX_CLOSED)
    if (tab.live) this.host?.destroy(id)
    this.tabs.splice(index, 1)
    this.forget(id)
    if (tab.profile === 'private' && !this.tabs.some((t) => t.profile === 'private')) this.host?.clearPrivate()
    if (this.activeId === id) this.activeId = (this.tabs[index] ?? this.tabs[index - 1])?.id
    if (!this.tabs.length) {
      const fresh = this.model({ url: '' })
      this.tabs.push(fresh)
      this.activeId = fresh.id
    }
    this.touched()
  }

  activate(id: string): void {
    const tab = this.require(id)
    this.activeId = id
    if (this.bounds) this.ensureLive(tab)
    this.touched()
  }

  /** What was typed into the address bar: an address, a search, or a link for another app. */
  navigate(id: string, input: string): void {
    const tab = this.require(id)
    const target = this.target(input)
    if (!target) return
    if (target.kind === 'external') return void this.external(target.url)
    // Typing an address takes the tab over: no longer the agent's, no earlier sharing choice.
    tab.openedBy = undefined
    tab.agent = undefined
    tab.share = undefined
    this.load(tab, target.url)
  }

  go(id: string, action: BrowserGo): void {
    const tab = this.require(id)
    if (!tab.url) return
    if (!tab.live) {
      if (action === 'reload' || action === 'hardReload') this.ensureLive(tab, true)
      return
    }
    if ((action === 'reload' || action === 'hardReload') && tab.error) {
      // A page that failed: load its address again — the error page stays until the new page is there.
      this.host?.load(id, tab.error.url)
      tab.loading = true
      return this.changed()
    }
    // Loading starts with the request, so a waiting agent waits for the right page
    // (back/forward only when there is somewhere to go).
    const goes = action === 'back' ? tab.canGoBack : action === 'forward' ? tab.canGoForward : true
    if (action === 'stop') tab.loading = false
    else if (goes) tab.loading = true
    this.host?.go(id, action)
    this.changed()
    this.syncView()
  }

  update(id: string, patch: { pinned?: boolean; muted?: boolean; shared?: boolean }): void {
    const tab = this.require(id)
    if (patch.pinned !== undefined && patch.pinned !== tab.pinned) {
      this.tabs.splice(this.tabs.indexOf(tab), 1)
      tab.pinned = patch.pinned
      this.tabs.splice(this.pinnedCount(), 0, tab)
    }
    if (patch.muted !== undefined) {
      tab.muted = patch.muted
      if (tab.live) this.host?.setMuted(id, patch.muted)
    }
    // A private tab is never shared with agents.
    if (patch.shared !== undefined && tab.profile !== 'private') tab.share = { on: patch.shared, origin: originOf(tab.url) }
    this.touched()
  }

  /** Reorder — within the pinned tabs, or within the others. */
  move(id: string, index: number): void {
    const tab = this.require(id)
    this.tabs.splice(this.tabs.indexOf(tab), 1)
    const pinned = this.pinnedCount()
    const [min, max] = tab.pinned ? [0, pinned] : [pinned, this.tabs.length]
    this.tabs.splice(Math.max(min, Math.min(max, index)), 0, tab)
    this.touched()
  }

  duplicate(id: string): BrowserTab {
    const tab = this.require(id)
    return this.open({ url: tab.url, opener: id })
  }

  reopen(): BrowserTab | null {
    const last = this.closed.shift()
    if (!last) return null
    const tab = this.model({
      url: last.url,
      title: last.title,
      pinned: last.pinned,
      zoom: this.siteZoom(last.url),
      ...(last.profile ? { profile: last.profile } : {})
    })
    const pinned = this.pinnedCount()
    const [min, max] = last.pinned ? [0, pinned] : [pinned, this.tabs.length]
    this.tabs.splice(Math.max(min, Math.min(max, last.index)), 0, tab)
    if (this.host) this.goLive(tab)
    this.activeId = tab.id
    this.touched()
    return this.view(tab)
  }

  /** Zoom like Chrome: in steps, remembered for the site. */
  zoom(id: string, direction: 'in' | 'out' | 'reset'): number {
    const tab = this.require(id)
    tab.zoom = zoomStep(tab.zoom, direction)
    if (tab.live) this.host?.setZoom(id, tab.zoom)
    const origin = originOf(tab.url)
    if (origin && tab.profile !== 'private') {
      const site = (this.sites[origin] ??= {})
      if (tab.zoom === 1) delete site.zoom
      else site.zoom = tab.zoom
      this.saveSites()
    }
    this.changed()
    return tab.zoom
  }

  find(id: string, text: string, forward = true, next = false): void {
    this.require(id)
    if (!text) return this.findStop(id)
    this.host?.find(id, text, { forward, next })
  }

  findStop(id: string): void {
    this.require(id)
    this.host?.stopFind(id)
  }

  tool(id: string, tool: BrowserTool): void {
    const tab = this.require(id)
    if (tool === 'tabMenu') return this.host?.popup(this.tabMenu(tab))
    if (tool === 'pageMenu') return this.host?.popup(this.pageMenu(tab))
    if (tool === 'shield') return this.host?.popup(this.shieldMenu(tab))
    if (tool === 'handoff') {
      if (isWebUrl(tab.url)) void this.deps.openExternal?.(tab.url)
      return
    }
    if (!tab.live) return
    if (tool === 'devtools') this.host?.devtools(id)
    else this.host?.print(id)
  }

  /**
   * Where the web view goes; null takes it off screen (the module is hidden).
   * `focused`: the browser's pane has the focus — only then do its keys win
   * over the UI's (next to an editor, ⌘S and ⌘W stay the editor's).
   */
  setView(bounds: ViewBounds | null, focused = true): void {
    this.bounds = bounds
    this.host?.setBounds(bounds, focused)
    const active = this.active()
    if (bounds) this.ensureLive(active)
    this.syncView()
  }

  freeze(): Promise<string | null> {
    return this.host ? this.host.freeze() : Promise.resolve(null)
  }

  unfreeze(): void {
    this.host?.unfreeze()
  }

  /** Address-bar suggestions: go there or search first, then open tabs and history. */
  suggest(text: string): BrowserSuggestion[] {
    const q = text.trim()
    if (!q) return []
    const engine = this.settings().searchEngine
    const search: BrowserSuggestion = { kind: 'search', url: searchUrl(engine, q), title: q }
    const target = this.target(q)
    const navigate = target?.kind === 'page' && target.url !== search.url
    const out: BrowserSuggestion[] = [navigate ? { kind: 'navigate', url: target.url, title: target.url } : search]
    const lower = q.toLowerCase()
    out.push(
      ...this.tabs
        .filter((t) => t.url && t.id !== this.activeId && `${bareUrl(t.url)} ${t.title}`.toLowerCase().includes(lower))
        .slice(0, 3)
        .map((t): BrowserSuggestion => ({ kind: 'tab', url: t.url, title: t.title || t.url, tabId: t.id }))
    )
    out.push(...this.history.suggest(q, 6).map((h): BrowserSuggestion => ({ kind: 'history', url: h.url, title: h.title || h.url })))
    if (navigate) out.push(search)
    const seen = new Set<string>()
    return out.filter((s) => (s.kind === 'tab' || !seen.has(s.url)) && !!seen.add(s.url)).slice(0, 8)
  }

  /** Visited pages matching `query`; without one, the most visited sites. */
  historyEntries(query?: string, limit?: number): HistoryEntry[] {
    return query?.trim() ? this.history.search(query, limit) : this.history.top(limit)
  }

  clearHistory(): Promise<void> {
    return this.history.clear()
  }

  download(id: string, action: 'open' | 'reveal' | 'cancel' | 'remove'): void {
    const d = this.downloads.find((x) => x.id === id)
    if (!d) throw coded('not-found', 'Download not found')
    if (action === 'open') void this.deps.openPath?.(d.path)
    else if (action === 'reveal') this.deps.revealPath?.(d.path)
    else {
      this.downloadControls.get(id)?.cancel()
      if (action === 'remove') {
        this.downloads = this.downloads.filter((x) => x.id !== id)
        this.downloadControls.delete(id)
      }
      this.changed()
    }
  }

  /** The user's answer to a page's request. */
  permission(id: string, allow: boolean, remember = false): void {
    const req = this.permissions.find((p) => p.id === id)
    if (!req) throw coded('not-pending', 'This request is no longer pending')
    this.permissions = this.permissions.filter((p) => p.id !== id)
    this.responders.get(id)!.forEach((fn) => fn(allow))
    this.responders.delete(id)
    // A private tab's choices are not kept.
    if (remember && this.lookup(req.tabId ?? '')?.profile !== 'private') {
      const site = (this.sites[req.origin] ??= {})
      site.permissions = { ...site.permissions, [permissionKey(req)]: allow }
      this.saveSites()
    }
    this.changed()
  }

  /** The user's answer to a page's login: a user name and password, or none (cancel). */
  answerAuth(id: string, username?: string, password?: string): void {
    const req = this.auth.find((a) => a.id === id)
    if (!req) throw coded('not-pending', 'This login is no longer pending')
    this.auth = this.auth.filter((a) => a !== req)
    const respond = this.authResponders.get(id)!
    this.authResponders.delete(id)
    respond(username === undefined ? null : { username, password: password ?? '' })
    this.changed()
  }

  /** Open a page the malware list stopped anyway — its site stays allowed until Mindeck quits. */
  proceed(id: string): void {
    const tab = this.require(id)
    if (!tab.error?.danger) throw coded('not-blocked', 'This tab shows no blocked page')
    this.adblock.trust(tab.error.url)
    this.load(tab, tab.error.url)
  }

  /** The user closed the DRM bar: not again on this site, in this tab. */
  dismissDrm(id: string): void {
    const tab = this.require(id)
    tab.drm = false
    tab.drmOff = originOf(tab.url)
    this.changed()
  }

  /** Ad and tracker blocking on the tab's site, on or off — the page reloads to show the difference. */
  async setShield(id: string, on: boolean): Promise<void> {
    const tab = this.require(id)
    await this.adblock.setSite(tab.url, on)
    this.go(id, 'reload')
  }

  /** The downloads folder, chosen with the native picker (null: cancelled). */
  async pickDownloadDir(): Promise<BrowserSettings | null> {
    if (!this.deps.pickFolder) throw coded('desktop-only', 'The folder picker is only available in the Mindeck desktop app')
    const dir = await this.deps.pickFolder('Choose a downloads folder')
    return dir ? this.configure({ downloadDir: dir }) : null
  }

  settings(): BrowserSettings {
    return { ...DEFAULT_BROWSER_SETTINGS, ...this.deps.settings.get().browser }
  }

  async configure(patch: Partial<BrowserSettings>): Promise<BrowserSettings> {
    await this.deps.settings.update({ browser: { ...this.settings(), ...patch } })
    return this.settings()
  }

  /** The UI's look and language. */
  setUi(ui: { theme: 'dark' | 'light' | 'system'; locale: 'de' | 'en' }): void {
    this.ui = ui
    this.host?.setTheme(ui.theme)
  }

  /**
   * A link clicked somewhere in Mindeck (a chat, a note, the Live Server):
   * opens in a tab and brings the browser up. False when it can't (no
   * window, the user prefers the system browser, not a web address).
   */
  openFromApp(url: string): boolean {
    if (!this.host || !this.settings().openLinksInMindeck || !isWebUrl(url)) return false
    const tab = this.open({ url })
    this.deps.publish('browser:reveal', { tabId: tab.id })
    return true
  }

  // --- agents ---------------------------------------------------------------------

  /** The tabs agents may see: local dev pages, tabs agents opened, tabs the user shared. */
  agentTabs(): BrowserTab[] {
    return this.tabs.filter((t) => t.url && this.isShared(t)).map((t) => this.view(t))
  }

  /** The tab an agent means: the given one, else the active tab, else the one an agent used last. */
  agentTab(id?: string): BrowserTab {
    this.requireHost()
    const shared = this.tabs.filter((t) => t.url && this.isShared(t))
    if (id) {
      const tab = shared.find((t) => t.id === id)
      if (!tab) throw coded('not-shared', `Tab ${id} is not open or not shared with agents. List the shared tabs with browser_tabs.`)
      return this.view(tab)
    }
    const lastUsed = [...shared].filter((t) => t.agent).sort((a, b) => b.agent!.at.localeCompare(a.agent!.at))[0]
    const tab = shared.find((t) => t.id === this.activeId) ?? lastUsed ?? shared[0]
    if (!tab) {
      throw coded('no-tab', 'No tab is shared with agents. Open one with browser_open, or ask the user to share a tab (the eye icon in the Mindeck browser).')
    }
    return this.view(tab)
  }

  /** An agent opens a page — in a tab of its own, in the background, then waits for it to load. */
  async agentOpen(url: string, agent: string): Promise<BrowserTab> {
    this.requireHost()
    if (!isWebUrl(url)) throw coded('bad-url', 'Agents can open http and https addresses only')
    const tab = this.open({ url, background: true, openedBy: agent })
    this.noteAgent(tab.id, agent, 'open', url)
    await this.waitForLoad(tab.id)
    return this.view(this.require(tab.id))
  }

  async agentNavigate(id: string, to: { url?: string; action?: 'back' | 'forward' | 'reload' }, agent: string): Promise<BrowserTab> {
    const tab = this.require(this.agentTab(id).id)
    if (to.url) {
      if (!isWebUrl(to.url)) throw coded('bad-url', 'Agents can open http and https addresses only')
      this.load(tab, to.url)
    } else {
      this.go(id, to.action ?? 'reload')
    }
    this.noteAgent(id, agent, 'navigate', to.url ?? to.action ?? 'reload')
    await this.waitForLoad(id)
    return this.view(tab)
  }

  /** CDP and pictures of a shared tab, its view created first when it was not loaded yet. */
  async automation(id: string): Promise<AutomationTarget> {
    const host = this.requireHost()
    const tab = this.require(this.agentTab(id).id)
    if (!tab.live) {
      this.ensureLive(tab, true)
      await this.waitForLoad(id)
    }
    return host.automation(id)
  }

  /** Show in the tab what an agent just did. */
  noteAgent(id: string, name: string, action: AgentAction, detail?: string): void {
    this.patch(id, (t) => (t.agent = { name, action, ...(detail ? { detail } : {}), at: new Date(this.now()).toISOString() }), false)
  }

  /** The page's console since it was opened (newest last). */
  consoleOf(id: string): ConsoleEntry[] {
    return [...(this.consoles.get(id) ?? [])]
  }

  /** Resolves once the tab stopped loading (or after the timeout). */
  waitForLoad(id: string, timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
    if (!this.lookup(id)?.loading) return Promise.resolve()
    return new Promise((resolve) => {
      const list = this.waiters.get(id) ?? []
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        // Still waiting (a wake would have cleared this timer): leave the others waiting.
        const rest = this.waiters.get(id)!.filter((fn) => fn !== done)
        if (rest.length) this.waiters.set(id, rest)
        else this.waiters.delete(id)
        resolve()
      }, timeoutMs)
      list.push(done)
      this.waiters.set(id, list)
    })
  }

  async dispose(): Promise<void> {
    clearTimeout(this.publishTimer)
    this.adblock.dispose()
    this.extensions.dispose()
    await Promise.all([this.sessionDirty && this.saveSession(), this.sitesDirty && this.writeSites(), this.history.flush()])
  }

  // --- internals ------------------------------------------------------------------

  private file(name: string): string {
    return join(this.deps.dir, name)
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private model(init: Partial<Tab> & { url: string }): Tab {
    return {
      id: randomUUID(),
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      audible: false,
      muted: false,
      pinned: false,
      zoom: 1,
      live: false,
      blocked: 0,
      ...init
    }
  }

  private view(t: Tab): BrowserTab {
    const { live: _live, share: _share, blocked, drm, drmOff: _drmOff, danger: _danger, ...rest } = t
    const shield = isWebUrl(t.url) ? { shield: { on: this.settings().adblock && this.adblock.siteOn(t.url), blocked } } : {}
    return { ...rest, shared: this.isShared(t), ...(drm ? { drm } : {}), ...shield }
  }

  private isShared(t: Tab): boolean {
    if (t.profile === 'private') return false
    if (t.share && t.share.origin === originOf(t.url)) return t.share.on
    return !!t.openedBy || isLoopback(t.url)
  }

  private lookup(id: string): Tab | undefined {
    return this.tabs.find((t) => t.id === id)
  }

  private require(id: string): Tab {
    const tab = this.lookup(id)
    if (!tab) throw coded('not-found', 'Tab not found')
    return tab
  }

  private requireHost(): BrowserHost {
    if (!this.host) throw coded('desktop-only', 'The browser is only available in the Mindeck desktop app')
    return this.host
  }

  private active(): Tab {
    return this.tabs.find((t) => t.id === this.activeId) ?? this.tabs[0]
  }

  private pinnedCount(): number {
    return this.tabs.filter((t) => t.pinned).length
  }

  private siteZoom(url: string): number {
    return this.sites[originOf(url)]?.zoom ?? 1
  }

  /** What typed text leads to: a page for a tab, a link for another app, or nothing. */
  private target(input: string): { kind: 'page' | 'external'; url: string } | null {
    const url = resolveInput(input, this.settings().searchEngine)
    if (!url || /^(javascript|vbscript):/i.test(url)) return null
    return { kind: isPageUrl(url) ? 'page' : 'external', url }
  }

  private async external(url: string): Promise<void> {
    await this.deps.openExternal?.(url).catch(() => {})
  }

  /** After the opener (and the tabs it opened before), else at the end — pinned tabs stay first. */
  private insert(tab: Tab, after?: Tab): void {
    const index = after ? Math.max(this.tabs.indexOf(after) + 1, this.pinnedCount()) : this.tabs.length
    this.tabs.splice(index, 0, tab)
  }

  private goLive(tab: Tab): void {
    this.host!.create(tab.id, tab.url, { agent: !!tab.openedBy, zoom: tab.zoom, muted: tab.muted, ...(tab.profile ? { profile: tab.profile } : {}) })
    tab.live = true
    tab.loading = true
  }

  /** Load the tab's page if it has none yet (on screen, or `force`d for an agent / a reload). */
  private ensureLive(tab: Tab, force = false): void {
    if (tab.url && !tab.live && this.host && (force || this.bounds)) {
      this.goLive(tab)
      this.touched()
    }
  }

  private load(tab: Tab, url: string): void {
    tab.url = url
    tab.error = undefined
    tab.crashed = false
    if (this.host) {
      if (tab.live) this.host.load(tab.id, url)
      else this.goLive(tab)
      tab.loading = true
    }
    this.touched()
  }

  /** The visible web view: the active tab's, unless the new-tab page or an error page shows instead. */
  private syncView(): void {
    const t = this.active()
    this.host?.show(t.live && t.url && !t.error && !t.crashed ? t.id : undefined)
  }

  /** Something the UI shows changed — and the session with it. */
  private touched(): void {
    this.changed()
    this.syncView()
    this.save()
  }

  private changed(): void {
    if (this.publishTimer) return
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined
      this.deps.publish('browser:state', this.state())
    }, this.deps.publishDelayMs ?? 33)
  }

  private patch(id: string, fn: (t: Tab) => void, persist = true): void {
    const tab = this.lookup(id)
    if (!tab) return
    fn(tab)
    this.changed()
    if (persist) this.save()
  }

  private wake(id: string): void {
    this.waiters.get(id)?.forEach((fn) => fn())
    this.waiters.delete(id)
  }

  /** A closed tab: its console, its waiters and its page's open requests go. */
  private forget(id: string): void {
    this.consoles.delete(id)
    this.wake(id)
    this.denyRequests(id)
  }

  private denyRequests(tabId: string): void {
    for (const p of this.permissions.filter((x) => x.tabId === tabId)) {
      this.responders.get(p.id)!.forEach((fn) => fn(false))
      this.responders.delete(p.id)
    }
    this.permissions = this.permissions.filter((x) => x.tabId !== tabId)
    for (const a of this.auth.filter((x) => x.tabId === tabId)) {
      this.authResponders.get(a.id)!(null)
      this.authResponders.delete(a.id)
    }
    this.auth = this.auth.filter((x) => x.tabId !== tabId)
  }

  private onNavigated(id: string, nav: { url: string; canGoBack: boolean; canGoForward: boolean; inPage?: boolean }): void {
    const tab = this.lookup(id)
    if (!tab) return
    const newOrigin = originOf(nav.url) !== originOf(tab.url)
    tab.url = nav.url
    tab.canGoBack = nav.canGoBack
    tab.canGoForward = nav.canGoForward
    tab.error = undefined
    tab.crashed = false
    if (!nav.inPage) {
      tab.title = ''
      if (newOrigin) tab.favicon = undefined
      this.denyRequests(id)
      const zoom = this.siteZoom(nav.url)
      if (zoom !== tab.zoom) {
        tab.zoom = zoom
        this.host?.setZoom(id, zoom)
      }
      tab.drm = needsDrm(nav.url) && tab.drmOff !== originOf(nav.url)
    }
    if (tab.profile !== 'private') this.history.visit(nav.url, nav.inPage ? tab.title : '')
    this.touched()
  }

  private onLoading(id: string, loading: boolean): void {
    const tab = this.lookup(id)
    if (!tab) return
    tab.loading = loading
    // An error or crash page stays until a new page commits (navigated) — no blank flash on retry.
    if (!loading) this.wake(id)
    this.changed()
  }

  /** The page failed or crashed: no longer loading, and the UI shows why instead of the view. */
  private onEnded(id: string, mark: (t: Tab) => void): void {
    const tab = this.lookup(id)
    if (!tab) return
    mark(tab)
    tab.loading = false
    this.wake(id)
    this.changed()
    this.syncView()
  }

  private onConsole(id: string, entry: ConsoleEntry): void {
    const tab = this.lookup(id)
    if (tab && !tab.drm && drmFailure(entry.level, entry.message) && tab.drmOff !== originOf(tab.url)) {
      tab.drm = true
      this.changed()
    }
    const list = this.consoles.get(id) ?? []
    list.push(entry)
    if (list.length > MAX_CONSOLE) list.splice(0, list.length - MAX_CONSOLE)
    this.consoles.set(id, list)
  }

  private command(command: BrowserCommand): void {
    if (command === 'focusOmnibox' || command === 'find') this.host?.focusUi()
    this.deps.publish('browser:command', { command })
  }

  private onShortcut(action: ShortcutAction): void {
    const tab = this.active()
    const index = this.tabs.indexOf(tab)
    const pick = (i: number): void => {
      const target = this.tabs[i]
      if (target) this.activate(target.id)
    }
    switch (action) {
      case 'newTab':
      case 'newPrivateTab':
        this.open({ private: action === 'newPrivateTab' })
        return this.command('focusOmnibox')
      case 'closeTab':
        return this.close(tab.id)
      case 'reopenTab':
        return void this.reopen()
      case 'focusOmnibox':
      case 'find':
        return this.command(action)
      case 'reload':
      case 'hardReload':
      case 'back':
      case 'forward':
        return this.go(tab.id, action)
      case 'zoomIn':
      case 'zoomOut':
      case 'zoomReset':
        return void this.zoom(tab.id, action === 'zoomIn' ? 'in' : action === 'zoomOut' ? 'out' : 'reset')
      case 'nextTab':
        return pick((index + 1) % this.tabs.length)
      case 'prevTab':
        return pick((index - 1 + this.tabs.length) % this.tabs.length)
      case 'lastTab':
        return pick(this.tabs.length - 1)
      case 'devtools':
      case 'print':
        return this.tool(tab.id, action)
      default:
        return pick(Number(action.slice(3)) - 1)
    }
  }

  private onCommand(id: string, command: 'sendToAgent' | 'search', arg?: string): void {
    if (command === 'search') {
      if (arg) this.open({ url: searchUrl(this.settings().searchEngine, arg), opener: id })
      return
    }
    this.update(id, { shared: true })
    this.deps.publish('browser:command', { command: 'sendToAgent' })
  }

  private onPermission(ask: PermissionAsk, respond: (allow: boolean) => void): void {
    const stored = this.sites[ask.origin]?.permissions?.[permissionKey(ask)]
    if (stored !== undefined) return respond(stored)
    const same = this.permissions.find((p) => p.tabId === ask.tabId && p.origin === ask.origin && p.kind === ask.kind && p.target === ask.target)
    if (same) {
      this.responders.get(same.id)!.push(respond)
      return
    }
    const req: BrowserPermissionRequest = { id: randomUUID(), ...ask }
    this.permissions.push(req)
    this.responders.set(req.id, [respond])
    this.changed()
  }

  /** A request of a page: the blocker decides; the tab counts what it blocked (from its page's main request on). */
  private onRequest(id: string | undefined, req: { url: string; type: string; referrer: string }): RequestVerdict {
    const tab = this.lookup(id ?? '')
    const main = req.type === 'mainFrame'
    if (tab && main) {
      tab.blocked = 0
      tab.danger = undefined
      this.changed()
    }
    const verdict = this.adblock.check({ url: req.url, type: req.type, sourceUrl: req.referrer, page: main ? req.url : tab?.url || req.referrer })
    if (tab && verdict.danger) tab.danger = req.url
    else if (tab && (verdict.cancel || verdict.redirectURL)) {
      tab.blocked += 1
      this.changed()
    }
    return verdict
  }

  private onLogin(tabId: string | undefined, ask: LoginAsk, respond: (credentials: { username: string; password: string } | null) => void): void {
    const tab = this.lookup(tabId ?? '')
    const req: BrowserAuthRequest = { id: randomUUID(), ...(tab ? { tabId: tab.id } : {}), host: ask.host, realm: ask.realm, isProxy: ask.isProxy }
    this.auth.push(req)
    this.authResponders.set(req.id, respond)
    this.changed()
  }

  /** The shield in the address bar: what was blocked here, and blocking on this site on or off. */
  private shieldMenu(tab: Tab): MenuEntry[] {
    const l = labels(this.ui.locale)
    const on = this.adblock.siteOn(tab.url)
    return [
      { label: l.blocked(tab.blocked), enabled: false, run: noop },
      { separator: true },
      this.settings().adblock
        ? { label: l.blockOn(hostOf(tab.url)), checked: on, enabled: isWebUrl(tab.url) && !isLoopback(tab.url), run: () => void this.setShield(tab.id, !on) }
        : { label: l.blockingOff, enabled: false, run: noop },
      { label: l.settings, run: () => this.command('settings') }
    ]
  }

  private tabMenu(tab: Tab): MenuEntry[] {
    const l = labels(this.ui.locale)
    const shared = this.isShared(tab)
    return [
      { label: l.reload, enabled: !!tab.url, run: () => this.go(tab.id, 'reload') },
      { label: l.duplicate, run: () => void this.duplicate(tab.id) },
      { label: tab.pinned ? l.unpin : l.pin, run: () => this.update(tab.id, { pinned: !tab.pinned }) },
      { label: tab.muted ? l.unmute : l.mute, run: () => this.update(tab.id, { muted: !tab.muted }) },
      { label: shared ? l.unshare : l.share, enabled: !!tab.url, run: () => this.update(tab.id, { shared: !shared }) },
      { label: l.handoff(this.deps.appForUrl?.('https://') ?? ''), enabled: isWebUrl(tab.url), run: () => this.tool(tab.id, 'handoff') },
      { separator: true },
      { label: l.close, run: () => this.close(tab.id) },
      {
        label: l.closeOthers,
        enabled: this.tabs.some((t) => t !== tab && !t.pinned),
        run: () => this.tabs.filter((t) => t !== tab && !t.pinned).forEach((t) => this.close(t.id))
      }
    ]
  }

  private pageMenu(tab: Tab): MenuEntry[] {
    const l = labels(this.ui.locale)
    const page = tab.live && !!tab.url
    return [
      { label: l.newTab, run: () => this.onShortcut('newTab') },
      { label: l.newPrivateTab, run: () => this.onShortcut('newPrivateTab') },
      { label: l.reopen, enabled: this.closed.length > 0, run: () => void this.reopen() },
      { separator: true },
      { label: l.find, enabled: page, run: () => this.command('find') },
      { label: l.zoomIn, run: () => void this.zoom(tab.id, 'in') },
      { label: l.zoomOut, run: () => void this.zoom(tab.id, 'out') },
      { label: l.zoomReset(Math.round(tab.zoom * 100)), enabled: tab.zoom !== 1, run: () => void this.zoom(tab.id, 'reset') },
      { separator: true },
      { label: l.print, enabled: page, run: () => this.tool(tab.id, 'print') },
      { label: l.devtools, enabled: page, run: () => this.tool(tab.id, 'devtools') },
      { label: l.handoff(this.deps.appForUrl?.('https://') ?? ''), enabled: isWebUrl(tab.url), run: () => this.tool(tab.id, 'handoff') },
      { separator: true },
      { label: l.sendToAgent, enabled: !!tab.url, run: () => this.onCommand(tab.id, 'sendToAgent') },
      { label: l.settings, run: () => this.command('settings') }
    ]
  }

  private save(): void {
    this.sessionDirty = true
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.saveSession(), SAVE_DELAY_MS)
  }

  private async saveSession(): Promise<void> {
    clearTimeout(this.saveTimer)
    this.sessionDirty = false
    // Private tabs are never written down.
    const kept = this.tabs.filter((t) => t.profile !== 'private')
    const tabs: SavedTab[] = kept.map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      ...(t.favicon && t.favicon.length <= MAX_FAVICON ? { favicon: t.favicon } : {}),
      ...(t.pinned ? { pinned: true } : {}),
      ...(t.muted ? { muted: true } : {}),
      ...(t.share ? { share: t.share } : {}),
      ...(t.openedBy ? { openedBy: t.openedBy } : {}),
      ...(t.profile ? { profile: t.profile } : {})
    }))
    await writeAtomic(this.file('session.json'), JSON.stringify({ version: 1, activeId: this.activeId, tabs }), 0o600).catch((err) =>
      console.error('[browser] saving the session failed', err)
    )
  }

  private saveSites(): void {
    this.sitesDirty = true
    clearTimeout(this.sitesTimer)
    this.sitesTimer = setTimeout(() => void this.writeSites(), SAVE_DELAY_MS)
  }

  private async writeSites(): Promise<void> {
    clearTimeout(this.sitesTimer)
    this.sitesDirty = false
    await writeAtomic(this.file('sites.json'), JSON.stringify({ version: 1, sites: this.sites }, null, 2)).catch((err) =>
      console.error('[browser] saving site settings failed', err)
    )
  }
}

/** Remembered per permission — and per app for links to other apps (mailto:, zoommtg:, …). */
function permissionKey(p: { kind: string; target?: string }): string {
  if (p.kind !== 'external') return p.kind
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(p.target ?? '')?.[1].toLowerCase() ?? ''
  return `external:${scheme}`
}
