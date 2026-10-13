import { ipc } from '@shared/ipc/client'
import { getT } from '@/lib/i18n'
import { monaco } from './setup'
import { lineChanges, type LineChange } from '../gutter'
import { useScm } from '../scm'

type File = { projectId: string; path: string }

const TOKEN: Record<LineChange['kind'], string> = { added: '--accent-green', modified: '--accent-blue', deleted: '--accent-danger' }
/** Re-mark this long after the last keystroke. */
const PAINT_MS = 150

/** A theme token as a canvas color (overview ruler and minimap are painted, not styled). */
const color = (token: string) => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(token).trim()})`

/**
 * VS Code's quick diff: bars in the gutter for lines added (green) or
 * modified (blue) against git's staged text, a wedge where lines were
 * deleted (red) — kept current while typing, and refreshed whenever git's
 * status changes. A click on a marker opens the file's diff.
 */
export function attachGutter(editor: monaco.editor.IStandaloneCodeEditor, current: () => File | undefined): () => void {
  const decorations = editor.createDecorationsCollection()
  let original: string | null = null
  let changes: LineChange[] = []
  let timer: number | undefined

  const paint = () => {
    const model = editor.getModel()
    changes = model && original !== null ? (lineChanges(original, model.getValue()) ?? []) : []
    decorations.set(
      changes.map((c) => {
        const line = Math.max(1, c.start)
        const tint = color(TOKEN[c.kind])
        return {
          range: new monaco.Range(line, 1, Math.max(1, c.end), 1),
          options: {
            linesDecorationsClassName: c.kind === 'deleted' && c.start === 0 ? 'mindeck-gutter-deleted-top' : `mindeck-gutter-${c.kind}`,
            overviewRuler: { color: tint, position: monaco.editor.OverviewRulerLane.Left },
            minimap: { color: tint, position: monaco.editor.MinimapPosition.Gutter }
          }
        }
      })
    )
  }

  const load = async () => {
    const file = current()
    if (!file) {
      original = null
      return paint()
    }
    const text = await ipc('scm:original', file).catch(() => null)
    // Another file may be on screen by now.
    const now = current()
    if (now?.projectId !== file.projectId || now.path !== file.path) return
    original = text
    paint()
  }

  const subs = [
    editor.onDidChangeModel(() => {
      original = null
      paint()
      // The view records which tab it shows right after switching models.
      void Promise.resolve().then(load)
    }),
    editor.onDidChangeModelContent(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(paint, PAINT_MS)
    }),
    editor.onMouseDown((e) => {
      const file = current()
      const line = e.target.position?.lineNumber
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS || !file || !line) return
      if (!changes.some((c) => line >= Math.max(1, c.start) && line <= Math.max(1, c.end))) return
      const name = file.path.slice(file.path.lastIndexOf('/') + 1)
      void useScm.getState().openDiff({ path: file.path }, { kind: 'unstaged' }, `${name} (${getT().scm.workingTree})`)
    })
  ]
  const unsubscribe = useScm.subscribe((s, prev) => {
    if (s.status !== prev.status) void load()
  })
  void load()

  return () => {
    window.clearTimeout(timer)
    unsubscribe()
    subs.forEach((s) => s.dispose())
    decorations.clear()
  }
}
