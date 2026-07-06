import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type IpcChannel } from '@shared/ipc/contract'

const channelAllowlist = new Set<string>(IPC_CHANNELS)

/**
 * The single bridge between renderer and main. Window controls are exposed as
 * named methods; all typed domain IPC (projects, and later system/terminal/…)
 * goes through the allowlisted `invoke` — the renderer never touches ipcRenderer
 * directly, and only channels declared in the shared contract can be called.
 */
const api = {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
  onMaximizedChange: (cb: (isMax: boolean) => void): (() => void) => {
    const listener = (_: unknown, isMax: boolean) => cb(isMax)
    ipcRenderer.on('window:maximized-changed', listener)
    return () => {
      ipcRenderer.removeListener('window:maximized-changed', listener)
    }
  },
  platform: process.platform,

  /** Typed domain IPC. Channel is validated against the shared allowlist. */
  invoke: (channel: IpcChannel, payload?: unknown): Promise<unknown> => {
    if (!channelAllowlist.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, payload)
  }
}

export type WoneApi = typeof api

contextBridge.exposeInMainWorld('wone', api)
