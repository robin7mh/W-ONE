// Renderer-side typed IPC client. Uses window.wone.invoke (guarded, so it also
// fails cleanly in a plain browser where the bridge is absent).

import type { IpcChannel, IpcChannels, IpcEvent, IpcEvents, IpcResult } from './contract'

export class IpcError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'IpcError'
    this.code = code
  }
}

/** Human-readable message for anything thrown (IpcError is an Error too). */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

type Req<K extends IpcChannel> = IpcChannels[K]['request']
type Res<K extends IpcChannel> = IpcChannels[K]['response']

/**
 * Typed invoke. For channels whose request is `void` the payload arg is omitted:
 *   await ipc('projects:list')
 *   await ipc('projects:add', { path })
 */
export async function ipc<K extends IpcChannel>(
  channel: K,
  ...args: Req<K> extends void ? [] : [Req<K>]
): Promise<Res<K>> {
  const bridge = window.wone
  if (!bridge?.invoke) {
    throw new IpcError('no-bridge', 'W-ONE bridge unavailable (running outside Electron?)')
  }
  const res = (await bridge.invoke(channel, args[0])) as IpcResult<Res<K>>
  if (!res.ok) throw new IpcError(res.error.code, res.error.message)
  return res.data
}

/**
 * Subscribe to a main→renderer push event. Returns an unsubscribe function.
 * No-ops (returns a noop unsubscribe) outside Electron so callers stay simple.
 */
export function onEvent<K extends IpcEvent>(
  channel: K,
  cb: (payload: IpcEvents[K]) => void
): () => void {
  const bridge = window.wone
  if (!bridge?.on) return () => {}
  return bridge.on(channel, (payload) => cb(payload as IpcEvents[K]))
}
