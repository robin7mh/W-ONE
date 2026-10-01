import { ipcMain } from 'electron'
import type { IpcChannel, IpcChannels, IpcResult } from '@shared/ipc/contract'

type Handler<K extends IpcChannel> = (
  req: IpcChannels[K]['request']
) => Promise<IpcChannels[K]['response']> | IpcChannels[K]['response']

/**
 * Registers a typed handler for one contract channel. Wraps the result in
 * IpcResult and converts thrown errors into a structured error payload — the
 * renderer never receives a raw exception across the bridge.
 */
export function handle<K extends IpcChannel>(channel: K, handler: Handler<K>): void {
  ipcMain.handle(channel, async (_event, req): Promise<IpcResult<IpcChannels[K]['response']>> => {
    try {
      const data = await handler(req as IpcChannels[K]['request'])
      return { ok: true, data }
    } catch (err) {
      const e = err as { code?: string; message?: string }
      return {
        ok: false,
        error: { code: e?.code ?? 'error', message: e?.message ?? String(err) }
      }
    }
  })
}
