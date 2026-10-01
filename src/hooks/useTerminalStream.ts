import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
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

/**
 * Owns an xterm instance in `containerRef` and prints the banner. Display-only
 * — no shell is attached. To make it real, pipe node-pty output here (see README).
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
      theme: {
        background: '#00000000',
        foreground: cssRgb('--text-secondary', '#96a8bd'),
        cursor: cssRgb('--accent-cyan', '#38d6e8'),
        cursorAccent: '#04060b',
        selectionBackground: 'rgba(56,214,232,0.25)'
      }
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

    return () => {
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [containerRef])
}
