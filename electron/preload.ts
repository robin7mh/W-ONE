import { contextBridge, ipcRenderer } from 'electron'

/**
 * The single bridge between renderer and main. All future privileged
 * integrations (real system metrics, node-pty shell, Obsidian vault fs access,
 * AI agent orchestration) should be exposed here as additional methods — the
 * renderer already accesses everything through the guarded `window.wone` object.
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
  platform: process.platform
}

export type WoneApi = typeof api

contextBridge.exposeInMainWorld('wone', api)
