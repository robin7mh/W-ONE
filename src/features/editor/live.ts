import { create } from 'zustand'
import { errorMessage, ipc, onEvent } from '@shared/ipc/client'
import type { LiveServerStatus, SassResult } from '@shared/types/live'
import { onSaved, useEditor } from './store'
import { useProblems } from './problems'

const KEY = 'mindeck.sassWatch'

function loadWatching(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

export const isSassFile = (path: string): boolean => /\.s[ac]ss$/i.test(path)

interface LiveState {
  servers: LiveServerStatus[]
  /** Projects whose Sass files compile on save. */
  sassWatching: Record<string, boolean>
  /** The last compile: what it wrote. */
  sass?: { projectId: string; written: string[] }
  error?: string
  connect: () => () => void
  /** Serve the editor's project and open `page` (default: its start page). */
  start: (page?: string) => Promise<void>
  stop: () => Promise<void>
  /** Watch / stop watching the project's Sass (watching starts with a full compile). */
  toggleSass: () => Promise<void>
  clearError: () => void
}

/** Compile results go to the problems list (errors per Sass file; cleared when it compiles). */
function report(projectId: string, result: SassResult): void {
  useProblems.getState().report(projectId, result.errors)
  useLive.setState({ sass: { projectId, written: result.written } })
}

/** Live Server and Live Sass Compiler for the editor's project. */
export const useLive = create<LiveState>((set, get) => ({
  servers: [],
  sassWatching: loadWatching(),

  connect: () => {
    void ipc('liveServer:status').then(
      (servers) => set({ servers: servers ?? [] }),
      () => {}
    )
    const off = onEvent('liveServer:changed', (servers) => set({ servers }))
    const offSaved = onSaved(({ projectId, path }) => {
      if (!get().sassWatching[projectId] || !isSassFile(path)) return
      void ipc('sass:compile', { projectId, path }).then(
        (result) => report(projectId, result),
        (err: unknown) => set({ error: errorMessage(err) })
      )
    })
    return () => {
      off()
      offSaved()
    }
  },

  start: async (page) => {
    const projectId = useEditor.getState().projectId
    if (!projectId) return
    try {
      const status = await ipc('liveServer:start', { projectId, page })
      set((s) => ({ servers: [...s.servers.filter((x) => x.projectId !== projectId), status], error: undefined }))
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  },

  stop: async () => {
    const projectId = useEditor.getState().projectId
    if (!projectId) return
    await ipc('liveServer:stop', { projectId }).catch(() => {})
    set((s) => ({ servers: s.servers.filter((x) => x.projectId !== projectId) }))
  },

  toggleSass: async () => {
    const projectId = useEditor.getState().projectId
    if (!projectId) return
    const on = !get().sassWatching[projectId]
    const sassWatching = { ...get().sassWatching, [projectId]: on }
    set({ sassWatching })
    try {
      localStorage.setItem(KEY, JSON.stringify(sassWatching))
    } catch {
      /* kept for this run */
    }
    if (!on) return
    try {
      report(projectId, await ipc('sass:compileAll', { projectId }))
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  },

  clearError: () => set({ error: undefined })
}))
