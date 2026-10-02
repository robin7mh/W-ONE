import { create } from 'zustand'
import { errorMessage, ipc } from '@shared/ipc/client'
import type { TerminalInfo } from '@shared/types/terminal'

export interface TerminalTab extends TerminalInfo {
  /** Exit code once the shell has ended (the tab stays until closed/restarted). */
  exitCode?: number
}

/** single = tabs, one visible · cols = side by side · rows = stacked · grid = 2×2 */
export type TerminalLayout = 'single' | 'cols' | 'rows' | 'grid'

export const LAYOUT_SLOTS: Record<TerminalLayout, number> = { single: 1, cols: 2, rows: 2, grid: 4 }

interface TerminalState {
  /** Order matters: in split layouts the first N tabs fill the N panes. */
  tabs: TerminalTab[]
  activeId?: string
  layout: TerminalLayout
  error?: string
  initialized: boolean

  /** Re-attach to sessions that survived a renderer reload, else open one. */
  init: () => Promise<void>
  open: (projectId?: string) => Promise<void>
  close: (id: string) => Promise<void>
  /** Replace an exited tab with a fresh shell in the same place. */
  restart: (id: string) => Promise<void>
  /** Focus a tab; a tab outside the visible panes takes the active pane's slot. */
  setActive: (id: string) => void
  /** Switch layout. Never opens shells — the user fills empty panes. */
  setLayout: (layout: TerminalLayout) => void
  markExited: (id: string, exitCode: number) => void
}

/**
 * Display labels: same-named tabs get a number (`~`, `~ 2`, `~ 3`), assigned
 * by creation time so a tab keeps its name when panes are re-arranged.
 */
export function tabLabels(tabs: TerminalTab[]): Map<string, string> {
  const seen = new Map<string, number>()
  const byAge = [...tabs].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return new Map(
    byAge.map((t) => {
      const n = (seen.get(t.title) ?? 0) + 1
      seen.set(t.title, n)
      return [t.id, n === 1 ? t.title : `${t.title} ${n}`]
    })
  )
}


/**
 * Split layouts show the first N tabs: move tab `id` into the active tab's
 * pane (swap) so it becomes visible. Single layout shows whichever tab is
 * active, so the tab strip keeps its order there.
 */
function swapIntoView(tabs: TerminalTab[], id: string, activeId: string | undefined, layout: TerminalLayout): TerminalTab[] {
  const slots = LAYOUT_SLOTS[layout]
  const from = tabs.findIndex((t) => t.id === id)
  if (layout === 'single' || from < slots) return tabs
  const activeIndex = tabs.findIndex((t) => t.id === activeId)
  const to = activeIndex >= 0 && activeIndex < slots ? activeIndex : 0
  const next = [...tabs]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

export const useTerminals = create<TerminalState>((set, get) => ({
  tabs: [],
  layout: 'single',
  initialized: false,

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })
    try {
      const existing = await ipc('terminal:list')
      if (existing.length) set({ tabs: existing, activeId: existing[0].id })
      else await get().open()
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  },

  open: async (projectId) => {
    try {
      const info = await ipc('terminal:create', { projectId })
      set((s) => {
        const tabs = swapIntoView([...s.tabs, info], info.id, s.activeId, s.layout)
        return { tabs, activeId: info.id, error: undefined }
      })
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  },

  close: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (tab && tab.exitCode === undefined) await ipc('terminal:kill', { id }).catch(() => {})
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeId = s.activeId === id ? (tabs[i] ?? tabs[i - 1])?.id : s.activeId
      return { tabs, activeId }
    })
  },

  restart: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    try {
      const info = await ipc('terminal:create', { projectId: tab.projectId })
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? info : t)),
        activeId: s.activeId === id ? info.id : s.activeId,
        error: undefined
      }))
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  },

  setActive: (id) =>
    set((s) => ({ tabs: swapIntoView(s.tabs, id, s.activeId, s.layout), activeId: id })),

  // Only re-arranges; empty panes show a "New terminal" placeholder instead.
  setLayout: (layout) => set({ layout }),

  markExited: (id, exitCode) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, exitCode } : t)) }))
}))
