import { create } from 'zustand'
import { ipc, IpcError } from '@shared/ipc/client'
import type {
  GraphStyle,
  MemoryChanged,
  MemoryGraph,
  Note,
  NoteMeta,
  SearchHit,
  VaultStatus
} from '@shared/types/memory'

const AUTOSAVE_MS = 700

interface MemoryState {
  status?: VaultStatus
  notes: NoteMeta[]
  graph?: MemoryGraph
  view: 'note' | 'graph'
  mode: 'edit' | 'preview'

  /** Open note as last loaded from disk. */
  note?: Note
  /** Editor text; differs from note.raw while unsaved. */
  draft: string
  saving: boolean

  query: string
  hits: SearchHit[]

  loading: boolean
  error?: string

  init: () => Promise<void>
  onChanged: (change: MemoryChanged) => Promise<void>
  createVault: () => Promise<void>
  pickVault: () => Promise<void>
  open: (path: string, mode?: 'edit' | 'preview') => Promise<void>
  /** Follow a link by title: open the note, or create it (Obsidian behavior). */
  openOrCreate: (title: string) => Promise<void>
  setDraft: (raw: string) => void
  save: () => Promise<void>
  createNote: (title?: string, folder?: string) => Promise<void>
  trash: (path: string) => Promise<void>
  setView: (view: 'note' | 'graph') => void
  setMode: (mode: 'edit' | 'preview') => void
  search: (query: string) => Promise<void>
  setGraphStyle: (style: GraphStyle) => Promise<void>
}

function message(err: unknown): string {
  return err instanceof IpcError ? err.message : err instanceof Error ? err.message : String(err)
}

let saveTimer: number | undefined
let searchSeq = 0

export const useMemory = create<MemoryState>((set, get) => {
  const reloadIndex = async () => {
    const [status, notes, graph] = await Promise.all([ipc('memory:status'), ipc('memory:list'), ipc('memory:graph')])
    set({ status, notes, graph })
    return { status, notes }
  }

  const fail = (err: unknown) => set({ error: message(err), loading: false, saving: false })

  return {
    notes: [],
    view: 'graph',
    mode: 'preview',
    draft: '',
    saving: false,
    query: '',
    hits: [],
    loading: false,

    init: async () => {
      set({ loading: true, error: undefined })
      try {
        const { notes } = await reloadIndex()
        set({ loading: false })
        const { note } = get()
        if (!note && notes.length) {
          const first = notes.find((n) => /^willkommen\.md$/i.test(n.path)) ?? notes[0]
          await get().open(first.path)
          set({ view: 'graph' })
        }
      } catch (err) {
        fail(err)
      }
    },

    onChanged: async (change) => {
      try {
        await reloadIndex()
        const { note, draft, query } = get()
        if (query) void get().search(query)
        if (!note) return
        if (change.paths && !change.paths.includes(note.path)) {
          // Backlinks of the open note may still have changed — refresh quietly.
          const fresh = await ipc('memory:read', { path: note.path }).catch(() => undefined)
          if (fresh) set({ note: { ...fresh, raw: note.raw } })
          return
        }
        const dirty = draft !== note.raw
        const fresh = await ipc('memory:read', { path: note.path }).catch(() => undefined)
        if (!fresh) {
          set({ note: undefined, draft: '' }) // deleted or moved outside W-ONE
        } else if (!dirty) {
          set({ note: fresh, draft: fresh.raw }) // external edit — follow the file
        } else {
          set({ note: { ...fresh, raw: note.raw } }) // keep the user's unsaved text
        }
      } catch (err) {
        fail(err)
      }
    },

    createVault: async () => {
      set({ loading: true, error: undefined })
      try {
        await ipc('memory:createVault')
        set({ note: undefined, draft: '' })
        await get().init()
      } catch (err) {
        fail(err)
      }
    },

    pickVault: async () => {
      try {
        await get().save()
        const status = await ipc('memory:pickVault')
        if (!status) return
        set({ note: undefined, draft: '', query: '', hits: [] })
        await get().init()
      } catch (err) {
        fail(err)
      }
    },

    open: async (path, mode) => {
      try {
        await get().save()
        const note = await ipc('memory:read', { path })
        set({ note, draft: note.raw, view: 'note', mode: mode ?? get().mode, error: undefined })
      } catch (err) {
        fail(err)
      }
    },

    openOrCreate: async (title) => {
      const key = title.replace(/\.md$/i, '').toLowerCase()
      const match = get()
        .notes.filter((n) => n.title.toLowerCase() === key || n.path.replace(/\.md$/i, '').toLowerCase() === key)
        .sort((a, b) => a.path.length - b.path.length)[0]
      if (match) return get().open(match.path)
      const slash = title.lastIndexOf('/')
      return get().createNote(title.slice(slash + 1), slash > 0 ? title.slice(0, slash) : '')
    },

    setDraft: (raw) => {
      set({ draft: raw })
      window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => void get().save(), AUTOSAVE_MS)
    },

    save: async () => {
      window.clearTimeout(saveTimer)
      const { note, draft } = get()
      if (!note || draft === note.raw) return
      set({ saving: true })
      try {
        await ipc('memory:write', { path: note.path, raw: draft })
        const fresh = await ipc('memory:read', { path: note.path })
        // Keep typing that happened while the write was in flight.
        set((s) => ({ note: fresh, draft: s.draft === draft ? fresh.raw : s.draft, saving: false }))
      } catch (err) {
        fail(err)
      }
    },

    createNote: async (title = 'Untitled', folder = '') => {
      try {
        await get().save()
        const meta = await ipc('memory:create', { title, folder })
        await reloadIndex()
        await get().open(meta.path, 'edit')
      } catch (err) {
        fail(err)
      }
    },

    trash: async (path) => {
      try {
        window.clearTimeout(saveTimer)
        await ipc('memory:trash', { path })
        if (get().note?.path === path) set({ note: undefined, draft: '', view: 'graph' })
        await reloadIndex()
      } catch (err) {
        fail(err)
      }
    },

    setView: (view) => {
      if (view === 'graph') void get().save()
      set({ view })
    },

    setMode: (mode) => {
      if (mode === 'preview') void get().save()
      set({ mode })
    },

    search: async (query) => {
      const seq = ++searchSeq
      set({ query })
      if (!query.trim()) return set({ hits: [] })
      try {
        const hits = await ipc('memory:search', { query })
        if (seq === searchSeq) set({ hits })
      } catch (err) {
        fail(err)
      }
    },

    setGraphStyle: async (style) => {
      const prev = get().status
      if (prev) set({ status: { ...prev, graphStyle: style } }) // optimistic
      try {
        const saved = await ipc('memory:setGraphStyle', style)
        const cur = get().status
        if (cur) set({ status: { ...cur, graphStyle: saved } })
      } catch (err) {
        if (prev) set({ status: prev })
        fail(err)
      }
    }
  }
})

/** Stable folder → palette slot, shared by the graph and the note list. */
export function folderColors(notes: { folder: string }[]): Map<string, number> {
  const folders = [...new Set(notes.map((n) => n.folder))].sort((a, b) => a.localeCompare(b))
  return new Map(folders.map((f, i) => [f, i]))
}
