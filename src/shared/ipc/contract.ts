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
  'projects:openInEditor': { request: { id: string }; response: void }
  'projects:openTerminal': { request: { id: string }; response: void }
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
}

export type IpcChannel = keyof IpcChannels

/** Runtime allowlist — the preload rejects any channel not in this set. */
export const IPC_CHANNELS: readonly IpcChannel[] = [
  'projects:list',
  'projects:pickFolder',
  'projects:add',
  'projects:remove',
  'projects:refresh',
  'projects:openInEditor',
  'projects:openTerminal',
  'projects:openFile',
  'system:subscribe',
  'system:unsubscribe',
  'system:snapshot',
  'system:user',
  'context:get',
  'context:reindex',
  'memory:status',
  'memory:createVault',
  'memory:pickVault',
  'memory:list',
  'memory:read',
  'memory:write',
  'memory:create',
  'memory:trash',
  'memory:graph',
  'memory:search',
  'memory:setGraphStyle',
  'memory:reveal',
  'memory:folders',
  'memory:writeBody',
  'memory:createFolder',
  'memory:rename',
  'memory:move',
  'memory:moveFolder',
  'memory:link',
  'memory:unlink',
  'terminal:create',
  'terminal:list',
  'terminal:attach',
  'terminal:write',
  'terminal:resize',
  'terminal:kill'
]

/** Main→renderer push events (channel → payload). */
export interface IpcEvents {
  'system:tick': SystemSnapshot
  'context:progress': ContextProgress
  'memory:changed': MemoryChanged
  'terminal:data': TerminalData
  'terminal:exit': TerminalExit
}

export type IpcEvent = keyof IpcEvents

/** Runtime allowlist for event channels the preload may forward. */
export const IPC_EVENTS: readonly IpcEvent[] = [
  'system:tick',
  'context:progress',
  'memory:changed',
  'terminal:data',
  'terminal:exit'
]
