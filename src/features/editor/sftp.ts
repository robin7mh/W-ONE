import { create } from 'zustand'
import { errorMessage, ipc, onEvent } from '@shared/ipc/client'
import type { SftpEntry, SftpProgress, SftpTarget } from '@shared/types/sftp'
import { getT } from '@/lib/i18n'
import { onSaved, useEditor } from './store'

interface SftpState {
  targets: SftpTarget[]
  /** The selected target (by name). */
  target?: string
  /** Server folders by path ('' = remotePath). */
  tree: Record<string, SftpEntry[]>
  expanded: Record<string, boolean>
  busy: boolean
  progress?: SftpProgress
  /** What the last transfer did, for the status line. */
  message?: string
  error?: string
  /** Asking before a sync down overwrites local files. */
  confirmDown: boolean

  connect: () => () => void
  /** The editor's project's targets (none without .vscode/sftp.json). */
  load: () => Promise<void>
  select: (target: string) => void
  toggle: (dir: string) => Promise<void>
  refresh: () => Promise<void>
  upload: (paths: string[]) => Promise<void>
  download: (paths: string[]) => Promise<void>
  /** Fetch a server file and open it. */
  open: (path: string) => Promise<void>
  sync: (direction: 'up' | 'down') => Promise<void>
  setConfirmDown: (on: boolean) => void
  clearError: () => void
}

const inside = (path: string, context: string) => !context || path === context || path.startsWith(`${context}/`)

/** SFTP for the editor's project — the VS Code SFTP extension's workflow. */
export const useSftp = create<SftpState>((set, get) => {
  const project = () => useEditor.getState().projectId
  const current = () => get().targets.find((t) => t.name === get().target)
  /** One transfer at a time; its error shows; an open tree reloads after. */
  const run = async (fn: (projectId: string, target: string) => Promise<string | undefined>) => {
    const projectId = project()
    const target = get().target
    if (!projectId || !target || get().busy) return
    set({ busy: true, error: undefined, message: undefined })
    try {
      set({ message: await fn(projectId, target) })
      // The server changed: an open tree shows it.
      if (get().expanded['']) await get().refresh()
    } catch (err) {
      set({ error: errorMessage(err) })
    } finally {
      set({ busy: false, progress: undefined })
    }
  }

  return {
    targets: [],
    tree: {},
    expanded: {},
    busy: false,
    confirmDown: false,

    connect: () => {
      const offProgress = onEvent('sftp:progress', (progress) => set({ progress }))
      // Upload on save, for targets that want it (and files inside their context).
      const offSaved = onSaved(({ projectId, path }) => {
        if (projectId !== project()) return
        for (const t of get().targets.filter((x) => x.uploadOnSave && inside(path, x.context))) {
          void ipc('sftp:upload', { projectId, target: t.name, paths: [path] }).then(
            () => set({ message: path }),
            (err: unknown) => set({ error: errorMessage(err) })
          )
        }
      })
      return () => {
        offProgress()
        offSaved()
      }
    },

    load: async () => {
      const projectId = project()
      set({ targets: [], target: undefined, tree: {}, expanded: {}, error: undefined, message: undefined })
      if (!projectId) return
      const targets = await ipc('sftp:targets', { projectId }).catch((err: unknown) => {
        set({ error: errorMessage(err) })
        return [] as SftpTarget[]
      })
      set({ targets, target: targets[0]?.name })
    },

    select: (target) => set({ target, tree: {}, expanded: {} }),

    toggle: async (dir) => {
      if (get().expanded[dir]) {
        return set((s) => {
          const { [dir]: _closed, ...expanded } = s.expanded
          return { expanded }
        })
      }
      set((s) => ({ expanded: { ...s.expanded, [dir]: true } }))
      const projectId = project()
      const target = get().target
      if (!projectId || !target) return
      try {
        const entries = await ipc('sftp:list', { projectId, target, dir })
        set((s) => ({ tree: { ...s.tree, [dir]: entries } }))
      } catch (err) {
        set({ error: errorMessage(err) })
      }
    },

    refresh: async () => {
      const open = Object.keys(get().expanded)
      set({ tree: {}, expanded: {} })
      for (const dir of ['', ...open.filter(Boolean)]) await get().toggle(dir)
    },

    upload: (paths) =>
      run(async (projectId, target) => {
        return getT().sftp.files(await ipc('sftp:upload', { projectId, target, paths }))
      }),

    download: (paths) =>
      run(async (projectId, target) => {
        const written = await ipc('sftp:download', { projectId, target, paths })
        await useEditor.getState().refreshTree()
        return getT().sftp.files(written.length)
      }),

    open: async (path) => {
      const projectId = project()
      const target = current()
      if (!projectId || !target) return
      try {
        const [local] = await ipc('sftp:download', { projectId, target: target.name, paths: [path] })
        await useEditor.getState().refreshTree()
        await useEditor.getState().open(local)
      } catch (err) {
        set({ error: errorMessage(err) })
      }
    },

    sync: (direction) => {
      set({ confirmDown: false })
      return run(async (projectId, target) => {
        const n = await ipc('sftp:sync', { projectId, target, direction })
        if (direction === 'down') await useEditor.getState().refreshTree()
        return getT().sftp.files(n)
      })
    },

    setConfirmDown: (confirmDown) => set({ confirmDown }),
    clearError: () => set({ error: undefined })
  }
})

/** A new project: its SFTP targets. */
useEditor.subscribe((s, prev) => {
  if (s.projectId !== prev.projectId) void useSftp.getState().load()
})
