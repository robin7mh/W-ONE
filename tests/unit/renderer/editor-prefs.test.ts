import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installBridge } from './bridge'

const flags = vi.hoisted(() => ({ mac: true }))
vi.mock('@/lib/platform', () => ({
  get isMac() {
    return flags.mac
  }
}))

const mon = vi.hoisted(() => {
  const KeyCode: Record<string, number> = { Enter: 3, Escape: 9, Tab: 2, Space: 10, Backspace: 1, Delete: 20, UpArrow: 16, DownArrow: 18, LeftArrow: 15, RightArrow: 17, Home: 14, End: 13, PageUp: 11, PageDown: 12, Insert: 19, Slash: 90, Backslash: 93, BracketLeft: 92, BracketRight: 94, Semicolon: 85, Quote: 95, Comma: 87, Period: 89, Minus: 88, Equal: 86, Backquote: 91 }
  'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => (KeyCode[`Key${c.toUpperCase()}`] = 31 + i))
  for (let d = 0; d <= 9; d += 1) KeyCode[`Digit${d}`] = 21 + d
  for (let f = 1; f <= 19; f += 1) KeyCode[`F${f}`] = 58 + f
  const state = {
    rules: [] as unknown[][],
    disposed: 0,
    providers: [] as { lang: string; provider: { provideCompletionItems: (m: unknown, p: unknown) => { suggestions: unknown[] } } }[]
  }
  class Range {
    constructor(
      public a: number,
      public b: number,
      public c: number,
      public d: number
    ) {}
  }
  const monaco = {
    KeyCode,
    KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512, WinCtrl: 256, chord: (a: number, b: number) => a * 65536 + b },
    Range,
    editor: {
      addKeybindingRules: (rules: unknown[]) => {
        state.rules.push(rules)
        return { dispose: () => (state.disposed += 1) }
      }
    },
    languages: {
      CompletionItemKind: { Snippet: 27 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      getLanguages: () => [{ id: 'javascript' }, { id: 'python' }],
      registerCompletionItemProvider: (lang: string, provider: never) => state.providers.push({ lang, provider })
    }
  }
  return { state, monaco }
})
vi.mock('@/features/editor/monaco/setup', () => ({ monaco: mon.monaco }))

import { eventKey, matchesStroke, parseKeybinding } from '@/features/editor/keys'
import { monacoOptions, useEditorPrefs } from '@/features/editor/prefs'
import { useLanguages } from '@/features/editor/languages'
import { editorRules, missingImports, monacoKey, setupUserPrefs, snippetSuggestions } from '@/features/editor/monaco/userPrefs'
import { MUI_SNIPPETS } from '@/features/editor/snippets/mui'

beforeEach(() => {
  useEditorPrefs.setState({ settings: {}, snippets: [] })
})

describe('keybindings in VS Code’s notation', () => {
  it('parses modifiers, keys and chords; refuses what isn’t one', () => {
    expect(parseKeybinding('cmd+shift+p')).toEqual([{ cmd: true, ctrl: false, shift: true, alt: false, key: 'p' }])
    expect(parseKeybinding('Ctrl+K  Ctrl+C')).toEqual([
      { cmd: false, ctrl: true, shift: false, alt: false, key: 'k' },
      { cmd: false, ctrl: true, shift: false, alt: false, key: 'c' }
    ])
    expect(parseKeybinding('win+option+f5')).toEqual([{ cmd: true, ctrl: false, shift: false, alt: true, key: 'f5' }])
    expect(parseKeybinding('meta+alt+/')![0]).toMatchObject({ cmd: true, alt: true, key: '/' })
    expect(parseKeybinding('ctrl++')).toEqual([{ cmd: false, ctrl: true, shift: false, alt: false, key: '+' }])
    expect(parseKeybinding('')).toBeNull()
    expect(parseKeybinding('a b c')).toBeNull()
    expect(parseKeybinding('hyper+x')).toBeNull()
    expect(parseKeybinding('ctrl+')).toBeNull()
  })

  it('reads keyboard events layout-proof and matches strokes', () => {
    expect(eventKey({ key: 'ß', code: 'KeyS' })).toBe('s')
    expect(eventKey({ key: '!', code: 'Digit1' })).toBe('1')
    expect(eventKey({ key: 'ArrowUp', code: 'ArrowUp' })).toBe('up')
    expect(eventKey({ key: ' ', code: 'Space' })).toBe('space')
    expect(eventKey({ key: 'F5', code: 'F5' })).toBe('f5')
    const stroke = parseKeybinding('cmd+shift+o')![0]
    const e = { key: 'O', code: 'KeyO', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }
    expect(matchesStroke(stroke, e)).toBe(true)
    expect(matchesStroke(stroke, { ...e, altKey: true })).toBe(false)
    expect(matchesStroke(stroke, { ...e, code: 'KeyP', key: 'p' })).toBe(false)
  })

  it('becomes Monaco keybindings: ⌘ and Ctrl swap meaning off the Mac; unknown keys are skipped', () => {
    const M = mon.monaco.KeyMod
    const K = mon.monaco.KeyCode
    const [cmdK] = parseKeybinding('cmd+k')!
    expect(monacoKey(cmdK, true)).toBe(K.KeyK | M.CtrlCmd)
    expect(monacoKey(cmdK, false)).toBe(K.KeyK | M.WinCtrl)
    const [ctrlShiftAlt1] = parseKeybinding('ctrl+shift+alt+1')!
    expect(monacoKey(ctrlShiftAlt1, true)).toBe(K.Digit1 | M.WinCtrl | M.Shift | M.Alt)
    expect(monacoKey(ctrlShiftAlt1, false)).toBe(K.Digit1 | M.CtrlCmd | M.Shift | M.Alt)
    expect(monacoKey(parseKeybinding('f12')![0])).toBe(K.F12)
    expect(monacoKey(parseKeybinding('pageup')![0])).toBe(K.PageUp)
    expect(monacoKey(parseKeybinding('numpad_add')![0])).toBeNull()

    expect(
      editorRules(
        [
          { key: 'cmd+k cmd+c', command: 'editor.action.commentLine', when: 'editorTextFocus' },
          { key: 'cmd+d', command: 'editor.action.copyLinesDownAction' },
          { key: 'cmd+shift+o', command: 'workbench.action.quickOpen' }, // the editor view handles these
          { key: 'cmd+numpad_add', command: 'editor.action.fontZoomIn' },
          { key: 'bogus+x', command: 'editor.action.x' }
        ],
        true
      )
    ).toEqual([
      { keybinding: M.chord(K.KeyK | M.CtrlCmd, K.KeyC | M.CtrlCmd), command: 'editor.action.commentLine', when: 'editorTextFocus' },
      { keybinding: K.KeyD | M.CtrlCmd, command: 'editor.action.copyLinesDownAction', when: null }
    ])
  })
})

describe('editor settings and snippets', () => {
  it('turn into Monaco options — only what was set; the bundled font stays the fallback', () => {
    expect(monacoOptions({})).toEqual({})
    expect(
      monacoOptions({
        fontSize: 15,
        fontFamily: 'Fira Code',
        fontLigatures: true,
        lineHeight: 22,
        tabSize: 2,
        insertSpaces: false,
        wordWrap: 'on',
        wordWrapColumn: 100,
        minimap: false,
        lineNumbers: 'relative',
        renderWhitespace: 'all',
        cursorStyle: 'block',
        cursorBlinking: 'solid',
        rulers: [80],
        stickyScroll: false,
        smoothScrolling: false,
        bracketPairColorization: true
      })
    ).toEqual({
      fontSize: 15,
      fontFamily: "Fira Code, 'JetBrains Mono', ui-monospace, monospace",
      fontLigatures: true,
      lineHeight: 22,
      tabSize: 2,
      insertSpaces: false,
      wordWrap: 'on',
      wordWrapColumn: 100,
      minimap: { enabled: false },
      lineNumbers: 'relative',
      renderWhitespace: 'all',
      cursorStyle: 'block',
      cursorBlinking: 'solid',
      rulers: [80],
      stickyScroll: { enabled: false },
      smoothScrolling: false,
      bracketPairColorization: { enabled: true }
    })
  })

  it('load from the core; a core that can’t answer keeps what was there', async () => {
    installBridge({ 'editor:settings': () => ({ settings: { fontSize: 18 }, snippets: [{ name: 'n', language: '*', prefix: 'p', body: 'b' }] }) })
    await useEditorPrefs.getState().load()
    expect(useEditorPrefs.getState()).toMatchObject({ settings: { fontSize: 18 }, snippets: [{ prefix: 'p' }] })
    installBridge({ 'editor:settings': () => Promise.reject(new Error('down')) })
    await useEditorPrefs.getState().load()
    expect(useEditorPrefs.getState().settings).toEqual({ fontSize: 18 })
  })

  it('snippets of the language and the global ones become suggestions', () => {
    const range = new mon.monaco.Range(1, 1, 1, 3) as never
    const items = snippetSuggestions(
      [
        { name: 'Log', language: 'javascript', prefix: 'log', body: 'console.log($1)' },
        { name: 'Todo', language: '*', prefix: 'todo', body: 'TODO', description: 'a note' },
        { name: 'Py', language: 'python', prefix: 'def', body: 'def $1():' }
      ],
      'javascript',
      range
    )
    expect(items).toEqual([
      { label: { label: 'log', description: 'Log' }, kind: 27, insertText: 'console.log($1)', insertTextRules: 4, documentation: { value: '```\nconsole.log($1)\n```' }, detail: 'Log', range },
      expect.objectContaining({ label: { label: 'todo', description: 'a note' } })
    ])
  })

  it('snippets bring the imports they need — only the missing ones', () => {
    const imports = { from: '@mui/material', names: ['Button', 'Box', 'Stack'] }
    expect(missingImports('', imports)).toEqual(['Button', 'Box', 'Stack'])
    expect(missingImports("import { Button, Box as B } from '@mui/material'\nimport { Stack } from 'other'\nimport type { Stack as S } from \"@mui/material\"", imports)).toEqual([])
    expect(missingImports("import { Button } from '@mui/material'", imports)).toEqual(['Box', 'Stack'])
    const range = new mon.monaco.Range(3, 1, 3, 4) as never
    const [withImport] = snippetSuggestions([{ name: 'b', language: 'typescript', prefix: 'muiButton', body: '<Button />', imports: { from: '@mui/material', names: ['Button'] } }], 'typescript', range, '')
    expect(withImport.additionalTextEdits).toEqual([{ range: new mon.monaco.Range(1, 1, 1, 1), text: "import { Button } from '@mui/material'\n" }])
    const [already] = snippetSuggestions([{ name: 'b', language: 'typescript', prefix: 'muiButton', body: '<Button />', imports: { from: '@mui/material', names: ['Button'] } }], 'typescript', range, "import { Button } from '@mui/material'")
    expect(already.additionalTextEdits).toBeUndefined()
    // Every MUI snippet in both languages, each with what it imports.
    expect(MUI_SNIPPETS).toHaveLength(126)
    expect(new Set(MUI_SNIPPETS.map((m) => m.prefix)).size).toBe(63)
    expect(MUI_SNIPPETS.every((m) => m.imports!.names.length > 0)).toBe(true)
  })

  it('setup applies keybindings now and when they change; one snippet provider per language', () => {
    useEditorPrefs.setState({ settings: { keybindings: [{ key: 'cmd+d', command: 'editor.action.x' }] } })
    setupUserPrefs()
    setupUserPrefs() // once
    expect(mon.state.rules).toHaveLength(1)
    expect(mon.state.providers.map((p) => p.lang)).toEqual(['javascript', 'python'])
    act(() => useEditorPrefs.setState({ settings: { keybindings: [] } }))
    expect(mon.state.rules).toHaveLength(2)
    expect(mon.state.disposed).toBe(1)
    act(() => useEditorPrefs.setState({ snippets: [] })) // keybindings unchanged
    expect(mon.state.rules).toHaveLength(2)
    act(() => useEditorPrefs.setState({ settings: {} })) // none at all
    expect(mon.state.rules.at(-1)).toEqual([])

    const { provider } = mon.state.providers[0]
    const model = { getWordUntilPosition: () => ({ startColumn: 1, endColumn: 3 }), getLanguageId: () => 'javascript', getValue: () => '' }
    // Mindeck's own MUI snippets are always there for JavaScript / TypeScript.
    expect(provider.provideCompletionItems(model, { lineNumber: 1, column: 3 }).suggestions).toHaveLength(MUI_SNIPPETS.length / 2)
    act(() => useEditorPrefs.setState({ snippets: [{ name: 'Log', language: 'javascript', prefix: 'log', body: 'x' }] }))
    expect(provider.provideCompletionItems(model, { lineNumber: 1, column: 3 }).suggestions).toHaveLength(MUI_SNIPPETS.length / 2 + 1)
  })
})

describe('languages of open files', () => {
  it('reports, forgets and counts installs', () => {
    useLanguages.getState().report('p:a.py', { language: 'python', available: false })
    expect(useLanguages.getState().files['p:a.py']).toEqual({ language: 'python', available: false })
    useLanguages.getState().forget('p:a.py')
    expect(useLanguages.getState().files).toEqual({})
    const before = useLanguages.getState().toolsVersion
    useLanguages.getState().toolsChanged()
    expect(useLanguages.getState().toolsVersion).toBe(before + 1)
  })
})
