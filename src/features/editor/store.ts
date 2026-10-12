import { create } from 'zustand'
import { errorMessage, ipc, IpcError } from '@shared/ipc/client'
import type { FileEntry, FileStat } from '@shared/types/files'

export interface EditorTab {
  /** `projectId:path` — tabs of several projects can be open side by side. */
  id: string
  projectId: string
  /** Posix path relative to the project root. */
  path: string
  name: string
  loading: boolean
  /** Text as last read from / written to disk. Absent until loaded, or when not editable. */
  content?: string
  mtimeMs?: number
  unsupported?: 'binary' | 'too-large'
  /** Bumped whenever `content` was re-read from disk — the view swaps the buffer text. */
  revision: number
  dirty: boolean
  saving: boolean
  /** Changed on disk while there were unsaved edits — the user decides. */
  conflict: boolean
  /** Gone from disk; saving recreates it. */
  deleted: boolean
  error?: string
}

/**
 * The live text buffers, implemented by the Monaco view. Keeps Monaco (a few
 * MB, loaded on demand) out of the store, and keystrokes out of React state:
 * the store asks for the text only when it saves.
 */
export interface BufferHost {
  /** Current text plus its version (Monaco's alternative version id). */
  snapshot(id: string): { text: string; version: number } | undefined
  /** `version` is now what's on disk — the view derives `dirty` from it. */
  markClean(id: string, version: number): void
  /** The tab closed — free its buffer. */
  drop(id: string): void
  /** The file was renamed — carry the buffer (unsaved edits included) over to its new id. */
  rekey(id: string, next: { id: string; projectId: string; path: string }): void
}

let host: BufferHost | null = null
export function setBufferHost(next: BufferHost | null): void {
  host = next
}

export const tabKey = (projectId: string, path: string): string => `${projectId}:${path}`

const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`)

/** The explorer's inline name field: a new file or folder inside `dir`, or renaming `path`. */
export interface Naming {
  mode: 'file' | 'dir' | 'rename'
  dir: string
  path?: string
  error?: string
}

interface EditorState {
  projectId?: string
  /** Listed folders by `projectId:dir` ('' = the project root). */
  tree: Record<string, FileEntry[]>
  expanded: Record<string, boolean>
  treeError?: string
  tabs: EditorTab[]
  activeId?: string
  /** Dirty tab waiting for "save before closing?". */
  closing?: string
  /** A line to scroll to once its tab shows (search results); the view clears it. */
  reveal?: { id: string; line: number }
  /** The explorer's focused entry — new files land in it (a folder) or next to it (a file). */
  selection?: { path: string; kind: FileEntry['kind'] }
  naming?: Naming
  /** Entry waiting for "move to the trash?". */
  deleting?: string
  /** A file operation failed (create, rename, delete). */
  fileError?: string

  selectProject: (id: string) => Promise<void>
  loadDir: (dir: string) => Promise<void>
  toggleDir: (dir: string) => Promise<void>
  /** Re-list the root and every open folder of the current project. */
  refreshTree: () => Promise<void>
  open: (path: string) => Promise<void>
  /** Open a file and put the cursor on `line` (1-based). */
  openAt: (path: string, line: number) => Promise<void>
  setActive: (id: string) => void
  setDirty: (id: string, dirty: boolean) => void
  /** Write the buffer to disk. `force` overwrites a newer disk copy. Resolves true when saved. */
  save: (id?: string, opts?: { force?: boolean }) => Promise<boolean>
  /** Save every tab with unsaved edits. */
  saveAll: () => Promise<void>
  /** Re-read from disk. `ifClean`: if edits appeared meanwhile, flag a conflict instead. */
  reload: (id: string, opts?: { ifClean?: boolean }) => Promise<void>
  /** Close, or ask first when there are unsaved edits. */
  requestClose: (id: string) => void
  cancelClose: () => void
  saveAndClose: (id: string) => Promise<void>
  close: (id: string) => void
  /** Follow the disk: reload clean tabs that changed, flag dirty ones, mark deleted files. */
  checkDisk: () => Promise<void>

  select: (path: string, kind: FileEntry['kind']) => void
  /** Ask for a name: a new file / folder in the selected folder, or a new name for the selection. */
  startNaming: (mode: Naming['mode'], target?: { path: string; kind: FileEntry['kind'] }) => Promise<void>
  cancelNaming: () => void
  /** Create or rename with `name`; a bad name keeps the field open with the error. */
  submitName: (name: string) => Promise<void>
  requestDelete: (path?: string) => void
  cancelDelete: () => void
  confirmDelete: () => Promise<void>
  collapseAll: () => void
  clearFileError: () => void
}

const update =
  (id: string, changes: Partial<EditorTab> | ((t: EditorTab) => Partial<EditorTab>)) =>
  (s: EditorState) => ({
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...(typeof changes === 'function' ? changes(t) : changes) } : t))
  })

/**
 * The editor: a lazily listed file tree per project, and open files as tabs.
 * Files on disk stay the source of truth — saves refuse to overwrite a copy
 * someone else changed, and `checkDisk` keeps open tabs in step with edits
 * made elsewhere (agents, git, another editor).
 */
export const useEditor = create<EditorState>((set, get) => ({
  tree: {},
  expanded: {},
  tabs: [],

  selectProject: async (id) => {
    if (get().projectId === id) return
    set({ projectId: id, treeError: undefined })
    await get().loadDir('')
  },

  loadDir: async (dir) => {
    const projectId = get().projectId!
    const key = tabKey(projectId, dir)
    try {
      const entries = await ipc('files:list', { projectId, dir })
      set((s) => ({ tree: { ...s.tree, [key]: entries }, treeError: dir ? s.treeError : undefined }))
    } catch (err) {
      if (!dir) return set({ treeError: errorMessage(err) })
      // A sub-folder that can't be listed (deleted, renamed) just folds away.
      set((s) => {
        const { [key]: _gone, ...tree } = s.tree
        const { [key]: _open, ...expanded } = s.expanded
        return { tree, expanded }
      })
    }
  },

  toggleDir: async (dir) => {
    const key = tabKey(get().projectId!, dir)
    if (get().expanded[key]) {
      set((s) => {
        const { [key]: _closed, ...expanded } = s.expanded
        return { expanded }
      })
      return
    }
    set((s) => ({ expanded: { ...s.expanded, [key]: true } }))
    await get().loadDir(dir)
  },

  refreshTree: async () => {
    const prefix = `${get().projectId!}:`
    const open = Object.keys(get().expanded)
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length))
    await Promise.all(['', ...open].map((dir) => get().loadDir(dir)))
  },

  open: async (path) => {
    const projectId = get().projectId!
    const id = tabKey(projectId, path)
    if (get().tabs.some((t) => t.id === id)) return set({ activeId: id })
    const tab: EditorTab = {
      id,
      projectId,
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      loading: true,
      revision: 0,
      dirty: false,
      saving: false,
      conflict: false,
      deleted: false
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeId: id }))
    await get().reload(id)
  },

  openAt: async (path, line) => {
    await get().open(path)
    set({ reveal: { id: tabKey(get().projectId!, path), line } })
  },

  setActive: (id) => set({ activeId: id }),

  setDirty: (id, dirty) => {
    if (get().tabs.find((t) => t.id === id)?.dirty === dirty) return
    set(update(id, { dirty }))
  },

  save: async (id = get().activeId, opts = {}) => {
    const tab = get().tabs.find((t) => t.id === id)
    const buffers = host
    const snap = tab && tab.content !== undefined && !tab.saving ? buffers?.snapshot(tab.id) : undefined
    if (!tab || !snap) return false
    if (!tab.dirty && !tab.deleted) return true
    set(update(tab.id, { saving: true }))
    try {
      const saved: FileStat = await ipc('files:write', {
        projectId: tab.projectId,
        path: tab.path,
        content: snap.text,
        expectedMtime: opts.force || tab.deleted ? undefined : tab.mtimeMs
      })
      set(update(tab.id, { saving: false, content: snap.text, mtimeMs: saved.mtimeMs, conflict: false, deleted: false, error: undefined }))
      buffers!.markClean(tab.id, snap.version)
      return true
    } catch (err) {
      const conflict = err instanceof IpcError && err.code === 'conflict'
      set(update(tab.id, (t) => ({ saving: false, conflict: conflict || t.conflict, error: conflict ? undefined : errorMessage(err) })))
      return false
    }
  },

  saveAll: async () => {
    await Promise.all(get().tabs.filter((t) => t.dirty).map((t) => get().save(t.id)))
  },

  reload: async (id, opts = {}) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    try {
      const file = await ipc('files:read', { projectId: tab.projectId, path: tab.path })
      if (opts.ifClean && get().tabs.find((t) => t.id === id)?.dirty) return set(update(id, { conflict: true }))
      set(
        update(id, (t) => ({
          loading: false,
          content: file.content,
          mtimeMs: file.mtimeMs,
          unsupported: file.unsupported,
          revision: t.revision + 1,
          dirty: false,
          conflict: false,
          deleted: false,
          error: undefined
        }))
      )
    } catch (err) {
      set(update(id, { loading: false, error: errorMessage(err) }))
    }
  },

  requestClose: (id) => {
    if (get().tabs.find((t) => t.id === id)?.dirty) return set({ closing: id })
    get().close(id)
  },

  cancelClose: () => set({ closing: undefined }),

  saveAndClose: async (id) => {
    if (await get().save(id)) get().close(id)
  },

  close: (id) => {
    const { tabs, activeId } = get()
    const index = tabs.findIndex((t) => t.id === id)
    if (index < 0) return
    const rest = tabs.filter((t) => t.id !== id)
    host?.drop(id)
    set({
      tabs: rest,
      closing: undefined,
      // The neighbour takes over (right, else left) — like VS Code.
      activeId: activeId === id ? rest[Math.min(index, rest.length - 1)]?.id : activeId
    })
  },

  checkDisk: async () => {
    const byProject = new Map<string, EditorTab[]>()
    for (const t of get().tabs) {
      if (t.content === undefined || t.saving) continue
      byProject.set(t.projectId, [...(byProject.get(t.projectId) ?? []), t])
    }
    await Promise.all(
      [...byProject].map(async ([projectId, list]) => {
        const stats = await ipc('files:stat', { projectId, paths: list.map((t) => t.path) }).catch(() => null)
        if (!stats) return
        await Promise.all(
          list.map(async ({ id }, i) => {
            const t = get().tabs.find((x) => x.id === id)
            const disk = stats[i]
            if (!t || t.saving) return
            if (!disk) {
              if (!t.deleted) set(update(id, { deleted: true }))
            } else if (disk.mtimeMs === t.mtimeMs) {
              if (t.deleted) set(update(id, { deleted: false }))
            } else if (t.dirty) {
              if (!t.conflict) set(update(id, { conflict: true, deleted: false }))
            } else {
              await get().reload(id, { ifClean: true })
            }
          })
        )
      })
    )
  },

  select: (path, kind) => set({ selection: { path, kind } }),

  startNaming: async (mode, target = get().selection) => {
    if (mode === 'rename') {
      if (!target) return
      return set({ selection: target, naming: { mode, dir: parentOf(target.path), path: target.path } })
    }
    const dir = !target ? '' : target.kind === 'dir' ? target.path : parentOf(target.path)
    if (dir && !get().expanded[tabKey(get().projectId!, dir)]) await get().toggleDir(dir)
    set({ naming: { mode, dir } })
  },

  cancelNaming: () => set({ naming: undefined }),

  submitName: async (raw) => {
    const naming = get().naming
    const name = raw.trim().replace(/^\/+|\/+$/g, '')
    if (!naming) return
    if (!name || name.split('/').some((part) => part === '..' || part === '.' || !part)) return set({ naming: { ...naming, error: 'invalid-name' } })
    const projectId = get().projectId!
    const path = naming.dir ? `${naming.dir}/${name}` : name
    if (naming.mode === 'rename' && path === naming.path) return set({ naming: undefined })
    try {
      if (naming.mode === 'rename') await ipc('files:rename', { projectId, from: naming.path!, to: path })
      else await ipc('files:create', { projectId, path, kind: naming.mode })
    } catch (err) {
      return set({ naming: { ...naming, error: errorMessage(err) } })
    }
    const kind = naming.mode === 'rename' ? get().selection!.kind : naming.mode
    set({ naming: undefined, selection: { path, kind } })
    if (naming.mode === 'rename') moveTabs(naming.path!, path)
    await get().refreshTree()
    if (naming.mode === 'file') await get().open(path)
  },

  requestDelete: (path = get().selection?.path) => set({ deleting: path }),
  cancelDelete: () => set({ deleting: undefined }),

  confirmDelete: async () => {
    const path = get().deleting
    const projectId = get().projectId!
    if (!path) return
    set({ deleting: undefined })
    try {
      await ipc('files:delete', { projectId, path })
    } catch (err) {
      return set({ fileError: errorMessage(err) })
    }
    // Clean tabs of what's gone close; unsaved ones stay (marked deleted — saving brings them back).
    for (const t of get().tabs) if (t.projectId === projectId && under(t.path, path) && !t.dirty) get().close(t.id)
    if (get().selection && under(get().selection!.path, path)) set({ selection: undefined })
    await get().refreshTree()
  },

  collapseAll: () => {
    const prefix = `${get().projectId!}:`
    set((s) => ({ expanded: Object.fromEntries(Object.entries(s.expanded).filter(([k]) => !k.startsWith(prefix))) }))
  },

  clearFileError: () => set({ fileError: undefined })
}))

/** Tabs follow a renamed file or folder — their buffers (unsaved edits too) move along. */
function moveTabs(from: string, to: string): void {
  const { projectId, tabs } = useEditor.getState()
  for (const t of tabs) {
    if (t.projectId !== projectId || !under(t.path, from)) continue
    const path = to + t.path.slice(from.length)
    const id = tabKey(t.projectId, path)
    host?.rekey(t.id, { id, projectId: t.projectId, path })
    useEditor.setState((s) => ({
      tabs: s.tabs.map((x) => (x.id === t.id ? { ...x, id, path, name: path.slice(path.lastIndexOf('/') + 1) } : x)),
      activeId: s.activeId === t.id ? id : s.activeId
    }))
  }
}
