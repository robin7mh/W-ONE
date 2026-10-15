// The Mindeck browser (architecture §12.9): real Chromium tabs inside the
// desktop window, which the user's agents can read and — with approval — use.
// Pure module (no DOM/Node/Electron) so it compiles under both tsconfigs.

/** Search engines for what the address bar does not take as an address. */
export const SEARCH_ENGINES = ['google', 'duckduckgo', 'bing', 'ecosia', 'brave', 'kagi'] as const
export type SearchEngine = (typeof SEARCH_ENGINES)[number]

export interface BrowserSettings {
  searchEngine: SearchEngine
  /** Links clicked inside Mindeck (agent chats, notes) open in the Mindeck browser, not the system's. */
  openLinksInMindeck: boolean
  /** The address bar asks the search engine for suggestions (what is typed goes to it). */
  searchSuggestions: boolean
  /** The bookmarks bar under the toolbar (⌘⇧B). */
  bookmarksBar: boolean
}

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = { searchEngine: 'google', openLinksInMindeck: true, searchSuggestions: true, bookmarksBar: true }

/** What an agent did in a tab — the UI says it in its language. */
export type AgentAction = 'open' | 'navigate' | 'read' | 'snapshot' | 'screenshot' | 'console' | 'click' | 'type' | 'press'

export interface AgentActivity {
  name: string
  action: AgentAction
  /** What it acted on (a button's name, an address). */
  detail?: string
  at: string
}

/** A main-frame load that failed (Chromium's net error code and text). */
export interface TabError {
  code: number
  description: string
  url: string
}

export interface BrowserTab {
  id: string
  /** '' = the new-tab page (drawn by Mindeck, no web page behind it). */
  url: string
  title: string
  /** The page's favicon (http, https or data URL). */
  favicon?: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** Playing sound right now. */
  audible: boolean
  muted: boolean
  pinned: boolean
  /** Page zoom, 1 = 100 %. */
  zoom: number
  /** Agents may see this tab: local dev pages, tabs an agent opened, tabs the user shared. */
  shared: boolean
  /** The agent that opened this tab. */
  openedBy?: string
  /** The latest thing an agent did here. */
  agent?: AgentActivity
  error?: TabError
  /** The page's renderer process died. */
  crashed?: boolean
}

export interface BrowserDownload {
  id: string
  filename: string
  /** Where the file is saved. */
  path: string
  url: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  received: number
  /** 0 when the server did not say. */
  total: number
  startedAt: string
}

export type BrowserPermissionKind =
  | 'camera'
  | 'microphone'
  | 'media'
  | 'notifications'
  | 'geolocation'
  | 'clipboard'
  | 'screen'
  | 'external'

/** A page asks for something only the user can allow. */
export interface BrowserPermissionRequest {
  id: string
  tabId?: string
  origin: string
  kind: BrowserPermissionKind
  /** 'external': the link another app would open, and that app's name. */
  target?: string
  app?: string
}

/** A local dev server Mindeck saw starting in a terminal. */
export interface DevServer {
  url: string
  /** host:port, for display. */
  label: string
  terminalId: string
  projectId?: string
  detectedAt: string
}

export interface BrowserState {
  /** The desktop window hosts the browser (false on a headless core). */
  available: boolean
  tabs: BrowserTab[]
  activeId?: string
  /** How many closed tabs ⌘⇧T can bring back. */
  closed: number
  downloads: BrowserDownload[]
  permissions: BrowserPermissionRequest[]
  devServers: DevServer[]
  /** Mindeck quit unexpectedly: this many tabs of that session wait to be restored (or dismissed). */
  restorable?: number
}

export interface BrowserSuggestion {
  /**
   * navigate: an address · search: the search engine · history: a visited page · tab: switch to an open tab ·
   * bookmark: a saved page · suggestion: what the search engine suggests for the words typed.
   */
  kind: 'navigate' | 'search' | 'history' | 'tab' | 'bookmark' | 'suggestion'
  url: string
  title: string
  tabId?: string
}

export interface HistoryEntry {
  url: string
  title: string
  visits: number
  lastVisit: string
}

/** In-page search progress (`active` of `matches`). */
export interface BrowserFind {
  tabId: string
  active: number
  matches: number
}

/** Where the web view sits in the window (CSS pixels of the Mindeck UI). */
export interface ViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserGo = 'back' | 'forward' | 'reload' | 'hardReload' | 'stop'

/** Native menus and tools of a tab. */
export type BrowserTool = 'tabMenu' | 'pageMenu' | 'devtools' | 'print' | 'handoff'

/** What a shortcut or menu asks the Mindeck UI to do (the page may have the keyboard focus). */
export type BrowserCommand =
  | 'focusOmnibox'
  | 'find'
  | 'sendToAgent'
  | 'settings'
  | 'focused'
  | 'tabSearch'
  | 'bookmark'
  | 'bookmarksBar'
  | 'import'
