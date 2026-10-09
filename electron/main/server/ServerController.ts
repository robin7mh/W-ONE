import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import {
  DEFAULT_SERVER_CONFIG,
  type CoreMode,
  type Device,
  type PairingCode,
  type ServerConfig,
  type ServerStatus
} from '@shared/types/server'
import type { Router } from '../../ipc/router'
import type { EventHub } from '../core/EventHub'
import type { AuthService } from '../services/auth/AuthService'
import type { SettingsService } from '../services/settings/SettingsService'
import { HttpServer } from './HttpServer'

/** Non-internal IPv4 addresses — what a phone on the same network can reach. */
export function lanAddresses(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  return Object.values(ifaces)
    .flatMap((list) => list ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => a.address)
}

export interface ServerControllerOptions {
  mode: CoreMode
  version: string
  router: Router
  hub: EventHub
  auth: AuthService
  /** Desktop: config lives in settings and is editable. */
  settings?: SettingsService
  /** Standalone: fixed config from the environment. */
  fixedConfig?: ServerConfig
  webRoot?: string
  onClients?: (count: number) => void
  /** Injected for tests. */
  addresses?: () => string[]
  createServer?: (opts: ConstructorParameters<typeof HttpServer>[0]) => HttpServer
}

/**
 * Owns the network API's lifecycle and configuration. On the desktop the
 * server is opt-in (Settings → Server), bound to 127.0.0.1 unless LAN access
 * is switched on; the standalone server is always on with its env config.
 */
export class ServerController {
  private http?: HttpServer
  private error?: string
  private config: ServerConfig

  constructor(private readonly opts: ServerControllerOptions) {
    this.config = opts.fixedConfig ?? { ...DEFAULT_SERVER_CONFIG, ...opts.settings?.get().server }
  }

  remoteTerminal(): boolean {
    return this.config.remoteTerminal
  }

  status(): ServerStatus {
    return {
      config: { ...this.config },
      running: !!this.http,
      urls: this.urls(),
      error: this.error,
      configurable: !this.opts.fixedConfig
    }
  }

  /** Start if enabled (desktop) or always (standalone). Errors are kept in status. */
  async start(): Promise<void> {
    if (this.http || !this.config.enabled) return
    const http = (this.opts.createServer ?? ((o) => new HttpServer(o)))({
      router: this.opts.router,
      hub: this.opts.hub,
      auth: this.opts.auth,
      mode: this.opts.mode,
      version: this.opts.version,
      webRoot: this.opts.webRoot,
      remoteTerminal: () => this.config.remoteTerminal,
      onClients: this.opts.onClients
    })
    try {
      await http.listen(this.host(), this.config.port)
      this.http = http
      this.error = undefined
    } catch (err) {
      this.error = (err as Error).message
      await http.close()
    }
  }

  async stop(): Promise<void> {
    const http = this.http
    this.http = undefined
    await http?.close()
  }

  /** Desktop only: change settings, persist, and restart when needed. */
  async configure(patch: Partial<ServerConfig>): Promise<ServerStatus> {
    if (this.opts.fixedConfig || !this.opts.settings) {
      throw Object.assign(new Error('This server is configured through its environment'), { code: 'not-configurable' })
    }
    const next = { ...this.config, ...patch }
    const restart = next.enabled !== this.config.enabled || next.lan !== this.config.lan || next.port !== this.config.port
    this.config = next
    await this.opts.settings.update({ server: next })
    if (restart) {
      await this.stop()
      await this.start()
    }
    return this.status()
  }

  async createPairingCode(): Promise<PairingCode> {
    const { code, expiresAt } = await this.opts.auth.createPairingCode()
    return { code, expiresAt, urls: this.urls() }
  }

  devices(): Promise<Device[]> {
    return this.opts.auth.devices()
  }

  async revoke(id: string): Promise<void> {
    await this.opts.auth.revoke(id)
    this.http?.disconnectDevice(id)
  }

  private host(): string {
    return this.config.lan ? '0.0.0.0' : '127.0.0.1'
  }

  private urls(): string[] {
    const port = this.http?.port || this.config.port // the bound port (port 0 = any free one)
    const hosts = ['127.0.0.1', ...(this.config.lan ? (this.opts.addresses ?? lanAddresses)() : [])]
    return hosts.map((h) => `http://${h}:${port}`)
  }
}
