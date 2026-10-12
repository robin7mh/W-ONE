import { create } from 'zustand'
import { ipc } from '@shared/ipc/client'
import type { EditorSettings, Snippet } from '@shared/types/migrate'

/** The editor's own font always stays as the fallback. */
const FONT = "'JetBrains Mono', ui-monospace, monospace"

/** Monaco options for the user's editor settings (only what was set — the rest keeps W-ONE's defaults). */
export function monacoOptions(s: EditorSettings): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  if (s.fontSize !== undefined) o.fontSize = s.fontSize
  if (s.fontFamily !== undefined) o.fontFamily = `${s.fontFamily}, ${FONT}`
  if (s.fontLigatures !== undefined) o.fontLigatures = s.fontLigatures
  if (s.lineHeight !== undefined) o.lineHeight = s.lineHeight
  if (s.tabSize !== undefined) o.tabSize = s.tabSize
  if (s.insertSpaces !== undefined) o.insertSpaces = s.insertSpaces
  if (s.wordWrap !== undefined) o.wordWrap = s.wordWrap
  if (s.wordWrapColumn !== undefined) o.wordWrapColumn = s.wordWrapColumn
  if (s.minimap !== undefined) o.minimap = { enabled: s.minimap }
  if (s.lineNumbers !== undefined) o.lineNumbers = s.lineNumbers
  if (s.renderWhitespace !== undefined) o.renderWhitespace = s.renderWhitespace
  if (s.cursorStyle !== undefined) o.cursorStyle = s.cursorStyle
  if (s.cursorBlinking !== undefined) o.cursorBlinking = s.cursorBlinking
  if (s.rulers !== undefined) o.rulers = s.rulers
  if (s.stickyScroll !== undefined) o.stickyScroll = { enabled: s.stickyScroll }
  if (s.smoothScrolling !== undefined) o.smoothScrolling = s.smoothScrolling
  if (s.bracketPairColorization !== undefined) o.bracketPairColorization = { enabled: s.bracketPairColorization }
  return o
}

interface PrefsState {
  settings: EditorSettings
  snippets: Snippet[]
  /** Fetch them from the core (on start, and after moving over from VS Code). */
  load: () => Promise<void>
}

/** The editor's preferences, keybindings and snippets — as moved over from VS Code / Cursor. */
export const useEditorPrefs = create<PrefsState>((set) => ({
  settings: {},
  snippets: [],
  load: async () => {
    const prefs = await ipc('editor:settings').catch(() => null)
    if (prefs) set(prefs)
  }
}))
