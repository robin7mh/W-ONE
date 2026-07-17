import { create } from 'zustand'
import { ipc, onEvent, IpcError } from '@shared/ipc/client'
import type { ProjectContext, ContextProgress } from '@shared/types/context'

interface ContextEntry {
  context?: ProjectContext | null
  loading: boolean
  indexing: boolean
  progress?: ContextProgress
  error?: string
}

interface ContextState {
  byProject: Record<string, ContextEntry>
  load: (projectId: string) => Promise<void>
  reindex: (projectId: string) => Promise<void>
}

const message = (err: unknown) =>
  err instanceof IpcError ? err.message : err instanceof Error ? err.message : String(err)

export const useContextStore = create<ContextState>((set) => {
  const patch = (projectId: string, next: Partial<ContextEntry>) =>
    set((s) => ({
      byProject: { ...s.byProject, [projectId]: { ...s.byProject[projectId], ...next } }
    }))

  return {
    byProject: {},

    load: async (projectId) => {
      patch(projectId, { loading: true, error: undefined })
      try {
        const context = await ipc('context:get', { projectId })
        patch(projectId, { context, loading: false })
      } catch (err) {
        patch(projectId, { loading: false, error: message(err) })
      }
    },

    reindex: async (projectId) => {
      patch(projectId, { indexing: true, error: undefined, progress: undefined })
      const off = onEvent('context:progress', (p) => {
        if (p.projectId === projectId) patch(projectId, { progress: p })
      })
      try {
        const context = await ipc('context:reindex', { projectId })
        patch(projectId, { context, indexing: false, progress: undefined })
      } catch (err) {
        patch(projectId, { indexing: false, error: message(err) })
      } finally {
        off()
      }
    }
  }
})

/** Selector for one project's context entry (stable default). */
export function useProjectContextEntry(projectId: string): ContextEntry {
  return useContextStore((s) => s.byProject[projectId] ?? { loading: false, indexing: false })
}
