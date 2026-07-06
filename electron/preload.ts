import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, type IpcChannel, type IpcEvent } from '@shared/ipc/contract'

const channelAllowlist = new Set<string>(IPC_CHANNELS)
const eventAllowlist = new Set<string>(IPC_EVENTS)

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
  },

  /** Subscribe to a main→renderer push event. Returns an unsubscribe fn. */
  on: (channel: IpcEvent, cb: (payload: unknown) => void): (() => void) => {
    if (!eventAllowlist.has(channel)) {
      throw new Error(`Blocked IPC event: ${channel}`)
    }
    const listener = (_: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

export type WoneApi = typeof api

contextBridge.exposeInMainWorld('wone', api)
