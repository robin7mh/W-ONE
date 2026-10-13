import { describe, expect, it, vi } from 'vitest'
import type { TestItem, TestRunState } from '@shared/types/tests'

const mon = vi.hoisted(() => {
  const created: ((m: unknown) => void)[] = []
  const markers = new Map<string, unknown[]>()
  const model = (path: string, scheme = 'file') => ({ uri: { scheme, path } })
  const models = [model('/p/a.test.ts'), model('/p/other.ts'), model('/q/a.test.ts'), model('x', 'inmemory')]
  return {
    created,
    markers,
    model,
    models,
    monaco: {
      MarkerSeverity: { Error: 8 },
      editor: {
        onDidCreateModel: (fn: (m: unknown) => void) => created.push(fn),
        getModels: () => models,
        setModelMarkers: (m: { uri: { path: string } }, owner: string, list: unknown[]) => markers.set(`${owner}:${m.uri.path}`, list)
      }
    }
  }
})
vi.mock('@/features/editor/monaco/setup', () => ({ monaco: mon.monaco }))

import { failures, setupTestMarkers } from '@/features/editor/monaco/testMarkers'
import { useTests } from '@/features/editor/tests'
import { useProblems } from '@/features/editor/problems'

const ITEMS: TestItem[] = [
  {
    id: 'a.test.ts',
    name: 'a.test.ts',
    kind: 'file',
    framework: 'vitest',
    path: 'a.test.ts',
    children: [
      { id: 'a.test.ts::fails', name: 'fails', kind: 'test', framework: 'vitest', path: 'a.test.ts', line: 3 },
      { id: 'a.test.ts::bare', name: 'bare', kind: 'test', framework: 'vitest', path: 'a.test.ts', line: 7 },
      { id: 'a.test.ts::ok', name: 'ok', kind: 'test', framework: 'vitest', path: 'a.test.ts', line: 9 },
      { id: 'a.test.ts::nowhere', name: 'nowhere', kind: 'test', framework: 'vitest', path: 'a.test.ts' }
    ]
  }
]
const run = (over: Partial<TestRunState> = {}): TestRunState => ({
  projectId: 'p',
  running: false,
  output: '',
  results: {
    'a.test.ts::fails': { state: 'failed', message: 'l1\nl2\nl3\nl4\nl5\nl6\nl7' },
    'a.test.ts::bare': { state: 'failed' },
    'a.test.ts::ok': { state: 'passed' },
    'a.test.ts::nowhere': { state: 'failed' }
  },
  ...over
})

describe('failed tests in the editor', () => {
  it('as diagnostics at the test, the message cut short; every test file listed so passing ones clear', () => {
    const byFile = failures(ITEMS, run())
    expect(byFile['a.test.ts'].map((d) => [d.range.start.line, d.message])).toEqual([
      [3, 'fails failed: l1\nl2\nl3\nl4\nl5\nl6'],
      [7, 'bare failed']
    ])
    expect(failures(ITEMS, null)).toEqual({ 'a.test.ts': [] })
  })

  it('marks the open files of the project and those opened later; the problems list too; once', () => {
    setupTestMarkers()
    setupTestMarkers()
    expect(mon.created).toHaveLength(1)
    useTests.setState({ items: ITEMS, run: { ...run(), running: true } })
    expect(mon.markers.size).toBe(0)
    useTests.setState({ run: run() })
    expect(mon.markers.get('tests:/p/a.test.ts')).toEqual([
      expect.objectContaining({ startLineNumber: 3, endLineNumber: 3, startColumn: 1, endColumn: 1000, severity: 8, source: 'test' }),
      expect.objectContaining({ startLineNumber: 7 })
    ])
    expect(mon.markers.get('tests:/p/other.ts')).toEqual([])
    expect(mon.markers.get('tests:/q/a.test.ts')).toEqual([])
    expect(mon.markers.get('tests:x')).toEqual([])
    expect(useProblems.getState().byFile['p:a.test.ts'].map((p) => [p.line, p.owner])).toEqual([
      [3, 'tests'],
      [7, 'tests']
    ])
    mon.created[0](mon.model('/p/a.test.ts'))
    expect(mon.markers.get('tests:/p/a.test.ts')).toHaveLength(2)
    // Something else changed: nothing to redo.
    mon.markers.clear()
    useTests.setState({ failedOnly: true })
    useTests.setState({ run: null })
    expect(mon.markers.size).toBe(0)
    // They pass now.
    useTests.setState({ run: run({ results: {} }) })
    expect(mon.markers.get('tests:/p/a.test.ts')).toEqual([])
    expect(useProblems.getState().byFile['p:a.test.ts']).toEqual([])
  })
})
