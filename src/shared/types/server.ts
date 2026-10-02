// The W-ONE core as a network service: the same services the desktop app
// uses, reachable over HTTP + WebSocket by the web UI and the mobile app.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

/** Where the core runs: inside the Electron app, or headless (Docker/server). */
export type CoreMode = 'desktop' | 'server'

export interface AppInfo {
  mode: CoreMode
  version: string
  /** Host OS (`process.platform`) and machine name — what the core sees. */
  platform: string
  hostname: string
  /** Whether remote clients may open shells (opt-in). */
  remoteTerminal: boolean
  db: { connected: boolean; schema?: number }
}

/** Embedded/standalone API server settings. */
export interface ServerConfig {
  /** Desktop only: run the API server inside the app (standalone: always on). */
  enabled: boolean
  /** Listen on all interfaces (LAN/phone) instead of 127.0.0.1 only. */
  lan: boolean
  port: number
  /** Remote clients may open real shells. Off by default. */
  remoteTerminal: boolean
}

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  enabled: false,
  lan: false,
  port: 7420,
  remoteTerminal: false
}

export interface ServerStatus {
  config: ServerConfig
  running: boolean
  /** Base URLs a client can use (loopback, plus LAN addresses when `lan`). */
  urls: string[]
  /** Last start error (e.g. port in use). */
  error?: string
  /** False when the settings come from the environment (standalone server). */
  configurable: boolean
}

export interface PairingCode {
  /** Short one-time code, e.g. `K7QM-2XPA`. */
  code: string
  expiresAt: string
  urls: string[]
}

export interface Device {
  id: string
  name: string
  createdAt: string
  lastSeenAt?: string
}

/** Result of `POST /api/pair`. The token is shown exactly once. */
export interface PairResult {
  token: string
  device: Device
}

/** One level of the server-side folder browser (web/mobile folder picker). */
export interface DirListing {
  path: string
  parent: string | null
  home: string
  dirs: string[]
}
