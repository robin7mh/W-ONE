import { create } from 'zustand'
import { errorMessage, ipc } from '@shared/ipc/client'
import type { Project } from '@shared/types/project'

interface ProjectsState {
  projects: Project[]
  selectedId?: string
  loading: boolean
  busyId?: string // project currently being refreshed/opened/removed
  error?: string

  load: () => Promise<void>
  addViaPicker: () => Promise<void>
  /** Add a folder by absolute path (the web UI's folder browser). */
  addPath: (path: string) => Promise<void>
  remove: (id: string) => Promise<void>
  refresh: (id: string) => Promise<void>
  openEditor: (id: string) => Promise<void>
  openTerminal: (id: string) => Promise<void>
  select: (id: string) => void
}


export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  loading: false,

  load: async () => {
    set({ loading: true, error: undefined })
    try {
      const projects = await ipc('projects:list')
      set((s) => ({
        projects,
        loading: false,
        selectedId: s.selectedId ?? projects[0]?.id
      }))
    } catch (err) {
      set({ loading: false, error: errorMessage(err) })
    }
  },

  addViaPicker: async () => {
    set({ error: undefined })
    try {
      const picked = await ipc('projects:pickFolder')
      if (!picked) return
      await get().addPath(picked.path)
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  },

  addPath: async (path) => {
    set({ error: undefined })
    try {
      const project = await ipc('projects:add', { path })
      set((s) => {
        const others = s.projects.filter((p) => p.id !== project.id)
        return { projects: [...others, project], selectedId: project.id }
      })
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  },

  remove: async (id) => {
    set({ busyId: id, error: undefined })
    try {
      await ipc('projects:remove', { id })
      set((s) => {
        const projects = s.projects.filter((p) => p.id !== id)
        return {
          projects,
          busyId: undefined,
          selectedId: s.selectedId === id ? projects[0]?.id : s.selectedId
        }
      })
    } catch (err) {
      set({ busyId: undefined, error: errorMessage(err) })
    }
  },

  refresh: async (id) => {
    set({ busyId: id, error: undefined })
    try {
      const updated = await ipc('projects:refresh', { id })
      set((s) => ({
        projects: s.projects.map((p) => (p.id === id ? updated : p)),
        busyId: undefined
      }))
    } catch (err) {
      set({ busyId: undefined, error: errorMessage(err) })
    }
  },

  openEditor: async (id) => {
    set({ error: undefined })
    try {
      await ipc('projects:openInEditor', { id })
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  },

  openTerminal: async (id) => {
    set({ error: undefined })
    try {
      await ipc('projects:openTerminal', { id })
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  },

  select: (id) => set({ selectedId: id })
}))

/** Reactive selector for the currently selected project. */
export function useSelectedProject(): Project | undefined {
  return useProjects((s) => s.projects.find((p) => p.id === s.selectedId))
}
