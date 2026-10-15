import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { app, desktopCapturer, systemPreferences, type DownloadItem, type Session, type WebContents } from 'electron'
import type { BrowserDownload, BrowserPermissionKind } from '@shared/types/browser'
import type { BrowserHostEvents } from '../../services/browser/types'
import { isLoopbackHost, originOf } from '../../services/browser/url'

/** Web pages' own profile: cookies, cache and logins, apart from the Mindeck UI's. */
export const BROWSER_PARTITION = 'persist:mindeck-browser'

/** Who answers the session's questions: the browser host of the window that is open now. */
export interface SessionTarget {
  events: BrowserHostEvents
  /** The tab a page belongs to (undefined: a popup window). */
  tabOf(contents: WebContents | null | undefined): string | undefined
}

/**
 * Chrome's user agent: Electron's minus its own and the app's token, the
 * Chrome version reduced the way Chrome itself does. Some sites refuse
 * anything that says "Electron" — Google's sign-in among them.
 */
export function chromeUserAgent(ua: string): string {
  return ua.replace(/ (?!(?:Mozilla|AppleWebKit|Chrome|Safari|Version|Mobile)\/)[A-Za-z][\w.-]*\/\S+/g, '').replace(/Chrome\/(\d+)[\d.]*/, 'Chrome/$1.0.0.0')
}

/** How Mindeck answers a permission: allowed, refused, or asked as one of the user-facing kinds. */
export function decide(permission: string, mediaTypes: string[] = []): boolean | BrowserPermissionKind {
  switch (permission) {
    case 'fullscreen':
    case 'automatic-fullscreen':
    case 'pointerLock':
    case 'keyboardLock':
    case 'clipboard-sanitized-write':
    case 'persistent-storage':
      return true
    case 'media': {
      const video = mediaTypes.includes('video')
      const audio = mediaTypes.includes('audio')
      return video && !audio ? 'camera' : audio && !video ? 'microphone' : 'media'
    }
    case 'notifications':
      return 'notifications'
    case 'geolocation':
    case 'geolocation-approximate':
      return 'geolocation'
    case 'clipboard-read':
      return 'clipboard'
    case 'display-capture':
      return 'screen'
    case 'openExternal':
      return 'external'
    default:
      return false
  }
}

/** `name 2.ext`, `name 3.ext`, … — the first free name in `dir` (synchronous: Chromium needs the path at once). */
export function freeDownloadPath(dir: string, filename: string): string {
  const name = basename(filename) || 'download'
  let path = join(dir, name)
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 2; existsSync(path); i += 1) path = join(dir, `${stem} ${i}${ext}`)
  return path
}

/** macOS: mark a download as coming from the internet, so Gatekeeper checks it before it runs. */
export function quarantine(path: string, run: typeof execFile = execFile): void {
  if (process.platform !== 'darwin') return
  run('xattr', ['-p', 'com.apple.quarantine', path], (missing) => {
    if (!missing) return // Chromium marked it already
    const value = `0081;${Math.floor(Date.now() / 1000).toString(16)};Mindeck;${randomUUID().toUpperCase()}`
    run('xattr', ['-w', 'com.apple.quarantine', value, path], () => {})
  })
}

/** Camera and microphone also need macOS's own consent (System Settings → Privacy). */
async function osAllows(kind: BrowserPermissionKind): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  const media: ('camera' | 'microphone')[] = kind === 'camera' ? ['camera'] : kind === 'microphone' ? ['microphone'] : kind === 'media' ? ['camera', 'microphone'] : []
  for (const m of media) if (!(await systemPreferences.askForMediaAccess(m))) return false
  return true
}

const configured = new WeakSet<Session>()

/**
 * Sets the browser profile up once per run: Chrome's user agent, a question
 * to the user for everything sensitive (camera, notifications, screen,
 * another app), downloads into ~/Downloads, and trust for local dev
 * certificates. Every answer comes from whichever window's host is current.
 */
export function configureBrowserSession(ses: Session, current: () => SessionTarget | null): void {
  if (configured.has(ses)) return
  configured.add(ses)
  ses.setUserAgent(chromeUserAgent(ses.getUserAgent()))

  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const target = current()
    const kind = decide(permission, 'mediaTypes' in details ? details.mediaTypes : [])
    if (typeof kind === 'boolean' || !target) return callback(kind === true)
    const securityOrigin = 'securityOrigin' in details ? details.securityOrigin : undefined
    const origin = originOf(securityOrigin || details.requestingUrl)
    let extra: { target?: string; app?: string } = {}
    if (kind === 'external') {
      const url = 'externalURL' in details ? (details.externalURL ?? '') : ''
      const handler = app.getApplicationNameForProtocol(url)
      // Nothing on this machine opens it: nothing to ask.
      if (!url || !handler) return callback(false)
      extra = { target: url, app: handler }
    }
    target.events.permission({ tabId: target.tabOf(contents), origin, kind, ...extra }, (allow) => {
      if (!allow) return callback(false)
      void osAllows(kind).then(callback, () => callback(false))
    })
  })

  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    const kind = decide(permission, details.mediaType ? [details.mediaType] : [])
    if (typeof kind === 'boolean') return kind
    return current()?.events.permissionCheck(originOf(requestingOrigin), kind) ?? false
  })

  // Sharing the screen (Meet, Zoom, Loom): macOS's own picker where there is one, else the whole screen after asking.
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      const target = current()
      if (!target) return callback(null)
      target.events.permission({ origin: originOf(request.securityOrigin), kind: 'screen' }, (allow) => {
        if (!allow) return callback(null)
        void desktopCapturer.getSources({ types: ['screen'] }).then(
          (sources) => callback(sources[0] ? { video: sources[0] } : null),
          () => callback(null)
        )
      })
    },
    { useSystemPicker: true }
  )

  ses.on('will-download', (_event, item) => track(item, current))

  // Local dev servers often use self-signed certificates (mkcert, Vite's basic-ssl): trust them on this machine only.
  ses.setCertificateVerifyProc((request, callback) => callback(isLoopbackHost(request.hostname) ? 0 : -3))
}

/** A download: saved under a free name in ~/Downloads, its progress reported (at most ~4× a second). */
function track(item: DownloadItem, current: () => SessionTarget | null): void {
  const path = freeDownloadPath(app.getPath('downloads'), item.getFilename())
  item.setSavePath(path)
  const base: BrowserDownload = {
    id: randomUUID(),
    filename: basename(path),
    path,
    url: item.getURL(),
    state: 'progressing',
    received: 0,
    total: item.getTotalBytes(),
    startedAt: new Date().toISOString()
  }
  current()?.events.download(base, { cancel: () => item.cancel() })
  let last = 0
  item.on('updated', (_event, state) => {
    const now = Date.now()
    if (state === 'progressing' && now - last < 250) return
    last = now
    current()?.events.downloadUpdated({ ...base, state, received: item.getReceivedBytes(), total: item.getTotalBytes() })
  })
  item.once('done', (_event, state) => {
    current()?.events.downloadUpdated({ ...base, state, received: item.getReceivedBytes(), total: item.getTotalBytes() })
    if (state === 'completed') quarantine(path)
  })
}
