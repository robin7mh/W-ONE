// Renderer-side typed IPC client. Uses window.wone.invoke (guarded, so it also
// fails cleanly in a plain browser where the bridge is absent).

import type { IpcChannel, IpcChannels, IpcResult } from './contract'

export class IpcError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'IpcError'
    this.code = code
  }
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
