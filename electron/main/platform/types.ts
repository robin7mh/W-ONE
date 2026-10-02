/**
 * What the core needs from its host. The same services run inside Electron
 * (desktop: native dialogs, Finder, OS trash) and as a headless Node server
 * (Docker / home server: no GUI on the host, so pickers and "open on this
 * machine" are unavailable and the trash is the vault's own `.trash`).
 */
export interface Platform {
  readonly kind: 'desktop' | 'server'
  /** Native folder picker; null on cancel. Absent where the host has no GUI. */
  pickFolder?: (title: string) => Promise<string | null>
  /** Open a file or folder with the host's default app. Absent on a server. */
  openPath?: (path: string) => Promise<void>
  /** Move a file to a recoverable trash. `root` is the vault it belongs to. */
  trashItem: (path: string, root: string) => Promise<void>
}

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** The error every desktop-only capability raises on a headless host. */
export const desktopOnly = (what: string): Error =>
  coded('desktop-only', `${what} is only available in the W-ONE desktop app`)
