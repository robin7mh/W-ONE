import { create } from 'zustand'
import { errorMessage, ipc, isDesktop, onEvent } from '@shared/ipc/client'
import type { IpcChannel, IpcChannels } from '@shared/ipc/contract'
import type { BrowserCommand, BrowserFind, BrowserState, BrowserTab } from '@shared/types/browser'

const EMPTY: BrowserState = { available: false, tabs: [], closed: 0, downloads: [], permissions: [], devServers: [] }

/** What the browser asks of the rest of the app (the shell decides where to go). */
export interface BrowserHandlers {
  /** Show the browser module. */
  reveal(): void
  /** "Send to agent": the tab is shared now — start a chat about it. */
  sendToAgent(tab: BrowserTab): void
  /** Open the browser settings. */
  settings(): void
}

let handlers: BrowserHandlers | null = null

interface BrowserStore {
  state: BrowserState
  find?: BrowserFind
  findOpen: boolean
  /** Bumped to put the keyboard focus into the address bar. */
  focusTick: number
  downloadsOpen: boolean
  extensionsOpen: boolean
  error?: string
  /** Push events → this store; `handlers` take the browser's requests to the rest of the app. */
  connect(next: BrowserHandlers): () => void
  refresh(): Promise<void>
  /** Call a browser channel; a failure shows as `error` instead of throwing. */
  run<K extends IpcChannel>(channel: K, ...args: IpcChannels[K]['request'] extends void ? [] : [IpcChannels[K]['request']]): Promise<IpcChannels[K]['response'] | undefined>
  /** From anywhere in Mindeck: open `url` in a tab and bring the browser up. */
  show(url: string): Promise<void>
  /** A new tab with the new-tab page, the address bar ready (`private`: a private tab). */
  newTab(opts?: { private?: boolean }): Promise<void>
  /** Load what was typed (an address or search words) in the tab on screen. */
  go(input: string): Promise<void>
  /** Share the tab on screen with agents and start a chat about it. */
  sendToAgent(): Promise<void>
  setFindOpen(open: boolean): void
  toggleDownloads(): void
  /** The extension manager beside the page (it takes the downloads' place). */
  toggleExtensions(): void
  clearError(): void
}

export const useBrowser = create<BrowserStore>((set, get) => {
  const command = (c: BrowserCommand) => {
    if (c === 'focusOmnibox') set((s) => ({ focusTick: s.focusTick + 1 }))
    else if (c === 'find') set({ findOpen: true })
    else if (c === 'settings') handlers?.settings()
    else {
      const tab = activeTab(get().state)
      if (tab) handlers?.sendToAgent(tab)
    }
  }

  return {
    state: EMPTY,
    findOpen: false,
    focusTick: 0,
    downloadsOpen: false,
    extensionsOpen: false,

    connect: (next) => {
      handlers = next
      void get().refresh()
      const offs = [
        onEvent('browser:state', (state) => set({ state })),
        onEvent('browser:find', (find) => set({ find })),
        onEvent('browser:command', ({ command: c }) => command(c)),
        onEvent('browser:reveal', () => handlers?.reveal())
      ]
      return () => {
        offs.forEach((off) => off())
        if (handlers === next) handlers = null
      }
    },

    refresh: async () => {
      if (!isDesktop()) return
      const state = await get().run('browser:state')
      if (state) set({ state })
    },

    run: async (channel, ...args) => {
      try {
        return await ipc(channel, ...args)
      } catch (err) {
        set({ error: errorMessage(err) })
        return undefined
      }
    },

    show: async (url) => {
      const tab = await get().run('browser:open', { url })
      if (tab) handlers?.reveal()
    },

    newTab: async (opts = {}) => {
      await get().run('browser:open', opts.private ? { private: true } : {})
      set((s) => ({ focusTick: s.focusTick + 1 }))
    },

    go: async (input) => {
      const tab = activeTab(get().state)
      if (tab) await get().run('browser:navigate', { id: tab.id, input })
      else await get().run('browser:open', { url: input })
    },

    sendToAgent: async () => {
      const tab = activeTab(get().state)
      if (!tab?.url) return
      await get().run('browser:update', { id: tab.id, shared: true })
      handlers?.sendToAgent(tab)
    },

    setFindOpen: (open) => {
      set({ findOpen: open, ...(open ? {} : { find: undefined }) })
      const tab = activeTab(get().state)
      if (!open && tab) void get().run('browser:findStop', { id: tab.id })
    },

    toggleDownloads: () => set((s) => ({ downloadsOpen: !s.downloadsOpen })),
    toggleExtensions: () => set((s) => ({ extensionsOpen: !s.extensionsOpen, downloadsOpen: false })),
    clearError: () => set({ error: undefined })
  }
})

export function activeTab(state: BrowserState): BrowserTab | undefined {
  return state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0]
}

/** The tab on screen. */
export function useActiveTab(): BrowserTab | undefined {
  return useBrowser((s) => activeTab(s.state))
}
