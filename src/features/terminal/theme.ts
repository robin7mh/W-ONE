import type { ITheme } from '@xterm/xterm'

/** Reads a CSS variable (space-separated RGB) as a hex color for xterm's theme. */
function cssRgb(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  if (!raw) return fallback
  const [r, g, b] = raw.split(/\s+/).map(Number)
  if ([r, g, b].some((n) => Number.isNaN(n))) return fallback
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

/** xterm theme from the current tokens; ANSI slots map to the HUD accents. */
export function themeFromTokens(): ITheme {
  const cyan = cssRgb('--accent-cyan', '#38d6e8')
  return {
    background: '#00000000',
    foreground: cssRgb('--text-primary', '#e2ecf7'),
    cursor: cyan,
    cursorAccent: cssRgb('--bg-void', '#04060b'),
    selectionBackground: `${cyan}40`,
    cyan,
    brightCyan: cyan,
    blue: cssRgb('--accent-blue', '#4a84ff'),
    brightBlue: cssRgb('--accent-blue', '#4a84ff'),
    magenta: cssRgb('--accent-purple', '#9e7aff'),
    brightMagenta: cssRgb('--accent-purple', '#9e7aff'),
    green: cssRgb('--accent-green', '#60dc96'),
    brightGreen: cssRgb('--accent-green', '#60dc96'),
    yellow: cssRgb('--accent-amber', '#f5bf60'),
    brightYellow: cssRgb('--accent-amber', '#f5bf60'),
    red: cssRgb('--accent-danger', '#ff6070'),
    brightRed: cssRgb('--accent-danger', '#ff6070'),
    black: cssRgb('--bg-elevated', '#111824'),
    brightBlack: cssRgb('--text-muted', '#607085'),
    white: cssRgb('--text-secondary', '#96a8bd'),
    brightWhite: cssRgb('--text-primary', '#e2ecf7')
  }
}
