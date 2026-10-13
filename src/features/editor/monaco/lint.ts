import { errorMessage, ipc, IpcError } from '@shared/ipc/client'
import { isTypeScriptFile } from '@shared/types/languages'
import type { LintDiagnostic } from '@shared/types/lint'
import type { EditorSettings } from '@shared/types/migrate'
import { getT } from '@/lib/i18n'
import { monaco } from './setup'
import { fileOf } from './uri'
import { useProblems } from '../problems'
import { useLintStatus } from '../lintStatus'

type Model = monaco.editor.ITextModel

const OWNER = 'eslint'
/** ESLint runs this long after the last keystroke. */
const LINT_MS = 400
/** The core refuses project code from this client (a remote client without shells): nothing to ask. */
const REFUSED = ['remote-terminal-disabled', 'license-required', 'unknown-channel']

const refused = new Set<string>()
/** The last lint of each model, for its fixes — valid while the text is unchanged. */
const lastLint = new Map<string, { version: number; diagnostics: LintDiagnostic[] }>()
const models = new Set<Model>()

const SEVERITY: Record<LintDiagnostic['severity'], monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  suggestion: monaco.MarkerSeverity.Hint,
  info: monaco.MarkerSeverity.Info
}

/** Lint a model now: markers, problems, fixes. */
export async function lintModel(model: Model): Promise<void> {
  const file = fileOf(model.uri)!
  if (refused.has(file.projectId)) return
  const version = model.getVersionId()
  let result
  try {
    result = await ipc('lint:file', { ...file, text: model.getValue() })
    useLintStatus.getState().setError(file.projectId)
  } catch (err) {
    if (err instanceof IpcError && REFUSED.includes(err.code)) refused.add(file.projectId)
    else useLintStatus.getState().setError(file.projectId, errorMessage(err))
    return
  }
  if (model.isDisposed() || model.getVersionId() !== version) return
  lastLint.set(model.uri.toString(), { version, diagnostics: result.diagnostics })
  monaco.editor.setModelMarkers(
    model,
    OWNER,
    result.diagnostics.map((d) => ({
      startLineNumber: d.range.start.line,
      startColumn: d.range.start.offset,
      endLineNumber: d.range.end.line,
      endColumn: d.range.end.offset,
      message: d.message,
      severity: SEVERITY[d.severity],
      code: d.code === undefined ? undefined : String(d.code),
      source: 'eslint'
    }))
  )
  useProblems.getState().report(file.projectId, { [file.path]: result.diagnostics }, OWNER)
}

function track(model: Model): void {
  const file = fileOf(model.uri)
  if (!file || !isTypeScriptFile(file.path)) return
  models.add(model)
  let timer: number | undefined
  void lintModel(model)
  model.onDidChangeContent(() => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void lintModel(model), LINT_MS)
  })
  model.onWillDispose(() => {
    window.clearTimeout(timer)
    models.delete(model)
    lastLint.delete(model.uri.toString())
  })
}

/** Start ESLint over (config or plugins changed) and lint every open file again. */
export async function restartLint(): Promise<void> {
  refused.clear()
  useLintStatus.setState({ errors: {} })
  await ipc('lint:restart').catch(() => {})
  await Promise.all([...models].map((m) => lintModel(m)))
}

/** The text with all of ESLint's fixes (applied as one undoable edit). */
export async function fixAll(model: Model): Promise<boolean> {
  const file = fileOf(model.uri)
  if (!file || !isTypeScriptFile(file.path) || refused.has(file.projectId)) return false
  const version = model.getVersionId()
  const fixed = await ipc('lint:fix', { ...file, text: model.getValue() }).catch(() => null)
  if (fixed === null || model.isDisposed() || model.getVersionId() !== version) return false
  applyText(model, fixed)
  return true
}

/**
 * Prettier formats the model when it is responsible (the project uses it,
 * or the user wants Prettier everywhere). False: the editor's own formatter's turn.
 */
export async function formatWithPrettier(model: Model, prefs: EditorSettings): Promise<boolean> {
  const file = fileOf(model.uri)
  if (!file || refused.has(file.projectId)) return false
  const version = model.getVersionId()
  const formatted = await ipc('format:document', { ...file, text: model.getValue(), prettier: prefs.prettier || undefined, options: prefs.prettierOptions }).catch(() => null)
  if (formatted === null || model.isDisposed() || model.getVersionId() !== version) return false
  applyText(model, formatted)
  return true
}

/** Replace only what changed (common start and end kept): the cursor and undo stay where they make sense. */
export function applyText(model: Model, text: string): void {
  const old = model.getValue()
  if (old === text) return
  let start = 0
  while (start < old.length && start < text.length && old[start] === text[start]) start += 1
  let end = 0
  while (end < old.length - start && end < text.length - start && old[old.length - 1 - end] === text[text.length - 1 - end]) end += 1
  const from = model.getPositionAt(start)
  const to = model.getPositionAt(old.length - end)
  model.pushEditOperations([], [{ range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), text: text.slice(start, text.length - end) }], () => null)
}

/** ESLint's quick fixes for the problems at the cursor, all fixes at once, and silencing a rule on a line. */
export const lintActions: monaco.languages.CodeActionProvider = {
  provideCodeActions(model, _range, context) {
    const last = lastLint.get(model.uri.toString())
    const markers = context.markers.filter((m) => m.source === 'eslint')
    if (!last || last.version !== model.getVersionId() || !markers.length) return { actions: [], dispose() {} }
    const t = getT().lint
    const actions: monaco.languages.CodeAction[] = []
    const edit = (range: monaco.IRange, text: string): monaco.languages.WorkspaceEdit => ({ edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: { range, text } }] })
    for (const marker of markers) {
      const d = last.diagnostics.find((x) => x.range.start.line === marker.startLineNumber && x.range.start.offset === marker.startColumn && x.message === marker.message)
      if (d?.fix) {
        const from = model.getPositionAt(d.fix.start)
        const to = model.getPositionAt(d.fix.end)
        actions.push({ title: t.fix(String(d.code ?? 'eslint')), kind: 'quickfix', diagnostics: [marker], isPreferred: true, edit: edit(new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), d.fix.text) })
      }
      if (marker.code) {
        const line = marker.startLineNumber
        const indent = /^\s*/.exec(model.getLineContent(line))![0]
        actions.push({ title: t.disable(String(marker.code)), kind: 'quickfix', diagnostics: [marker], edit: edit(new monaco.Range(line, 1, line, 1), `${indent}// eslint-disable-next-line ${marker.code}\n`) })
      }
    }
    if (last.diagnostics.some((d) => d.fix)) actions.push({ title: t.fixAll, kind: 'source.fixAll.eslint', command: { id: 'mindeck.eslintFixAll', title: t.fixAll } })
    return { actions, dispose() {} }
  }
}

let registered = false

/** ESLint for every JS / TS file the editor opens (once). */
export function setupLint(): void {
  if (registered) return
  registered = true
  useLintStatus.setState({ restart: restartLint })
  monaco.editor.getModels().forEach(track)
  monaco.editor.onDidCreateModel(track)
  for (const language of ['javascript', 'typescript']) monaco.languages.registerCodeActionProvider(language, lintActions)
  monaco.editor.registerCommand('mindeck.eslintFixAll', () => {
    const model = monaco.editor.getEditors().find((e) => e.hasTextFocus() || e.hasWidgetFocus())?.getModel()
    if (model) void fixAll(model)
  })
}
