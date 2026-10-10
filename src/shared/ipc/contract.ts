// The single source of truth for renderer↔main IPC.
// Main handlers, the preload allowlist, and the renderer client all derive
// their types from IpcChannels — add a capability here exactly once.
//
// Pure module (no DOM/Node/Electron) so it compiles under both tsconfigs.

import type { Project } from '@shared/types/project'
import type { SystemSnapshot } from '@shared/types/system'
import type { ProjectContext, ContextProgress } from '@shared/types/context'
import type {
  GraphStyle,
  MemoryChanged,
  MemoryGraph,
  Note,
  NoteMeta,
  SearchHit,
  VaultStatus
} from '@shared/types/memory'
import type { TerminalAttach, TerminalData, TerminalExit, TerminalInfo } from '@shared/types/terminal'
import type { FileContent, FileEntry, FileStat } from '@shared/types/files'
import type {
  AgentAvailability,
  AgentMessageUpdate,
  AgentSession,
  AgentSessionDetail,
  CreateSessionRequest,
  FileChange,
  SessionBranch,
  FileDiff
} from '@shared/types/agents'
import type {
  AppInfo,
  Device,
  DirListing,
  PairingCode,
  ServerConfig,
  ServerStatus,
  UpdateStatus
} from '@shared/types/server'
import type {
  AgentInfo,
  AgentRun,
  AiDelta,
  AiMessageUpdate,
  AiSettings,
  AiStatus,
  ApprovalDecision,
  Conversation,
  ConversationSummary,
  PermissionGrant,
  PermissionRequest,
  SendRequest,
  ToolInfo
} from '@shared/types/ai'
import type { WoneEvent } from '@shared/types/events'
import type { CloudStatus } from '@shared/types/cloud'

/** Every IPC call resolves to this — errors never cross the bridge as throws. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

/** Renderer→main request/response channels. `request: void` means no payload. */
export interface IpcChannels {
  'projects:list': { request: void; response: Project[] }
  'projects:pickFolder': { request: void; response: { path: string } | null }
  'projects:add': { request: { path: string }; response: Project }
  'projects:remove': { request: { id: string }; response: void }
  'projects:refresh': { request: { id: string }; response: Project }
  /** `git pull --ff-only` in the project, then fresh detection. */
  'projects:pull': { request: { id: string }; response: Project }
  'projects:openInEditor': { request: { id: string }; response: void }
  /** GitHub Desktop's name when it is installed on the desktop, else null. */
  'projects:githubDesktop': { request: void; response: string | null }
  'projects:openInGitHubDesktop': { request: { id: string }; response: void }
  'projects:openFile': { request: { id: string; file: string; line?: number }; response: void }

  'system:subscribe': { request: void; response: void }
  'system:unsubscribe': { request: void; response: void }
  'system:snapshot': { request: void; response: SystemSnapshot }
  'system:user': { request: void; response: { name: string; firstName: string } }

  'context:get': { request: { projectId: string }; response: ProjectContext | null }
  'context:reindex': { request: { projectId: string }; response: ProjectContext }

  'memory:status': { request: void; response: VaultStatus }
  'memory:createVault': { request: void; response: VaultStatus }
  'memory:pickVault': { request: void; response: VaultStatus | null }
  'memory:list': { request: void; response: NoteMeta[] }
  'memory:read': { request: { path: string }; response: Note }
  'memory:write': { request: { path: string; raw: string }; response: NoteMeta }
  'memory:create': { request: { title: string; folder?: string }; response: NoteMeta }
  'memory:trash': { request: { path: string }; response: void }
  'memory:graph': { request: void; response: MemoryGraph }
  'memory:search': { request: { query: string }; response: SearchHit[] }
  'memory:setGraphStyle': { request: GraphStyle; response: GraphStyle }
  'memory:reveal': { request: void; response: void }
  'memory:folders': { request: void; response: string[] }
  'memory:writeBody': { request: { path: string; body: string }; response: NoteMeta }
  'memory:createFolder': { request: { parent: string; name: string }; response: string }
  'memory:rename': { request: { path: string; title: string }; response: NoteMeta }
  'memory:move': { request: { path: string; folder: string }; response: NoteMeta }
  'memory:moveFolder': { request: { folder: string; into: string }; response: string }
  'memory:link': { request: { from: string; to: string }; response: NoteMeta }
  'memory:unlink': { request: { from: string; to: string }; response: NoteMeta }

  'terminal:create': { request: { projectId?: string; cols?: number; rows?: number }; response: TerminalInfo }
  'terminal:list': { request: void; response: TerminalInfo[] }
  'terminal:attach': { request: { id: string }; response: TerminalAttach }
  'terminal:write': { request: { id: string; data: string }; response: void }
  'terminal:resize': { request: { id: string; cols: number; rows: number }; response: void }
  'terminal:kill': { request: { id: string }; response: void }

  'files:list': { request: { projectId: string; dir?: string }; response: FileEntry[] }
  'files:read': { request: { projectId: string; path: string }; response: FileContent }
  'files:stat': { request: { projectId: string; paths: string[] }; response: (FileStat | null)[] }
  'files:write': {
    request: { projectId: string; path: string; content: string; expectedMtime?: number }
    response: FileStat
  }

  'app:info': { request: void; response: AppInfo }
  'fs:dirs': { request: { path?: string }; response: DirListing }
  'memory:setVault': { request: { path: string }; response: VaultStatus }

  'server:status': { request: void; response: ServerStatus }
  'server:configure': { request: Partial<ServerConfig>; response: ServerStatus }
  'server:createPairingCode': { request: void; response: PairingCode }
  'server:devices': { request: void; response: Device[] }
  'server:revokeDevice': { request: { id: string }; response: void }

  'ai:status': { request: void; response: AiStatus }
  'ai:setKey': { request: { key: string }; response: AiStatus }
  'ai:clearKey': { request: void; response: AiStatus }
  'ai:configure': { request: Partial<AiSettings>; response: AiStatus }
  'ai:agents': { request: void; response: AgentInfo[] }
  'ai:tools': { request: void; response: ToolInfo[] }
  'ai:conversations': { request: void; response: ConversationSummary[] }
  'ai:conversation': { request: { id: string }; response: Conversation }
  'ai:send': { request: SendRequest; response: { conversationId: string; messageId: string } }
  'ai:cancel': { request: { conversationId: string }; response: void }
  'ai:deleteConversation': { request: { id: string }; response: void }
  'ai:runs': { request: { limit?: number }; response: AgentRun[] }

  'permission:pending': { request: void; response: PermissionRequest[] }
  'permission:respond': { request: { id: string; decision: ApprovalDecision }; response: void }
  'permission:grants': { request: void; response: PermissionGrant[] }
  'permission:revoke': { request: { agentId: string; toolName: string }; response: void }

  'events:recent': { request: { limit?: number; conversationId?: string }; response: WoneEvent[] }

  'agents:detect': { request: void; response: AgentAvailability[] }
  'agents:list': { request: void; response: AgentSession[] }
  'agents:get': { request: { id: string }; response: AgentSessionDetail }
  'agents:create': { request: CreateSessionRequest; response: AgentSession }
  'agents:send': { request: { id: string; text: string }; response: void }
  'agents:interrupt': { request: { id: string }; response: void }
  'agents:stop': { request: { id: string }; response: void }
  'agents:resume': { request: { id: string }; response: AgentSession }
  'agents:remove': { request: { id: string }; response: void }
  'agents:changes': { request: { id: string }; response: FileChange[] }
  'agents:branch': { request: { id: string }; response: SessionBranch | null }
  'agents:diff': { request: { id: string; path: string }; response: FileDiff }
  'agents:accept': { request: { id: string }; response: { files: number } }
  'agents:discard': { request: { id: string }; response: void }
  'agents:rename': { request: { id: string; title: string }; response: AgentSession }
  'agents:shell': { request: { id: string }; response: { terminalId: string } }
  'agents:openInEditor': { request: { id: string }; response: void }

  'cloud:status': { request: void; response: CloudStatus }
  'cloud:login': { request: { email: string; password: string }; response: CloudStatus }
  'cloud:register': {
    request: { email: string; password: string; name?: string; locale: 'de' | 'en' }
    response: CloudStatus
  }
  'cloud:logout': { request: void; response: CloudStatus }
  'cloud:refresh': { request: void; response: CloudStatus }
  'cloud:resendVerification': { request: void; response: void }
  'cloud:forgotPassword': { request: { email: string }; response: void }
  'cloud:checkout': { request: void; response: { url: string } }

  'update:status': { request: void; response: UpdateStatus }
  'update:check': { request: void; response: UpdateStatus }
  'update:install': { request: void; response: void }
}

export type IpcChannel = keyof IpcChannels

/**
 * Who may call a channel:
 * - `any`      — every transport (desktop IPC and paired remote clients)
 * - `desktop`  — only the desktop app's own window: native dialogs, opening
 *                things on the host, and the server's own configuration
 * - `terminal` — desktop, or remote clients when remote shells are enabled
 *                (shells, and writing project files — both can run code)
 */
export type ChannelAccess = 'any' | 'desktop' | 'terminal'

/** Every channel classified exactly once — a new channel without one is a type error. */
export const CHANNEL_ACCESS: Record<IpcChannel, ChannelAccess> = {
  'projects:list': 'any',
  'projects:pickFolder': 'desktop',
  'projects:add': 'any',
  'projects:remove': 'any',
  'projects:refresh': 'any',
  'projects:pull': 'terminal',
  'projects:openInEditor': 'desktop',
  'projects:githubDesktop': 'desktop',
  'projects:openInGitHubDesktop': 'desktop',
  'projects:openFile': 'desktop',
  'system:subscribe': 'any',
  'system:unsubscribe': 'any',
  'system:snapshot': 'any',
  'system:user': 'any',
  'context:get': 'any',
  'context:reindex': 'any',
  'memory:status': 'any',
  'memory:createVault': 'any',
  'memory:pickVault': 'desktop',
  'memory:list': 'any',
  'memory:read': 'any',
  'memory:write': 'any',
  'memory:create': 'any',
  'memory:trash': 'any',
  'memory:graph': 'any',
  'memory:search': 'any',
  'memory:setGraphStyle': 'any',
  'memory:reveal': 'desktop',
  'memory:folders': 'any',
  'memory:writeBody': 'any',
  'memory:createFolder': 'any',
  'memory:rename': 'any',
  'memory:move': 'any',
  'memory:moveFolder': 'any',
  'memory:link': 'any',
  'memory:unlink': 'any',
  'memory:setVault': 'any',
  'terminal:create': 'terminal',
  'terminal:list': 'terminal',
  'terminal:attach': 'terminal',
  'terminal:write': 'terminal',
  'terminal:resize': 'terminal',
  'terminal:kill': 'terminal',
  'files:list': 'any',
  'files:read': 'any',
  'files:stat': 'any',
  'files:write': 'terminal',
  'app:info': 'any',
  'fs:dirs': 'any',
  'server:status': 'any',
  'server:configure': 'desktop',
  'server:createPairingCode': 'any',
  'server:devices': 'any',
  'server:revokeDevice': 'any',
  'ai:status': 'any',
  'ai:setKey': 'any',
  'ai:clearKey': 'any',
  'ai:configure': 'any',
  'ai:agents': 'any',
  'ai:tools': 'any',
  'ai:conversations': 'any',
  'ai:conversation': 'any',
  'ai:send': 'any',
  'ai:cancel': 'any',
  'ai:deleteConversation': 'any',
  'ai:runs': 'any',
  'permission:pending': 'any',
  'permission:respond': 'any',
  'permission:grants': 'any',
  'permission:revoke': 'any',
  'events:recent': 'any',
  // Agents run programs on this machine: starting or driving them is a shell's power.
  'agents:detect': 'any',
  'agents:list': 'any',
  'agents:get': 'any',
  'agents:create': 'terminal',
  'agents:send': 'terminal',
  'agents:interrupt': 'terminal',
  'agents:stop': 'terminal',
  'agents:resume': 'terminal',
  'agents:remove': 'terminal',
  'agents:changes': 'any',
  'agents:branch': 'any',
  'agents:diff': 'any',
  'agents:accept': 'terminal',
  'agents:discard': 'terminal',
  'agents:rename': 'terminal',
  'agents:shell': 'terminal',
  'agents:openInEditor': 'desktop',
  // The W-ONE account: a headless core is signed in from its web UI, so every client may.
  'cloud:status': 'any',
  'cloud:login': 'any',
  'cloud:register': 'any',
  'cloud:logout': 'any',
  'cloud:refresh': 'any',
  'cloud:resendVerification': 'any',
  'cloud:forgotPassword': 'any',
  'cloud:checkout': 'any',
  // The desktop app updates itself; nothing a remote client should trigger.
  'update:status': 'desktop',
  'update:check': 'desktop',
  'update:install': 'desktop'
}

/** Runtime allowlist — the preload rejects any channel not in this set. */
export const IPC_CHANNELS = Object.keys(CHANNEL_ACCESS) as readonly IpcChannel[]

/** Main→renderer push events (channel → payload). */
export interface IpcEvents {
  'system:tick': SystemSnapshot
  'context:progress': ContextProgress
  'memory:changed': MemoryChanged
  'terminal:data': TerminalData
  'terminal:exit': TerminalExit
  'ai:delta': AiDelta
  'ai:message': AiMessageUpdate
  'ai:conversationsChanged': { reason: 'created' | 'updated' | 'deleted'; id: string }
  'permission:request': PermissionRequest
  'permission:resolved': { id: string; decision: ApprovalDecision }
  'events:event': WoneEvent
  'agents:changed': { session?: AgentSession; removed?: string }
  'agents:message': AgentMessageUpdate
  'cloud:status': CloudStatus
  'update:status': UpdateStatus
}

export type IpcEvent = keyof IpcEvents

/** Runtime allowlist for event channels the preload may forward. */
export const IPC_EVENTS: readonly IpcEvent[] = [
  'system:tick',
  'context:progress',
  'memory:changed',
  'terminal:data',
  'terminal:exit',
  'ai:delta',
  'ai:message',
  'ai:conversationsChanged',
  'permission:request',
  'permission:resolved',
  'events:event',
  'agents:changed',
  'agents:message',
  'cloud:status',
  'update:status'
]

/** Push events remote clients only receive when remote shells are enabled. */
export const TERMINAL_EVENTS: readonly IpcEvent[] = ['terminal:data', 'terminal:exit']
