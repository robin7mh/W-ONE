import { create } from 'zustand'
import { errorMessage, ipc, isDesktop } from '@shared/ipc/client'
import type { FinderEntry, FinderListing, FinderPlaces, FinderPreview } from '@shared/types/finder'
import { entryKind } from './kinds'

export type SortKey = 'name' | 'modified' | 'size' | 'kind'

export type Notice = { key: 'copied' } | { key: 'trashed'; count: number }

interface Prefs {
  view: 'list' | 'grid'
  sort: { key: SortKey; desc: boolean }
  hidden: boolean
  showPreview: boolean
  /** Where the module was last. */
  path?: string
}

const KEY = 'mindeck.files'
const DEFAULTS: Prefs = { view: 'list', sort: { key: 'name', desc: false }, hidden: false, showPreview: true }

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    return {
      view: saved.view === 'grid' ? 'grid' : 'list',
      sort: saved.sort && ['name', 'modified', 'size', 'kind'].includes(saved.sort.key) ? { key: saved.sort.key, desc: !!saved.sort.desc } : DEFAULTS.sort,
      hidden: saved.hidden === true,
      showPreview: saved.showPreview !== false,
      ...(typeof saved.path === 'string' ? { path: saved.path } : {})
    }
  } catch {
    return DEFAULTS
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // storage unavailable — the choices last until reload
  }
}

/** Folders first, then by the chosen column (names compare like Finder: "file 2" before "file 10"). */
export function sortEntries(entries: FinderEntry[], sort: Prefs['sort']): FinderEntry[] {
  const byName = (a: FinderEntry, b: FinderEntry) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  const by: Record<SortKey, (a: FinderEntry, b: FinderEntry) => number> = {
    name: byName,
    modified: (a, b) => a.mtimeMs - b.mtimeMs || byName(a, b),
    size: (a, b) => a.size - b.size || byName(a, b),
    kind: (a, b) => entryKind(a).localeCompare(entryKind(b)) || byName(a, b)
  }
  const dir = sort.desc ? -1 : 1
  return [...entries].sort((a, b) => {
    const folderA = a.kind === 'dir' && !a.bundle
    const folderB = b.kind === 'dir' && !b.bundle
    if (folderA !== folderB) return folderA ? -1 : 1
    return by[sort.key](a, b) * dir
  })
}

interface FilesState extends Prefs {
  places?: FinderPlaces
  listing?: FinderListing
  loading: boolean
  error?: string
  /** A short message for the status line: a path was copied, entries went to the Trash. */
  notice?: Notice
  back: string[]
  forward: string[]
  selected: string[]
  /** The last single pick — where a shift-click range starts. */
  anchor?: string
  preview?: FinderPreview
  query: string
  /** Search hits; undefined while not searching. */
  results?: FinderEntry[]
  searching: boolean
  /** The entry whose name is being edited. */
  renaming?: string
  /** A new folder's name is being typed. */
  creating: boolean

  init(): Promise<void>
  /** Show a folder (remembered for Back). */
  open(path: string, opts?: { history?: boolean }): Promise<void>
  goBack(): Promise<void>
  goForward(): Promise<void>
  goUp(): Promise<void>
  reload(): Promise<void>
  select(path: string, mode?: 'single' | 'toggle' | 'range'): void
  selectAll(): void
  clearSelection(): void
  setView(view: Prefs['view']): void
  setSort(key: SortKey): void
  toggleHidden(): Promise<void>
  togglePreview(): void
  search(query: string): Promise<void>
  clearSearch(): void
  startCreate(): void
  cancelCreate(): void
  mkdir(name: string): Promise<void>
  startRename(path: string): void
  cancelRename(): void
  rename(path: string, name: string): Promise<void>
  trash(paths?: string[]): Promise<void>
  /** Move (or copy) entries into a folder. */
  move(paths: string[], dest: string, copy?: boolean): Promise<void>
  openWithApp(path: string): Promise<void>
  reveal(path: string): Promise<void>
  loadPreview(path: string): Promise<void>
  setNotice(notice?: Notice): void
  clearError(): void
}

/** The entries on screen: search hits or the folder, sorted. */
export function visibleEntries(s: Pick<FilesState, 'results' | 'listing' | 'sort'>): FinderEntry[] {
  return sortEntries(s.results ?? s.listing?.entries ?? [], s.sort)
}

export const useFiles = create<FilesState>((set, get) => {
  const prefs = () => {
    const { view, sort, hidden, showPreview, listing } = get()
    savePrefs({ view, sort, hidden, showPreview, ...(listing ? { path: listing.path } : {}) })
  }
  const fail = (err: unknown) => set({ error: errorMessage(err), loading: false, searching: false })
  let searchSeq = 0

  return {
    ...loadPrefs(),
    loading: false,
    back: [],
    forward: [],
    selected: [],
    query: '',
    searching: false,
    creating: false,

    init: async () => {
      if (!isDesktop() || get().places) return
      try {
        const places = await ipc('finder:places')
        set({ places })
        const start = get().path ?? places.home
        await get().open(start, { history: false })
        // The remembered folder is gone: start at Home.
        if (!get().listing && start !== places.home) {
          set({ error: undefined })
          await get().open(places.home, { history: false })
        }
      } catch (err) {
        fail(err)
      }
    },

    open: async (path, opts = {}) => {
      const current = get().listing?.path
      set({ loading: true, error: undefined })
      try {
        const listing = await ipc('finder:list', { path, hidden: get().hidden })
        set((s) => ({
          listing,
          loading: false,
          selected: [],
          anchor: undefined,
          preview: undefined,
          results: undefined,
          query: '',
          renaming: undefined,
          creating: false,
          ...(opts.history !== false && current && current !== listing.path ? { back: [...s.back, current].slice(-50), forward: [] } : {})
        }))
        prefs()
      } catch (err) {
        fail(err)
      }
    },

    // Back and Forward only fill while a folder is shown, so there is always one to come back to.
    goBack: async () => {
      const { back, forward, listing } = get()
      const target = back[back.length - 1]
      if (!target) return
      set({ back: back.slice(0, -1), forward: [listing!.path, ...forward] })
      await get().open(target, { history: false })
    },

    goForward: async () => {
      const { forward, back, listing } = get()
      const target = forward[0]
      if (!target) return
      set({ forward: forward.slice(1), back: [...back, listing!.path] })
      await get().open(target, { history: false })
    },

    goUp: async () => {
      const parent = get().listing?.parent
      if (parent) await get().open(parent)
    },

    reload: async () => {
      const listing = get().listing
      if (!listing) return
      const selected = get().selected
      await get().open(listing.path, { history: false })
      const still = new Set(get().listing!.entries.map((e) => e.path))
      set({ selected: selected.filter((p) => still.has(p)) })
    },

    select: (path, mode = 'single') => {
      const s = get()
      if (mode === 'toggle') {
        const selected = s.selected.includes(path) ? s.selected.filter((p) => p !== path) : [...s.selected, path]
        set({ selected, anchor: path })
      } else if (mode === 'range' && s.anchor) {
        const order = visibleEntries(s).map((e) => e.path)
        const [a, b] = [order.indexOf(s.anchor), order.indexOf(path)].sort((x, y) => x - y)
        set({ selected: a < 0 ? [path] : order.slice(a, b + 1) })
      } else {
        set({ selected: [path], anchor: path })
      }
      const picked = get().selected
      if (picked.length === 1 && get().showPreview) void get().loadPreview(picked[0])
      else set({ preview: undefined })
    },

    selectAll: () => set((s) => ({ selected: visibleEntries(s).map((e) => e.path), preview: undefined })),
    clearSelection: () => set({ selected: [], anchor: undefined, preview: undefined }),

    setView: (view) => {
      set({ view })
      prefs()
    },

    setSort: (key) => {
      set((s) => ({ sort: { key, desc: s.sort.key === key ? !s.sort.desc : key === 'modified' || key === 'size' } }))
      prefs()
    },

    toggleHidden: async () => {
      set((s) => ({ hidden: !s.hidden }))
      prefs()
      await get().reload()
    },

    togglePreview: () => {
      set((s) => ({ showPreview: !s.showPreview }))
      prefs()
      const { showPreview, selected } = get()
      if (showPreview && selected.length === 1) void get().loadPreview(selected[0])
    },

    search: async (query) => {
      const listing = get().listing
      const q = query.trim()
      set({ query })
      if (!q || !listing) return get().clearSearch()
      const mine = ++searchSeq
      set({ searching: true, error: undefined })
      try {
        const results = await ipc('finder:search', { path: listing.path, query: q })
        if (mine === searchSeq) set({ results, searching: false, selected: [], preview: undefined })
      } catch (err) {
        if (mine === searchSeq) fail(err)
      }
    },

    clearSearch: () => {
      searchSeq += 1
      set({ query: '', results: undefined, searching: false })
    },

    startCreate: () => set({ creating: true, renaming: undefined }),
    cancelCreate: () => set({ creating: false }),

    mkdir: async (name) => {
      const listing = get().listing
      set({ creating: false })
      if (!listing || !name.trim()) return
      try {
        const path = await ipc('finder:mkdir', { parent: listing.path, name })
        await get().reload()
        get().select(path)
      } catch (err) {
        fail(err)
      }
    },

    startRename: (path) => set({ renaming: path, creating: false }),
    cancelRename: () => set({ renaming: undefined }),

    rename: async (path, name) => {
      set({ renaming: undefined })
      const entry = get().listing?.entries.find((e) => e.path === path) ?? get().results?.find((e) => e.path === path)
      if (!name.trim() || name === entry?.name) return
      try {
        const next = await ipc('finder:rename', { path, name })
        if (get().results) await get().search(get().query)
        else await get().reload()
        get().select(next)
      } catch (err) {
        fail(err)
      }
    },

    trash: async (paths = get().selected) => {
      if (!paths.length) return
      try {
        await ipc('finder:trash', { paths })
        set({ notice: { key: 'trashed', count: paths.length } })
        if (get().results) await get().search(get().query)
        else await get().reload()
        set({ selected: [], preview: undefined })
      } catch (err) {
        fail(err)
      }
    },

    move: async (paths, dest, copy = false) => {
      if (!paths.length) return
      try {
        await ipc(copy ? 'finder:copy' : 'finder:move', { paths, dest })
        await get().reload()
      } catch (err) {
        fail(err)
      }
    },

    openWithApp: async (path) => {
      try {
        await ipc('finder:open', { path })
      } catch (err) {
        fail(err)
      }
    },

    reveal: async (path) => {
      try {
        await ipc('finder:reveal', { path })
      } catch (err) {
        fail(err)
      }
    },

    loadPreview: async (path) => {
      try {
        const preview = await ipc('finder:preview', { path })
        // Only if it is still what is selected.
        if (get().selected.length === 1 && get().selected[0] === path) set({ preview })
      } catch {
        set({ preview: undefined })
      }
    },

    setNotice: (notice) => set({ notice }),
    clearError: () => set({ error: undefined })
  }
})
