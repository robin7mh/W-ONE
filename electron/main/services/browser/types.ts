import type {
  BrowserDownload,
  BrowserFind,
  BrowserGo,
  BrowserPermissionKind,
  TabError,
  ViewBounds
} from '@shared/types/browser'

/** Keys the browser takes over while it is on screen — even when a page has the focus. */
export type ShortcutAction =
  | 'newTab'
  | 'closeTab'
  | 'reopenTab'
  | 'focusOmnibox'
  | 'reload'
  | 'hardReload'
  | 'back'
  | 'forward'
  | 'find'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'nextTab'
  | 'prevTab'
  | 'lastTab'
  | 'tab1'
  | 'tab2'
  | 'tab3'
  | 'tab4'
  | 'tab5'
  | 'tab6'
  | 'tab7'
  | 'tab8'
  | 'devtools'
  | 'print'

export interface ConsoleEntry {
  level: 'debug' | 'info' | 'warning' | 'error'
  message: string
  source?: string
  line?: number
  at: string
}

/** One entry of a native menu. */
export type MenuEntry = { label: string; enabled?: boolean; checked?: boolean; run: () => void } | { separator: true }

/** A page's request the user decides on (camera, notifications, another app, …). */
export interface PermissionAsk {
  tabId?: string
  origin: string
  kind: BrowserPermissionKind
  target?: string
  app?: string
}

/** Chrome DevTools Protocol on one tab, and its picture — what agents act through. */
export interface AutomationTarget {
  cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  /** The visible page as PNG (base64). */
  capture(): Promise<{ png: string; width: number; height: number }>
}

/**
 * The web views behind the tabs. Implemented by the desktop app (Electron's
 * WebContentsView, `platform/browser`); the core decides, the host shows.
 */
export interface BrowserHost {
  /** Create the tab's view and load `url`. `agent`: an agent works here (keeps running in the background). */
  create(tabId: string, url: string, opts?: { agent?: boolean; zoom?: number; muted?: boolean }): void
  destroy(tabId: string): void
  load(tabId: string, url: string): void
  go(tabId: string, action: BrowserGo): void
  /** The view on screen (undefined: none — the new-tab page or an error page shows instead). */
  show(tabId: string | undefined): void
  /** Where views sit; null hides them all (the module is not on screen). */
  /** `focused`: the browser's pane has the focus, so its keys work from the UI too. */
  setBounds(bounds: ViewBounds | null, focused?: boolean): void
  /** A picture of the visible view (data URL), which hides until `unfreeze`; null when none is visible. */
  freeze(): Promise<string | null>
  unfreeze(): void
  find(tabId: string, text: string, opts: { forward: boolean; next: boolean }): void
  stopFind(tabId: string): void
  setZoom(tabId: string, factor: number): void
  setMuted(tabId: string, muted: boolean): void
  devtools(tabId: string): void
  print(tabId: string): void
  /** A native menu at the mouse pointer. */
  popup(entries: MenuEntry[]): void
  /** Keyboard focus back to the Mindeck UI (the address bar), away from the page. */
  focusUi(): void
  /** Pages follow the UI's light/dark mode. */
  setTheme(theme: 'dark' | 'light' | 'system'): void
  automation(tabId: string): AutomationTarget
  dispose(): void
}

/** What the views report back to the core. */
export interface BrowserHostEvents {
  navigated(tabId: string, nav: { url: string; canGoBack: boolean; canGoForward: boolean; inPage?: boolean }): void
  title(tabId: string, title: string): void
  favicon(tabId: string, url: string | undefined): void
  loading(tabId: string, loading: boolean): void
  failed(tabId: string, error: TabError): void
  crashed(tabId: string): void
  audible(tabId: string, audible: boolean): void
  /** ⌘-scroll or pinch on the page. */
  zoomed(tabId: string, direction: 'in' | 'out'): void
  /** A link wants a new tab (target=_blank, ⌘-click, "Open in new tab"). */
  openTab(url: string, opts: { background: boolean; opener?: string }): void
  found(result: BrowserFind): void
  console(tabId: string, entry: ConsoleEntry): void
  shortcut(action: ShortcutAction, tabId?: string): void
  /** A page took the keyboard focus (the user clicked into it). */
  focused(tabId: string): void
  /** The page's context menu wants something only the core knows. */
  command(tabId: string, command: 'sendToAgent' | 'search', arg?: string): void
  permission(ask: PermissionAsk, respond: (allow: boolean) => void): void
  /** Synchronous check for what the user allowed before (Chromium asks often). */
  permissionCheck(origin: string, kind: BrowserPermissionKind): boolean
  download(download: BrowserDownload, control: { cancel(): void }): void
  downloadUpdated(download: BrowserDownload): void
  /** The UI language, for menus the host draws itself. */
  locale(): 'de' | 'en'
  /** The search engine, for "Search for …" in the context menu. */
  searchLabel(): string
}
