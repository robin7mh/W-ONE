import { create } from 'zustand'
import { errorMessage, ipc, onEvent } from '@shared/ipc/client'
import type { RemoteConnection, SshHost } from '@shared/types/remote'

interface RemoteState {
  connections: RemoteConnection[]
  hosts: SshHost[]
  error?: string

  /** Follow the connections; returns the unsubscribe. */
  connect: () => () => void
  loadHosts: () => Promise<void>
  ssh: (target: string) => Promise<void>
  container: (projectId: string) => Promise<void>
  hasContainer: (projectId: string) => Promise<boolean>
  disconnect: (id: string) => Promise<void>
  clearError: () => void
}

/** Remote-SSH and Dev Containers from the desktop app: the connections and how to start one. */
export const useRemote = create<RemoteState>((set) => {
  const attempt = async (fn: () => Promise<unknown>) => {
    set({ error: undefined })
    try {
      await fn()
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  }
  return {
    connections: [],
    hosts: [],

    connect: () => {
      void ipc('remote:list').then((connections) => set({ connections }), () => {})
      return onEvent('remote:changed', (connections) => set({ connections }))
    },

    loadHosts: () => attempt(async () => set({ hosts: await ipc('remote:hosts') })),
    ssh: (target) => attempt(() => ipc('remote:ssh', { target })),
    container: (projectId) => attempt(() => ipc('remote:container', { projectId })),
    hasContainer: (projectId) => ipc('remote:hasContainer', { projectId }).catch(() => false),
    disconnect: (id) => attempt(() => ipc('remote:disconnect', { id })),
    clearError: () => set({ error: undefined })
  }
})

/** Connections still on their way or in use (not closed / failed). */
export const isActive = (c: RemoteConnection) => c.state !== 'closed' && c.state !== 'failed'
