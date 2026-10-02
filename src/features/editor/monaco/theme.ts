import type { editor } from 'monaco-editor'
import { cssRgb } from '@/lib/tokens'

/**
 * Monaco theme from the current W-ONE tokens (dark or light). The editor
 * background stays transparent so the HUD panel shows through, like the
 * terminal; syntax colors map to the accent palette.
 */
export function monacoTheme(): editor.IStandaloneThemeData {
  const light = document.documentElement.dataset.theme === 'light'
  const text = cssRgb('--text-primary', '#e2ecf7')
  const secondary = cssRgb('--text-secondary', '#96a8bd')
  const muted = cssRgb('--text-muted', '#607085')
  const cyan = cssRgb('--accent-cyan', '#38d6e8')
  const blue = cssRgb('--accent-blue', '#4a84ff')
  const purple = cssRgb('--accent-purple', '#9e7aff')
  const amber = cssRgb('--accent-amber', '#f5bf60')
  const green = cssRgb('--accent-green', '#60dc96')
  const danger = cssRgb('--accent-danger', '#ff6070')
  const panel = cssRgb('--bg-panel', '#0c111a')
  const elevated = cssRgb('--bg-elevated', '#111824')
  const border = cssRgb('--border-hud', '#2a3c54')
  const fg = (hex: string) => hex.slice(1)

  return {
    base: light ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: fg(text) },
      { token: 'comment', foreground: fg(muted), fontStyle: 'italic' },
      { token: 'keyword', foreground: fg(purple) },
      { token: 'string', foreground: fg(green) },
      { token: 'string.key.json', foreground: fg(blue) },
      { token: 'string.value.json', foreground: fg(green) },
      { token: 'number', foreground: fg(amber) },
      { token: 'regexp', foreground: fg(danger) },
      { token: 'type', foreground: fg(cyan) },
      { token: 'type.identifier', foreground: fg(cyan) },
      { token: 'tag', foreground: fg(blue) },
      { token: 'attribute.name', foreground: fg(cyan) },
      { token: 'attribute.value', foreground: fg(green) },
      { token: 'delimiter', foreground: fg(secondary) },
      { token: 'variable', foreground: fg(text) },
      { token: 'constant', foreground: fg(amber) }
    ],
    colors: {
      'editor.background': '#00000000',
      'editor.foreground': text,
      'editorLineNumber.foreground': `${muted}b3`,
      'editorLineNumber.activeForeground': secondary,
      'editorCursor.foreground': cyan,
      'editor.selectionBackground': `${cyan}33`,
      'editor.inactiveSelectionBackground': `${cyan}1a`,
      'editor.lineHighlightBackground': `${elevated}99`,
      'editor.lineHighlightBorder': '#00000000',
      'editor.findMatchBackground': `${amber}66`,
      'editor.findMatchHighlightBackground': `${amber}33`,
      'editorBracketMatch.background': `${cyan}1a`,
      'editorBracketMatch.border': `${cyan}80`,
      'editorBracketHighlight.foreground1': amber,
      'editorBracketHighlight.foreground2': purple,
      'editorBracketHighlight.foreground3': blue,
      'editorIndentGuide.background1': `${border}80`,
      'editorIndentGuide.activeBackground1': border,
      'editorWidget.background': elevated,
      'editorWidget.border': border,
      'editorSuggestWidget.background': elevated,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.selectedBackground': `${cyan}26`,
      'editorHoverWidget.background': elevated,
      'editorHoverWidget.border': border,
      'editorStickyScroll.background': panel,
      'editorGutter.background': '#00000000',
      'minimap.background': '#00000000',
      // Without its own color the overview ruler paints the token background — opaque black.
      'editorOverviewRuler.background': '#00000000',
      'editorOverviewRuler.border': '#00000000',
      'scrollbarSlider.background': `${border}66`,
      'scrollbarSlider.hoverBackground': `${border}99`,
      'scrollbarSlider.activeBackground': `${border}cc`,
      'input.background': panel,
      'input.border': border,
      focusBorder: `${cyan}80`
    }
  }
}
