import { mkdir } from 'node:fs/promises'
import { hostname } from 'node:os'
import type { AppInfo, CoreMode, ServerConfig } from '@shared/types/server'
import type { WonePaths } from '../lib/paths'
import type { Platform } from '../platform/types'
import { openInVsCode } from '../lib/openInVsCode'
import { Router } from '../../ipc/router'
import { registerProjectIpc } from '../../ipc/projects.ipc'
import { registerSystemIpc } from '../../ipc/system.ipc'
import { registerContextIpc } from '../../ipc/context.ipc'
import { registerMemoryIpc } from '../../ipc/memory.ipc'
import { registerTerminalIpc } from '../../ipc/terminal.ipc'
import { registerFilesIpc } from '../../ipc/files.ipc'
import { registerAgentsIpc } from '../../ipc/agents.ipc'
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
import { FilesService } from '../services/files/FilesService'
import { AuthService } from '../services/auth/AuthService'
import { DbService, createPool, databaseUrl } from '../services/db/DbService'
import { MIGRATIONS } from '../services/db/migrations'
import { EventBus } from '../services/events/EventBus'
import { EventLog } from '../services/events/EventLog'
import { ServerController } from '../server/ServerController'
import { SecretStore, type Cipher } from '../services/ai/SecretStore'
import { AiService, type ProviderFactory } from '../services/ai/AiService'
import { ConversationStore } from '../services/ai/ConversationStore'
import { RunStore } from '../services/ai/RunStore'
import { PermissionService } from '../services/ai/PermissionService'
import { ContextBuilder } from '../services/ai/ContextBuilder'
import { AssistantService } from '../services/ai/AssistantService'
import { ToolRegistry } from '../services/ai/tools/registry'
import { builtinTools } from '../services/ai/tools/builtin'
import { GitService } from '../services/git/GitService'
import { LocalAgentServer } from '../services/agents/LocalAgentServer'
import { AgentSessionService } from '../services/agents/AgentSessionService'
import { createMcpHandler } from '../services/agents/mcp'
import { vaultJournal } from '../services/agents/journal'
import { spawnAcp } from '../services/agents/acp'
import { CloudService } from '../services/cloud/CloudService'
import { cloudConfig, type CloudConfig } from '../services/cloud/config'
import { isLicenseFree } from '@shared/types/cloud'

export interface CoreOptions {
  mode: CoreMode
  version: string
  paths: WonePaths
  platform: Platform
  /** Standalone server: fixed config from the environment. Desktop: from settings. */
  serverConfig?: ServerConfig
  /** Built web UI the network API serves at `/`. */
  webRoot?: string
  /** Encrypts stored secrets (desktop: OS keychain via Electron safeStorage). */
  cipher?: Cipher
  /** Injected LLM provider factory (tests). */
  providerFactory?: ProviderFactory
  /** Tell the user an agent needs them (desktop: a notification while the window is in the background). */
  notify?: (title: string, body: string) => void
  /** W-ONE Cloud: address, entitlement key, whether a license is required. Default: dev settings. */
  cloud?: CloudConfig & { fetch?: typeof fetch }
  /** Someone is at this machine (desktop: not idle). Remote clients count as use, too. */
  isUserActive?: () => boolean
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
  assistant: AssistantService
  agents: AgentSessionService
  cloud: CloudService
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

  // Every WoneEvent: kept in the EventLog (memory ring + Postgres once
  // connected) and pushed live to every client for the activity timeline.
  const eventLog = new EventLog()
  const events = new EventBus({ sink: eventLog, broadcast: (event) => hub.publish('events:event', event) })
  const runs = new RunStore()

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
  // The editor's project files — paths resolve against the project registry.
  const files = new FilesService((id) => projects.getProjectPath(id))
  const auth = new AuthService(paths.devicesFile)

  // The router asks the server controller whether remote shells are allowed,
  // and the cloud whether W-ONE is licensed (only ever called per request,
  // after all of them exist).
  const router = new Router({
    remoteTerminal: () => controller.remoteTerminal(),
    licensed: (channel) => isLicenseFree(channel) || cloud.allowed()
  })

  const controller: ServerController = new ServerController({
    mode: opts.mode,
    version: opts.version,
    router,
    hub,
    auth,
    settings: opts.serverConfig ? undefined : settings,
    fixedConfig: opts.serverConfig,
    webRoot: opts.webRoot,
    onClients: (count) => {
      system.setRemoteClients(count)
      cloud.setRemoteClients(count)
    }
  })

  const info = (): AppInfo => ({
    mode: opts.mode,
    version: opts.version,
    platform: process.platform,
    hostname: hostname(),
    remoteTerminal: controller.remoteTerminal(),
    db: { connected: !!db, schema: dbSchema }
  })

  // The assistant: provider, context engine, tools behind the permission gate.
  // One store for every secret (LLM key, cloud session) — one writer per file.
  const secrets = new SecretStore(paths.secretsFile, opts.cipher)
  const ai = new AiService({ settings, secrets, factory: opts.providerFactory })

  // The W-ONE account: sign-in, the trial clock and the license (W-ONE Cloud).
  const cloudCfg: CloudConfig & { fetch?: typeof fetch } = opts.cloud ?? cloudConfig(false)
  const cloud: CloudService = new CloudService({
    baseUrl: cloudCfg.url,
    publicKey: cloudCfg.publicKey,
    enforced: cloudCfg.enforced,
    client: opts.mode,
    version: opts.version,
    deviceName: hostname(),
    platform: process.platform,
    file: paths.cloudFile,
    secrets,
    isUserActive: opts.isUserActive,
    onStatus: (status) => hub.publish('cloud:status', status),
    fetch: cloudCfg.fetch
  })
  await cloud.init()
  const permissions = new PermissionService({
    file: paths.grantsFile,
    events,
    onRequest: (req) => hub.publish('permission:request', req),
    onResolved: (res) => hub.publish('permission:resolved', res)
  })
  const tools = new ToolRegistry(builtinTools({ vault, projects, context, system }))
  const assistant = new AssistantService({
    ai,
    store: new ConversationStore(paths.dataDir),
    runs,
    tools,
    permissions,
    events,
    context: new ContextBuilder({
      user: () => system.user(),
      projects: () => projects.list(),
      projectContext: (id) => context.get(id),
      vaultStatus: () => vault.status(),
      search: (q) => vault.search(q)
    }),
    publish: (channel, payload) => hub.publish(channel, payload),
    remoteShell: () => controller.remoteTerminal()
  })

  // The agent cockpit: the user's own coding agents (Claude Code), each in a
  // PTY, reporting back through hooks and reading W-ONE's memory over MCP —
  // both on a this-computer-only endpoint with a token per session.
  const local: LocalAgentServer = new LocalAgentServer({
    hook: (id, body, signal) => agents.handleHook(id, body, signal),
    mcp: (id, body) => agents.handleMcp(id, body)
  })
  const agents: AgentSessionService = new AgentSessionService({
    dir: paths.agentsDir,
    worktreesDir: paths.worktreesDir,
    terminal,
    git: new GitService(),
    server: local,
    permissions,
    events,
    projects: (id) => projects.list().find((p) => p.id === id),
    publish: (channel, payload) => hub.publish(channel, payload),
    mcp: createMcpHandler(tools, opts.version),
    journal: vaultJournal(vault),
    notify: opts.notify,
    spawnAcp,
    claudeBin: process.env.WONE_CLAUDE_BIN || undefined,
    openFolder: (path) => openInVsCode(path, platform)
  })
  await Promise.all([agents.init(), local.start()])

  registerProjectIpc(router, projects)
  registerSystemIpc(router, system)
  registerContextIpc(router, context)
  registerMemoryIpc(router, vault)
  registerTerminalIpc(router, terminal)
  registerFilesIpc(router, files)
  registerAgentsIpc(router, agents)
  router.register('app:info', () => info())
  router.register('fs:dirs', ({ path }) => fs.dirs(path))
  router.register('server:status', () => controller.status())
  router.register('server:configure', (patch) => controller.configure(patch))
  router.register('server:createPairingCode', () => controller.createPairingCode())
  router.register('server:devices', () => controller.devices())
  router.register('server:revokeDevice', ({ id }) => controller.revoke(id))
  router.register('ai:status', () => ai.status())
  router.register('ai:setKey', ({ key }) => ai.setKey(key))
  router.register('ai:clearKey', () => ai.clearKey())
  router.register('ai:configure', (patch) => ai.configure(patch))
  router.register('ai:agents', () => assistant.agents())
  router.register('ai:tools', () => tools.info())
  router.register('ai:conversations', () => assistant.conversations())
  router.register('ai:conversation', ({ id }) => assistant.conversation(id))
  router.register('ai:send', (req, ctx) => assistant.send(req, ctx))
  router.register('ai:cancel', ({ conversationId }) => assistant.cancel(conversationId))
  router.register('ai:deleteConversation', ({ id }) => assistant.remove(id))
  router.register('ai:runs', ({ limit }) => assistant.runs(limit))
  router.register('permission:pending', () => permissions.list())
  router.register('permission:respond', ({ id, decision }, ctx) => permissions.respond(id, decision, ctx.deviceId))
  router.register('permission:grants', () => permissions.grants())
  router.register('permission:revoke', ({ agentId, toolName }) => permissions.revoke(agentId, toolName))
  router.register('events:recent', (q) => eventLog.recent(q))
  router.register('cloud:status', () => cloud.status())
  router.register('cloud:login', (req) => cloud.login(req))
  router.register('cloud:register', (req) => cloud.register(req))
  router.register('cloud:logout', () => cloud.logout())
  router.register('cloud:refresh', () => cloud.refresh())
  router.register('cloud:resendVerification', () => cloud.resendVerification())
  router.register('cloud:forgotPassword', (req) => cloud.forgotPassword(req))
  router.register('cloud:checkout', () => cloud.checkout())

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
      eventLog.attach(candidate)
      runs.attach(candidate)
      if (result.applied.length) events.emit('db.migrated', { payload: result })
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
    assistant,
    agents,
    cloud,
    dbReady: connecting,
    info,
    async dispose() {
      cloud.dispose()
      await assistant.dispose()
      await agents.dispose()
      await local.close()
      system.dispose()
      vault.dispose()
      terminal.killAll()
      await controller.stop()
      await connecting
      const open = db
      db = null
      eventLog.attach(null)
      runs.attach(null)
      await open?.close().catch(() => {})
    }
  }
}
