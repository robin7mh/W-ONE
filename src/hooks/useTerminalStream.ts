import { useEffect, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { BANNER } from '@/data/terminalLines'

/** Reads a CSS variable (space-separated RGB) as a hex color for xterm's theme. */
function cssRgb(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  if (!raw) return fallback
  const [r, g, b] = raw.split(/\s+/).map(Number)
  if ([r, g, b].some((n) => Number.isNaN(n))) return fallback
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

/** xterm theme from the current tokens; ANSI slots map to the HUD accents. */
function themeFromTokens(): ITheme {
  const cyan = cssRgb('--accent-cyan', '#38d6e8')
  return {
    background: '#00000000',
    foreground: cssRgb('--text-secondary', '#96a8bd'),
    cursor: cyan,
    cursorAccent: cssRgb('--bg-void', '#04060b'),
    selectionBackground: `${cyan}40`,
    cyan,
    blue: cssRgb('--accent-blue', '#4a84ff'),
    magenta: cssRgb('--accent-purple', '#9e7aff'),
    green: cssRgb('--accent-green', '#60dc96'),
    yellow: cssRgb('--accent-amber', '#f5bf60'),
    red: cssRgb('--accent-danger', '#ff6070'),
    brightBlack: cssRgb('--text-muted', '#607085'),
    brightWhite: cssRgb('--text-primary', '#e2ecf7')
  }
}

/**
 * Owns an xterm instance in `containerRef` and prints the banner. Display-only
 * — no shell is attached. To make it real, pipe node-pty output here (see README).
 * Re-themes live when the app switches between dark and light.
 */
export function useTerminalStream(containerRef: React.RefObject<HTMLDivElement>): void {
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  // Create the terminal once the container exists.
  useEffect(() => {
    const el = containerRef.current
    if (!el || termRef.current) return

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      fontSize: 12.5,
      lineHeight: 1.35,
      letterSpacing: 0.4,
      scrollback: 800,
      theme: themeFromTokens()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    try {
      fit.fit()
    } catch {
      /* container not measured yet — resize observer will retry */
    }

    BANNER.forEach((l) => term.writeln(l))

    termRef.current = term
    fitRef.current = fit

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* ignore transient 0-size */
      }
    })
    ro.observe(el)

    const mo = new MutationObserver(() => {
      term.options.theme = themeFromTokens()
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      ro.disconnect()
      mo.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [containerRef])
}
