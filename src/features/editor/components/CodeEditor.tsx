import { useEffect, useRef } from 'react'
import { applyMonacoTheme, languageName, monaco, THEME } from '../monaco/setup'
import { setBufferHost, useEditor, type EditorTab } from '../store'
import { useScm } from '../scm'
import { setEditorActions } from '../actions'
import { attachGutter } from '../monaco/gutter'
import { setupLsp } from '../monaco/lsp'
import { attachBreakpoints } from '../monaco/breakpoints'
import { setupUserPrefs } from '../monaco/userPrefs'
import { monacoOptions, settingsFor, useEditorPrefs } from '../prefs'
import { addEditorActions, replaceText, setupExtras } from '../monaco/extras'
import { tidyBlankLines } from '../text'

/** Formatting before a save gives up after this long (a slow formatter never blocks saving). */
const FORMAT_TIMEOUT_MS = 2000
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
  // Breakpoints live in the glyph margin.
  glyphMargin: true,
  // Hovers and suggestions may overflow the panel instead of being clipped.
  fixedOverflowWidgets: true,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
}

/** The URI a project file's model lives at — language services and the editor opener key on it. */
export const fileUri = (projectId: string, path: string): monaco.Uri => monaco.Uri.file(`/${projectId}/${path}`)

/** A tab's model. One already there (a definition peeked at before the file was opened) takes the text. */
function createBufferModel(text: string, file: { projectId: string; path: string }): monaco.editor.ITextModel {
  const uri = fileUri(file.projectId, file.path)
  const existing = monaco.editor.getModel(uri)
  if (!existing) return monaco.editor.createModel(text, undefined, uri)
  existing.setValue(text)
  return existing
}

/** Keep the tab's dirty flag in step with the model (undoing back to the saved text is clean). */
function watchDirty(id: string, buf: Buffer): void {
  buf.model.onDidChangeContent(() => useEditor.getState().setDirty(id, buf.model.getAlternativeVersionId() !== buf.clean))
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

    // W-ONE's palette replaces Monaco's own (F1), and ⌃G goes through it, too.
    editor.addCommand(monaco.KeyCode.F1, () => useScm.getState().setQuickOpen(true, '>'))
    editor.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyG, () => useScm.getState().setQuickOpen(true, ':'))
    setupLsp()
    setupUserPrefs()
    setupExtras()
    const actions = addEditorActions(editor)
    // The user's editor settings (moved over from VS Code / Cursor) for the file's language — now, on a switch, on a change.
    const applyPrefs = () => editor.updateOptions(monacoOptions(settingsFor(useEditorPrefs.getState().settings, editor.getModel()?.getLanguageId())))
    applyPrefs()
    subs.push(editor.onDidChangeModel(applyPrefs))
    const unsubscribePrefs = useEditorPrefs.subscribe((s, prev) => {
      if (s.settings !== prev.settings) applyPrefs()
    })
    const shownTab = () => useEditor.getState().tabs.find((t) => t.id === shown.current)
    const detachGutter = attachGutter(editor, shownTab)
    const detachBreakpoints = attachBreakpoints(editor, shownTab)
    setEditorActions({
      list: () => (editor.getModel() ? editor.getSupportedActions().map((a) => ({ id: a.id, label: a.label })) : []),
      run: (id) => {
        editor.focus()
        void editor.getAction(id)?.run()
      }
    })

    setBufferHost({
      // Before a save: tidy blank lines, format the document — as the user's settings for the language say.
      prepare: async (id) => {
        const b = buffers.get(id)
        if (!b) return
        const prefs = settingsFor(useEditorPrefs.getState().settings, b.model.getLanguageId())
        if (prefs.blankLines?.onSave) replaceText(b.model, tidyBlankLines(b.model.getValue(), prefs.blankLines.keepOne))
        const format = prefs.formatOnSave && shown.current === id ? editor.getAction('editor.action.formatDocument') : null
        if (format) await Promise.race([format.run(), new Promise((r) => setTimeout(r, FORMAT_TIMEOUT_MS))]).catch(() => {})
      },
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
      },
      rekey: (id, next) => {
        const b = buffers.get(id)
        if (!b) return
        // A model's URI is fixed: the text moves into a new one (the undo history stays behind).
        const dirty = b.model.getAlternativeVersionId() !== b.clean
        const model = createBufferModel(b.model.getValue(), next)
        const moved: Buffer = { model, revision: b.revision, clean: dirty ? -1 : model.getAlternativeVersionId(), view: b.view }
        watchDirty(next.id, moved)
        buffers.set(next.id, moved)
        buffers.delete(id)
        if (shown.current === id) {
          moved.view = editor.saveViewState()
          editor.setModel(model)
          editor.restoreViewState(moved.view)
          shown.current = next.id
        }
        b.model.dispose()
      }
    })

    // Follow the appearance settings (theme, accent, background).
    const theme = new MutationObserver(applyMonacoTheme)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: APPEARANCE_ATTRIBUTES })
    // Monaco measures glyph widths once; measure again when the bundled font is in.
    void document.fonts?.ready.then(() => monaco.editor.remeasureFonts())

    return () => {
      setBufferHost(null)
      setEditorActions(null)
      actions.forEach((a) => a.dispose())
      detachGutter()
      detachBreakpoints()
      unsubscribePrefs()
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
      const model = createBufferModel(text, tab)
      const created: Buffer = { model, revision: tab.revision, clean: model.getAlternativeVersionId(), view: null }
      watchDirty(tab.id, created)
      buffers.set(tab.id, created)
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

  // A search result asked for a line: scroll there once its tab is on screen.
  const reveal = useEditor((s) => s.reveal)
  useEffect(() => {
    if (!reveal || reveal.id !== shown.current) return
    const editor = editorRef.current!
    editor.revealLineInCenter(reveal.line)
    editor.setPosition({ lineNumber: reveal.line, column: 1 })
    editor.focus()
    useEditor.setState({ reveal: undefined })
  }, [reveal, tab?.id, text === undefined])

  return <div ref={hostRef} className="absolute inset-0" />
}
