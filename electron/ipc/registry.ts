import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/contract'
import type { Router } from './router'

/**
 * Binds every contract channel to the desktop window's IPC. Validation,
 * access rules and error wrapping all live in the Router — the same code path
 * the network API uses.
 */
export function bindIpc(router: Router): void {
  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, (_event, req) => router.dispatch(channel, req, { transport: 'ipc' }))
  }
}
