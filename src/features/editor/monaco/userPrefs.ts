import { WORKBENCH_COMMANDS, type EditorKeybinding, type Snippet } from '@shared/types/migrate'
import { isMac } from '@/lib/platform'
import { monaco } from './setup'
import { parseKeybinding, type KeyStroke } from '../keys'
import { useEditorPrefs } from '../prefs'

const K = monaco.KeyCode
const KEYS: Record<string, monaco.KeyCode> = {
  enter: K.Enter,
  escape: K.Escape,
  tab: K.Tab,
  space: K.Space,
  backspace: K.Backspace,
  delete: K.Delete,
  up: K.UpArrow,
  down: K.DownArrow,
  left: K.LeftArrow,
  right: K.RightArrow,
  home: K.Home,
  end: K.End,
  pageup: K.PageUp,
  pagedown: K.PageDown,
  insert: K.Insert,
  '/': K.Slash,
  '\\': K.Backslash,
  '[': K.BracketLeft,
  ']': K.BracketRight,
  ';': K.Semicolon,
  "'": K.Quote,
  ',': K.Comma,
  '.': K.Period,
  '-': K.Minus,
  '=': K.Equal,
  '`': K.Backquote
}

/** A key stroke as Monaco's number; null for keys Monaco can't bind. */
export function monacoKey(stroke: KeyStroke, mac = isMac): number | null {
  const key = stroke.key
  const code = /^[a-z]$/.test(key)
    ? K[`Key${key.toUpperCase()}` as keyof typeof K]
    : /^\d$/.test(key)
      ? K[`Digit${key}` as keyof typeof K]
      : /^f\d{1,2}$/.test(key)
        ? K[key.toUpperCase() as keyof typeof K]
        : KEYS[key]
  if (code === undefined) return null
  // Monaco: CtrlCmd is ⌘ on a Mac and Ctrl elsewhere; WinCtrl the other one.
  const M = monaco.KeyMod
  return (
    (code as number) |
    (stroke.cmd ? (mac ? M.CtrlCmd : M.WinCtrl) : 0) |
    (stroke.ctrl ? (mac ? M.WinCtrl : M.CtrlCmd) : 0) |
    (stroke.shift ? M.Shift : 0) |
    (stroke.alt ? M.Alt : 0)
  )
}

/** The user's keybindings for Monaco's own commands (workbench commands go through the editor view). */
export function editorRules(bindings: EditorKeybinding[], mac = isMac): monaco.editor.IKeybindingRule[] {
  return bindings.flatMap((b) => {
    if (b.command in WORKBENCH_COMMANDS) return []
    const strokes = parseKeybinding(b.key)
    const codes = strokes?.map((s) => monacoKey(s, mac))
    if (!codes || codes.some((c) => c === null)) return []
    const keybinding = codes.length === 2 ? monaco.KeyMod.chord(codes[0]!, codes[1]!) : codes[0]!
    return [{ keybinding, command: b.command, when: b.when ?? null }]
  })
}

/** Snippet suggestions for a language (its own and the global ones). */
export function snippetSuggestions(snippets: Snippet[], language: string, range: monaco.IRange): monaco.languages.CompletionItem[] {
  return snippets
    .filter((s) => s.language === language || s.language === '*')
    .map((s) => ({
      label: { label: s.prefix, description: s.description ?? s.name },
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText: s.body,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: { value: `\`\`\`\n${s.body}\n\`\`\`` },
      detail: s.name,
      range
    }))
}

let applied: monaco.IDisposable | undefined
let registered = false

/**
 * The user's keybindings and snippets (moved over from VS Code / Cursor) in
 * Monaco — applied now and again whenever they change.
 */
export function setupUserPrefs(): void {
  if (registered) return
  registered = true
  const apply = (bindings: EditorKeybinding[] = []) => {
    applied?.dispose()
    applied = monaco.editor.addKeybindingRules(editorRules(bindings))
  }
  apply(useEditorPrefs.getState().settings.keybindings)
  useEditorPrefs.subscribe((s, prev) => {
    if (s.settings.keybindings !== prev.settings.keybindings) apply(s.settings.keybindings)
  })
  // One provider per language: Monaco doesn't ask providers registered for '*'.
  const provider: monaco.languages.CompletionItemProvider = {
    provideCompletionItems(model, position) {
      const snippets = useEditorPrefs.getState().snippets
      if (!snippets.length) return { suggestions: [] }
      const word = model.getWordUntilPosition(position)
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
      return { suggestions: snippetSuggestions(snippets, model.getLanguageId(), range) }
    }
  }
  for (const { id } of monaco.languages.getLanguages()) monaco.languages.registerCompletionItemProvider(id, provider)
}
