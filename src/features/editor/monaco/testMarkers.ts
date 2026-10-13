import type { LspDiagnostic } from '@shared/types/lsp'
import type { TestItem, TestRunState } from '@shared/types/tests'
import { getT } from '@/lib/i18n'
import { monaco } from './setup'
import { fileOf } from './uri'
import { useProblems } from '../problems'
import { useTests } from '../tests'

const OWNER = 'tests'
/** Lines of a failure shown on the marker (the whole message is in the test explorer). */
const MESSAGE_LINES = 6

/** Failed tests by file, as diagnostics at their definition. */
export function failures(items: TestItem[], run: TestRunState | null): Record<string, LspDiagnostic[]> {
  const out: Record<string, LspDiagnostic[]> = {}
  const walk = (item: TestItem) => {
    if (item.kind === 'file') out[item.path] = []
    if (item.children) return item.children.forEach(walk)
    const result = run?.results[item.id]
    if (result?.state !== 'failed' || !item.line) return
    const message = `${getT().tests.markerFailed(item.name)}${result.message ? `: ${result.message.split('\n').slice(0, MESSAGE_LINES).join('\n')}` : ''}`
    out[item.path].push({ range: { start: { line: item.line, offset: 1 }, end: { line: item.line, offset: 1000 } }, message, severity: 'error', source: 'test' })
  }
  items.forEach(walk)
  return out
}

let registered = false
let current: { projectId: string; byFile: Record<string, LspDiagnostic[]> } | undefined

function mark(model: monaco.editor.ITextModel): void {
  const file = fileOf(model.uri)
  const diags = file && current?.projectId === file.projectId ? current.byFile[file.path] : undefined
  monaco.editor.setModelMarkers(
    model,
    OWNER,
    (diags ?? []).map((d) => ({
      startLineNumber: d.range.start.line,
      startColumn: d.range.start.offset,
      endLineNumber: d.range.end.line,
      endColumn: d.range.end.offset,
      message: d.message,
      severity: monaco.MarkerSeverity.Error,
      source: d.source
    }))
  )
}

/** Failed tests show in their file (a red line, like VS Code) and in the problems list, until they pass. */
export function setupTestMarkers(): void {
  if (registered) return
  registered = true
  monaco.editor.onDidCreateModel(mark)
  useTests.subscribe((s, prev) => {
    if (s.run === prev.run && s.items === prev.items) return
    if (!s.run || s.run.running) return
    const byFile = failures(s.items, s.run)
    current = { projectId: s.run.projectId, byFile }
    useProblems.getState().report(s.run.projectId, byFile, OWNER)
    monaco.editor.getModels().forEach(mark)
  })
}
