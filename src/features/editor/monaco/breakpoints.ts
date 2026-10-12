import { monaco } from './setup'
import { useDebug } from '../debug'

type File = { projectId: string; path: string }

/**
 * Breakpoints in the editor's glyph margin (a click sets or clears one, like
 * VS Code) and, while the debugger is paused, the line it stopped at.
 */
export function attachBreakpoints(editor: monaco.editor.IStandaloneCodeEditor, current: () => File | undefined): () => void {
  const decorations = editor.createDecorationsCollection()

  const paint = () => {
    const file = current()
    if (!file || !editor.getModel()) return decorations.clear()
    const { breakpoints, session, frame } = useDebug.getState()
    const here = (breakpoints[file.projectId] ?? []).filter((b) => b.path === file.path)
    const stopped = session?.status === 'paused' && session.projectId === file.projectId ? session.frames[frame] : undefined
    decorations.set([
      ...here.map((b) => ({
        range: new monaco.Range(b.line, 1, b.line, 1),
        options: { glyphMarginClassName: 'wone-bp', glyphMarginHoverMessage: { value: `Breakpoint · ${b.line}` }, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges }
      })),
      ...(stopped?.path === file.path
        ? [{ range: new monaco.Range(stopped.line, 1, stopped.line, 1), options: { isWholeLine: true, className: 'wone-debug-line', glyphMarginClassName: 'wone-debug-arrow' } }]
        : [])
    ])
  }

  const subs = [
    editor.onDidChangeModel(() => void Promise.resolve().then(paint)),
    editor.onMouseDown((e) => {
      const file = current()
      const line = e.target.position?.lineNumber
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !file || !line) return
      useDebug.getState().toggleBreakpoint(file.projectId, file.path, line)
    })
  ]
  const unsubscribe = useDebug.subscribe((s, prev) => {
    if (s.breakpoints !== prev.breakpoints || s.session !== prev.session || s.frame !== prev.frame) paint()
  })
  paint()

  return () => {
    unsubscribe()
    subs.forEach((s) => s.dispose())
    decorations.clear()
  }
}
