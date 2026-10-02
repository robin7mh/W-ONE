import { mkdir } from 'node:fs/promises'
import { hostname } from 'node:os'
import type { AppInfo, CoreMode, ServerConfig } from '@shared/types/server'
import type { WonePaths } from '../lib/paths'
import type { Platform } from '../platform/types'
import { Router } from '../../ipc/router'
import { registerProjectIpc } from '../../ipc/projects.ipc'
import { registerSystemIpc } from '../../ipc/system.ipc'
import { registerContextIpc } from '../../ipc/context.ipc'
import { registerMemoryIpc } from '../../ipc/memory.ipc'
import { registerTerminalIpc } from '../../ipc/terminal.ipc'
import { EventHub } from './EventHub'
import { ProjectRegistry } from '../services/projects/registry'
import { ProjectService } from '../services/projects/ProjectService'
import { SystemService } from '../services/system/SystemService'
import { ContextStore } from '../services/context/contextStore'
import { ContextService } from '../services/context/ContextService'
import { VaultService } from '../services/memory/VaultService'
import { TerminalService } from '../services/terminal/TerminalService'
import { SettingsService } from '../services/settings/SettingsService'
import { FsService } from '../services/fs/FsService'
import { AuthService } from '../services/auth/AuthService'
import { DbService, createPool, databaseUrl } from '../services/db/DbService'
import { MIGRATIONS } from '../services/db/migrations'
import { EventBus, NoopEventSink } from '../services/events/EventBus'
import { ServerController } from '../server/ServerController'

export interface CoreOptions {
  mode: CoreMode
  version: string
  paths: WonePaths
  platform: Platform
  /** Standalone server: fixed config from the environment. Desktop: from settings. */
  serverConfig?: ServerConfig
  /** Built web UI the network API serves at `/`. */
  webRoot?: string
}

export interface Core {
  router: Router
  hub: EventHub
  events: EventBus
  settings: SettingsService
  system: SystemService
  terminal: TerminalService
  vault: VaultService
  server: ServerController
  auth: AuthService
  /** Settles once the background database connection attempt is over. */
  dbReady: Promise<void>
  info(): AppInfo
  dispose(): Promise<void>
}

/**
 * Builds the W-ONE core — every service, wired and registered on one Router —
 * independent of its host. The Electron app binds the Router to its window's
 * IPC; the standalone server (and the desktop's optional embedded server)
 * exposes the same Router over HTTP + WebSocket.
 */
export async function createCore(opts: CoreOptions): Promise<Core> {
  const { paths, platform } = opts
  await mkdir(paths.dataDir, { recursive: true })

  const settings = new SettingsService(paths.settingsFile)
  await settings.init()

  const hub = new EventHub()
  let db: DbService | null = null
  let dbSchema: number | undefined

  // Distributes all WoneEvents; persistence sink is a no-op until the events
  // table lands in P2B.
  const events = new EventBus({ sink: new NoopEventSink() })

  const projects = new ProjectService(new ProjectRegistry(paths.dataDir), platform)
  await projects.init()

  const system = new SystemService((snapshot) => hub.publish('system:tick', snapshot))

  const context = new ContextService({
    store: new ContextStore(paths.dataDir),
    resolvePath: (id) => projects.getProjectPath(id),
    onProgress: (progress) => hub.publish('context:progress', progress)
  })

  // Memory = Obsidian-compatible markdown vault; created lazily, never at boot.
  const vault = new VaultService({
    settings,
    platform,
    defaultRoot: paths.defaultVaultRoot,
    onChange: (change) => hub.publish('memory:changed', change)
  })

  // Interactive shells for the user (phase PT) — not an agent tool (§8.1).
  const terminal = new TerminalService({
    emit: (channel, payload) => hub.publish(channel, payload as never),
    resolveProject: (id) => projects.list().find((p) => p.id === id)
  })

  const fs = new FsService()
  const auth = new AuthService(paths.devicesFile)

  // The router asks the server controller whether remote shells are allowed
  // (only ever called per request, after both exist).
  const router = new Router({ remoteTerminal: () => controller.remoteTerminal() })

  const controller: ServerController = new ServerController({
    mode: opts.mode,
    version: opts.version,
    router,
    hub,
    auth,
    settings: opts.serverConfig ? undefined : settings,
    fixedConfig: opts.serverConfig,
    webRoot: opts.webRoot,
    onClients: (count) => system.setRemoteClients(count)
  })

  const info = (): AppInfo => ({
    mode: opts.mode,
    version: opts.version,
    platform: process.platform,
    hostname: hostname(),
    remoteTerminal: controller.remoteTerminal(),
    db: { connected: !!db, schema: dbSchema }
  })

  registerProjectIpc(router, projects)
  registerSystemIpc(router, system)
  registerContextIpc(router, context)
  registerMemoryIpc(router, vault)
  registerTerminalIpc(router, terminal)
  router.register('app:info', () => info())
  router.register('fs:dirs', ({ path }) => fs.dirs(path))
  router.register('server:status', () => controller.status())
  router.register('server:configure', (patch) => controller.configure(patch))
  router.register('server:createPairingCode', () => controller.createPairingCode())
  router.register('server:devices', () => controller.devices())
  router.register('server:revokeDevice', ({ id }) => controller.revoke(id))

  // Postgres runs in Docker (docker-compose.yml). Connected in the background:
  // a stopped container never delays startup — W-ONE stays usable without it.
  const connecting = (async () => {
    const url = databaseUrl()
    const candidate = new DbService(createPool(url))
    try {
      await candidate.ping()
      const result = await candidate.migrate(MIGRATIONS)
      db = candidate
      dbSchema = result.to
      console.log(`[db] connected — schema v${result.to}`)
    } catch (err) {
      await candidate.close().catch(() => {})
      console.warn(
        `[db] Postgres not reachable at ${url.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@')} — start it with: npm run db:up\n  ${(err as Error).message}`
      )
    }
  })()

  events.emit('app.started', { payload: { version: opts.version, mode: opts.mode } })

  return {
    router,
    hub,
    events,
    settings,
    system,
    terminal,
    vault,
    server: controller,
    auth,
    dbReady: connecting,
    info,
    async dispose() {
      system.dispose()
      vault.dispose()
      terminal.killAll()
      await controller.stop()
      await connecting
      const open = db
      db = null
      await open?.close().catch(() => {})
    }
  }
}
