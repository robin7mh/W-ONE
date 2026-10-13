import { create } from 'zustand'
import { errorMessage, ipc, onEvent } from '@shared/ipc/client'
import type { DebugAction, DebugBreakpoint, DebugSession, DebugVariable } from '@shared/types/debug'
import { useEditor } from './store'
import { isTypeScriptFile, languageOf } from '@shared/types/languages'

const RUNNERS: Record<string, string> = { python: 'python', go: 'go run', cpp: 'lldb', rust: 'lldb', swift: 'lldb', php: 'php', java: 'java', kotlin: 'kotlin' }

/** The program that runs a file, as the console's first line says (a built program: LLDB). */
export const runnerOf = (program: string): string => {
  const language = languageOf(program)?.id
  if (language) return RUNNERS[language] ?? language
  return isTypeScriptFile(program) ? 'node' : 'lldb'
}

export interface ConsoleLine {
  id: number
  kind: 'stdout' | 'stderr' | 'info' | 'input' | 'result' | 'error'
  text: string
}

/** What the debugger remembers per viewer: breakpoints, the program per project, watches. */
interface Saved {
  breakpoints: Record<string, DebugBreakpoint[]>
  program: Record<string, string>
  args: Record<string, string>
  /** The build step per project (make, …), run before each start. */
  build: Record<string, string>
  watches: string[]
}

const KEY = 'mindeck.debug'
const MAX_LINES = 2000

function load(): Saved {
  const empty: Saved = { breakpoints: {}, program: {}, args: {}, build: {}, watches: [] }
  try {
    return { ...empty, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>) }
  } catch {
    return empty
  }
}

function save(s: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ breakpoints: s.breakpoints, program: s.program, args: s.args, build: s.build, watches: s.watches }))
  } catch {
    /* storage unavailable: kept for this run only */
  }
}

/** Shell-like words: quotes keep spaces together. */
export function splitArgs(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3])
}

interface DebugState extends Saved {
  session: DebugSession | null
  console: ConsoleLine[]
  /** The call frame the variables and evaluations refer to. */
  frame: number
  /** Loaded properties per object id. */
  vars: Record<string, DebugVariable[]>
  /** Expanded rows of the variables tree (by path). */
  expanded: Record<string, boolean>
  watchValues: Record<string, DebugVariable>
  stopOnEntry: boolean
  consoleOpen: boolean
  error?: string

  /** Follow the core's debug events; returns the unsubscribe. */
  connect: () => () => void
  toggleBreakpoint: (projectId: string, path: string, line: number) => void
  removeBreakpoint: (projectId: string, bp: DebugBreakpoint) => void
  clearBreakpoints: (projectId: string) => void
  setProgram: (projectId: string, program: string) => void
  setArgs: (projectId: string, args: string) => void
  setBuild: (projectId: string, build: string) => void
  setStopOnEntry: (on: boolean) => void
  /** Debug the program chosen for the editor's project (else the file on screen). */
  start: () => Promise<void>
  restart: () => Promise<void>
  stop: () => Promise<void>
  control: (action: DebugAction) => Promise<void>
  selectFrame: (index: number) => void
  toggleVariable: (path: string, objectId: string) => Promise<void>
  evaluate: (expression: string) => Promise<void>
  addWatch: (expression: string) => void
  removeWatch: (expression: string) => void
  refreshWatches: () => Promise<void>
  clearConsole: () => void
  setConsoleOpen: (open: boolean) => void
  clearError: () => void
}

let lineId = 0
const line = (kind: ConsoleLine['kind'], text: string): ConsoleLine => ({ id: ++lineId, kind, text })

/**
 * Run & Debug for the editor: breakpoints per file, the running session as
 * the core reports it, its output and a console that evaluates in the
 * selected frame. Pausing reveals the line in the editor.
 */
export const useDebug = create<DebugState>((set, get) => {
  const persist = () => save(get())
  const frameId = () => {
    const { session, frame } = get()
    return session?.status === 'paused' ? session.frames[frame]?.id : undefined
  }
  const append = (...lines: ConsoleLine[]) => set((s) => ({ console: [...s.console, ...lines].slice(-MAX_LINES) }))
  const syncBreakpoints = (projectId: string) => {
    if (get().session?.projectId === projectId && get().session?.status !== 'exited') {
      void ipc('debug:setBreakpoints', { projectId, breakpoints: get().breakpoints[projectId] }).catch(() => {})
    }
  }

  const onSession = (session: DebugSession) => {
    const before = get().session
    const fresh = before?.id !== session.id
    set({ session, ...(session.status === 'paused' || fresh ? { frame: 0, vars: {}, expanded: {} } : {}), ...(fresh ? { consoleOpen: true } : {}) })
    if (session.error && session.error !== before?.error) set({ error: session.error })
    if (session.status !== 'paused') return
    const top = session.frames.find((f) => f.path)
    if (top && session.projectId === useEditor.getState().projectId) void useEditor.getState().openAt(top.path!, top.line)
    void get().refreshWatches()
  }

  return {
    ...load(),
    session: null,
    console: [],
    frame: 0,
    vars: {},
    expanded: {},
    watchValues: {},
    stopOnEntry: false,
    consoleOpen: false,

    connect: () => {
      void ipc('debug:session').then(
        (session) => session && onSession(session),
        () => {}
      )
      const offSession = onEvent('debug:session', onSession)
      const offOutput = onEvent('debug:output', (o) => {
        if (o.sessionId === get().session?.id || !get().session) append(line(o.stream, o.text))
      })
      return () => {
        offSession()
        offOutput()
      }
    },

    toggleBreakpoint: (projectId, path, at) => {
      const list = get().breakpoints[projectId] ?? []
      const has = list.some((b) => b.path === path && b.line === at)
      const next = has ? list.filter((b) => !(b.path === path && b.line === at)) : [...list, { path, line: at }]
      set((s) => ({ breakpoints: { ...s.breakpoints, [projectId]: next } }))
      persist()
      syncBreakpoints(projectId)
    },

    removeBreakpoint: (projectId, bp) => get().toggleBreakpoint(projectId, bp.path, bp.line),

    clearBreakpoints: (projectId) => {
      set((s) => ({ breakpoints: { ...s.breakpoints, [projectId]: [] } }))
      persist()
      syncBreakpoints(projectId)
    },

    setProgram: (projectId, program) => {
      set((s) => ({ program: { ...s.program, [projectId]: program } }))
      persist()
    },

    setArgs: (projectId, args) => {
      set((s) => ({ args: { ...s.args, [projectId]: args } }))
      persist()
    },
    setBuild: (projectId, build) => {
      set((s) => ({ build: { ...s.build, [projectId]: build } }))
      persist()
    },

    setStopOnEntry: (stopOnEntry) => set({ stopOnEntry }),

    start: async () => {
      const editor = useEditor.getState()
      const projectId = editor.projectId
      if (!projectId) return
      const shown = editor.tabs.find((t) => t.id === editor.focusedId() && t.projectId === projectId)
      const program = get().program[projectId]?.trim() || shown?.path
      if (!program) return set({ error: 'no-program' })
      // Unsaved edits would not be what runs.
      await editor.saveAll()
      set({ error: undefined, console: [line('info', `▶ ${runnerOf(program)} ${program} ${get().args[projectId] ?? ''}\n`)], consoleOpen: true })
      try {
        const session = await ipc('debug:start', {
          projectId,
          program,
          args: splitArgs(get().args[projectId] ?? ''),
          stopOnEntry: get().stopOnEntry,
          breakpoints: get().breakpoints[projectId] ?? [],
          build: get().build[projectId]?.trim() || undefined
        })
        onSession(session)
      } catch (err) {
        set({ error: errorMessage(err) })
      }
    },

    restart: async () => {
      await get().stop()
      await get().start()
    },

    stop: async () => {
      await ipc('debug:stop').catch(() => {})
    },

    control: async (action) => {
      await ipc('debug:control', { action }).catch((err: unknown) => set({ error: errorMessage(err) }))
    },

    selectFrame: (index) => {
      const frame = get().session?.frames[index]
      if (!frame) return
      set({ frame: index })
      if (frame.path && get().session!.projectId === useEditor.getState().projectId) void useEditor.getState().openAt(frame.path, frame.line)
      void get().refreshWatches()
    },

    toggleVariable: async (path, objectId) => {
      if (get().expanded[path]) {
        return set((s) => {
          const { [path]: _closed, ...expanded } = s.expanded
          return { expanded }
        })
      }
      set((s) => ({ expanded: { ...s.expanded, [path]: true } }))
      if (get().vars[objectId]) return
      const vars = await ipc('debug:variables', { objectId }).catch(() => [] as DebugVariable[])
      set((s) => ({ vars: { ...s.vars, [objectId]: vars } }))
    },

    evaluate: async (expression) => {
      const text = expression.trim()
      if (!text) return
      append(line('input', text))
      try {
        const result = await ipc('debug:evaluate', { expression: text, frameId: frameId() })
        append(line(result.type === 'error' ? 'error' : 'result', result.value))
      } catch (err) {
        append(line('error', errorMessage(err)))
      }
    },

    addWatch: (expression) => {
      const text = expression.trim()
      if (!text || get().watches.includes(text)) return
      set((s) => ({ watches: [...s.watches, text] }))
      persist()
      void get().refreshWatches()
    },

    removeWatch: (expression) => {
      set((s) => ({ watches: s.watches.filter((w) => w !== expression) }))
      persist()
    },

    refreshWatches: async () => {
      if (get().session?.status !== 'paused') return
      const id = frameId()
      const values = await Promise.all(
        get().watches.map((expression) =>
          ipc('debug:evaluate', { expression, frameId: id }).catch((err: unknown) => ({ name: expression, value: errorMessage(err), type: 'error' }))
        )
      )
      set({ watchValues: Object.fromEntries(values.map((v, i) => [get().watches[i], v])) })
    },

    clearConsole: () => set({ console: [] }),
    setConsoleOpen: (consoleOpen) => set({ consoleOpen }),
    clearError: () => set({ error: undefined })
  }
})
