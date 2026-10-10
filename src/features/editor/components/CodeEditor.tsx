import { useEffect, useRef } from 'react'
import { applyMonacoTheme, languageName, monaco, THEME } from '../monaco/setup'
import { setBufferHost, useEditor, type EditorTab } from '../store'
import { APPEARANCE_ATTRIBUTES } from '@/lib/theme'

export interface CursorInfo {
  line: number
  col: number
  language: string
}

interface Buffer {
  model: monaco.editor.ITextModel
  /** Tab revision whose disk text the model holds. */
  revision: number
  /** Alternative version id of the text on disk — differs ⇔ unsaved edits. */
  clean: number
  view: monaco.editor.ICodeEditorViewState | null
}

const OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  model: null,
  theme: THEME,
  automaticLayout: true,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 13,
  lineHeight: 20,
  minimap: { enabled: true, renderCharacters: false, maxColumn: 80 },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  padding: { top: 10, bottom: 10 },
  bracketPairColorization: { enabled: true },
  guides: { indentation: true, bracketPairs: false },
  stickyScroll: { enabled: true },
  renderWhitespace: 'selection',
  // Hovers and suggestions may overflow the panel instead of being clipped.
  fixedOverflowWidgets: true,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
}

interface Props {
  /** The tab to show — one without loaded text shows no buffer. */
  tab?: EditorTab
  readOnly: boolean
  onCursor: (info: CursorInfo) => void
}

/**
 * One Monaco editor for the whole module; every open file is a model (its own
 * text, undo history and scroll position) that is swapped in when its tab
 * becomes active. Edits stay in the model — the store only learns "dirty or
 * not" (from Monaco's version ids, so undoing back to the saved text is clean
 * again) and asks for the text when it saves.
 */
export default function CodeEditor({ tab, readOnly, onCursor }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const buffers = useRef(new Map<string, Buffer>()).current
  const shown = useRef<string>()
  const cursorRef = useRef(onCursor)
  cursorRef.current = onCursor

  useEffect(() => {
    applyMonacoTheme()
    const editor = monaco.editor.create(hostRef.current!, OPTIONS)
    editorRef.current = editor

    const report = () => {
      const model = editor.getModel()
      const pos = editor.getPosition()
      if (model && pos) cursorRef.current({ line: pos.lineNumber, col: pos.column, language: languageName(model.getLanguageId()) })
    }
    const subs = [editor.onDidChangeCursorPosition(report), editor.onDidChangeModel(report)]

    setBufferHost({
      snapshot: (id) => {
        const b = buffers.get(id)
        return b && { text: b.model.getValue(), version: b.model.getAlternativeVersionId() }
      },
      markClean: (id, version) => {
        const b = buffers.get(id)
        if (!b) return
        b.clean = version
        useEditor.getState().setDirty(id, b.model.getAlternativeVersionId() !== version)
      },
      drop: (id) => {
        const b = buffers.get(id)
        if (!b) return
        if (shown.current === id) {
          editor.setModel(null)
          shown.current = undefined
        }
        b.model.dispose()
        buffers.delete(id)
      }
    })

    // Follow the appearance settings (theme, accent, background).
    const theme = new MutationObserver(applyMonacoTheme)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: APPEARANCE_ATTRIBUTES })
    // Monaco measures glyph widths once; measure again when the bundled font is in.
    void document.fonts?.ready.then(() => monaco.editor.remeasureFonts())

    return () => {
      setBufferHost(null)
      theme.disconnect()
      subs.forEach((s) => s.dispose())
      editor.dispose()
      buffers.forEach((b) => b.model.dispose())
      buffers.clear()
      shown.current = undefined
      editorRef.current = null
    }
  }, [buffers])

  useEffect(() => {
    editorRef.current!.updateOptions({ readOnly })
  }, [readOnly])

  // Show the active tab: create its model on first sight, apply disk reloads.
  const text = tab?.content
  useEffect(() => {
    const editor = editorRef.current!
    if (shown.current) buffers.get(shown.current)!.view = editor.saveViewState()
    if (!tab || text === undefined) {
      editor.setModel(null)
      shown.current = undefined
      return
    }

    let buf = buffers.get(tab.id)
    if (!buf) {
      const id = tab.id
      const model = monaco.editor.createModel(text, undefined, monaco.Uri.file(`/${tab.projectId}/${tab.path}`))
      const created: Buffer = { model, revision: tab.revision, clean: model.getAlternativeVersionId(), view: null }
      model.onDidChangeContent(() => useEditor.getState().setDirty(id, model.getAlternativeVersionId() !== created.clean))
      buffers.set(id, created)
      buf = created
    } else if (buf.revision !== tab.revision) {
      // Re-read from disk: one undoable edit, so the old text is a ⌘Z away.
      buf.model.pushEditOperations([], [{ range: buf.model.getFullModelRange(), text }], () => null)
      buf.revision = tab.revision
      buf.clean = buf.model.getAlternativeVersionId()
      useEditor.getState().setDirty(tab.id, false)
    }

    const switched = shown.current !== tab.id
    if (switched) {
      editor.setModel(buf.model)
      shown.current = tab.id
    }
    if (buf.view) editor.restoreViewState(buf.view)
    if (switched) editor.focus()
  }, [buffers, tab?.id, tab?.revision, text === undefined])

  return <div ref={hostRef} className="absolute inset-0" />
}
