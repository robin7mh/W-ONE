// The single source of truth for renderer↔main IPC.
// Main handlers, the preload allowlist, and the renderer client all derive
// their types from IpcChannels — add a capability here exactly once.
//
// Pure module (no DOM/Node/Electron) so it compiles under both tsconfigs.

import type { Project } from '@shared/types/project'
import type { SystemSnapshot } from '@shared/types/system'

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

  'system:subscribe': { request: void; response: void }
  'system:unsubscribe': { request: void; response: void }
  'system:snapshot': { request: void; response: SystemSnapshot }
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
  'system:subscribe',
  'system:unsubscribe',
  'system:snapshot'
]

/** Main→renderer push events (channel → payload). */
export interface IpcEvents {
  'system:tick': SystemSnapshot
}

export type IpcEvent = keyof IpcEvents

/** Runtime allowlist for event channels the preload may forward. */
export const IPC_EVENTS: readonly IpcEvent[] = ['system:tick']
