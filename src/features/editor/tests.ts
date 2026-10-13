import { create } from 'zustand'
import { errorMessage, ipc, onEvent } from '@shared/ipc/client'
import type { TestItem, TestResult, TestRunState } from '@shared/types/tests'
import { useEditor } from './store'
import { useDebug } from './debug'
import { useScm } from './scm'

interface TestsState {
  /** Tests by file, as found in the project. */
  items: TestItem[]
  /** Discovered once for this project. */
  loaded: boolean
  loading: boolean
  run: TestRunState | null
  /** Open rows (files, suites) by id. */
  expanded: Record<string, boolean>
  /** Show only what failed. */
  failedOnly: boolean
  /** Failure messages shown, by test id. */
  details: Record<string, boolean>
  showOutput: boolean
  error?: string

  /** Follow the core's runs; returns the unsubscribe. */
  connect: () => () => void
  discover: () => Promise<void>
  /** All tests, or one file / suite / test. */
  runTests: (id?: string) => Promise<void>
  cancel: () => Promise<void>
  debugTest: (id: string) => Promise<void>
  /** Open a test's file at its line. */
  reveal: (item: TestItem) => void
  toggle: (id: string) => void
  toggleDetails: (id: string) => void
  setFailedOnly: (on: boolean) => void
  setShowOutput: (on: boolean) => void
  clearError: () => void
}

/** A file's or suite's state from its tests: failed beats running beats passed; nothing ran — none. */
export function stateOf(item: TestItem, results: Record<string, TestResult>): TestResult['state'] | undefined {
  const own = results[item.id]?.state
  if (!item.children) return own
  const states = item.children.map((c) => stateOf(c, results))
  if (own === 'failed' || states.includes('failed')) return 'failed'
  if (states.includes('running')) return 'running'
  if (states.length && states.every((s) => s === 'skipped')) return 'skipped'
  if (states.some((s) => s === 'passed') && states.every((s) => s === 'passed' || s === 'skipped')) return 'passed'
  return own
}

/** Count the tests (leaves) by state. */
export function summary(items: TestItem[], results: Record<string, TestResult>): Record<'passed' | 'failed' | 'skipped' | 'total', number> {
  const counts = { passed: 0, failed: 0, skipped: 0, total: 0 }
  const walk = (item: TestItem) => {
    if (item.children) return item.children.forEach(walk)
    counts.total += 1
    const s = results[item.id]?.state
    if (s === 'passed' || s === 'failed' || s === 'skipped') counts[s] += 1
  }
  items.forEach(walk)
  return counts
}

/** The test explorer of the editor's project (VS Code's Testing view). */
export const useTests = create<TestsState>((set) => {
  const project = () => useEditor.getState().projectId
  const guard = async (fn: (projectId: string) => Promise<void>) => {
    const projectId = project()
    if (!projectId) return
    set({ error: undefined })
    try {
      await fn(projectId)
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  }

  return {
    items: [],
    loaded: false,
    loading: false,
    run: null,
    expanded: {},
    failedOnly: false,
    details: {},
    showOutput: false,

    connect: () =>
      onEvent('tests:changed', (run) => {
        if (run.projectId === project()) set({ run })
      }),

    discover: () =>
      guard(async (projectId) => {
        set({ loading: true })
        try {
          const [items, run] = await Promise.all([ipc('tests:discover', { projectId }), ipc('tests:state', { projectId })])
          if (project() !== projectId) return
          // Files open at first.
          set((s) => ({ items, run, loaded: true, expanded: { ...Object.fromEntries(items.map((i) => [i.id, true])), ...s.expanded } }))
        } finally {
          set({ loading: false })
        }
      }),

    runTests: (id) =>
      guard(async (projectId) => {
        set({ run: await ipc('tests:run', { projectId, id }) })
      }),

    cancel: () => guard((projectId) => ipc('tests:cancel', { projectId })),

    debugTest: (id) =>
      guard(async (projectId) => {
        await ipc('tests:debug', { projectId, id, breakpoints: useDebug.getState().breakpoints[projectId] ?? [] })
        useDebug.getState().setConsoleOpen(true)
        useScm.getState().setPane('debug')
      }),

    reveal: (item) => {
      if (item.line) void useEditor.getState().openAt(item.path, item.line)
      else void useEditor.getState().open(item.path)
    },

    toggle: (id) => set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),
    toggleDetails: (id) => set((s) => ({ details: { ...s.details, [id]: !s.details[id] } })),
    setFailedOnly: (failedOnly) => set({ failedOnly }),
    setShowOutput: (showOutput) => set({ showOutput }),
    clearError: () => set({ error: undefined })
  }
})

/** Another project: its tests are found again when the pane shows. */
useEditor.subscribe((s, prev) => {
  if (s.projectId !== prev.projectId) useTests.setState({ items: [], loaded: false, run: null, expanded: {}, details: {}, error: undefined })
})
