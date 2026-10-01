import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ipc, onEvent } from '@shared/ipc/client'
import type { TerminalData } from '@shared/types/terminal'
import { cn } from '@/lib/cn'
import { useTerminals, type TerminalTab } from '../store'
import { themeFromTokens } from '../theme'

interface PaneProps {
  tab: TerminalTab
  /** Tab label (numbered when titles repeat). */
  label: string
  /** Has keyboard focus (single layout: the shown tab; split: the outlined pane). */
  active: boolean
  /** Shown at all — background tabs stay mounted but invisible. */
  visible: boolean
  /** Position inside the pane area (percentages); split layouts only. */
  box?: React.CSSProperties
  /** Split layouts: frame + slim header with title, folder and close. */
  framed: boolean
}

/**
 * One xterm.js view bound to one main-process PTY session. Stays mounted while
 * hidden or re-positioned (layout changes only move its box), so nothing is
 * lost when switching tabs or layouts. On mount it attaches to the session's
 * scrollback, then appends live output — `end` offsets prevent duplicates.
 */
export function XtermPane({ tab, label, active, visible, box, framed }: PaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const exitedRef = useRef(tab.exitCode !== undefined)

  useEffect(() => {
    const el = hostRef.current!
    const id = tab.id
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      macOptionIsMeta: true,
      allowTransparency: true,
      theme: themeFromTokens()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // URLs are clickable; main routes window.open to the OS browser.
    term.loadAddon(new WebLinksAddon((_event, uri) => void window.open(uri, '_blank')))
    term.open(el)
    termRef.current = term
    fitRef.current = fit

    let attachedEnd: number | null = null
    const queued: TerminalData[] = []
    const show = (d: TerminalData) => {
      if (attachedEnd === null) {
        queued.push(d)
        return
      }
      const start = d.end - d.data.length
      if (d.end <= attachedEnd) return
      term.write(start < attachedEnd ? d.data.slice(attachedEnd - start) : d.data)
    }
    const flushQueue = () => queued.splice(0).forEach(show)

    const offData = onEvent('terminal:data', (d) => d.id === id && show(d))
    const offExit = onEvent('terminal:exit', (e) => {
      if (e.id !== id) return
      exitedRef.current = true
      useTerminals.getState().markExited(id, e.exitCode)
      term.write(`\r\n\x1b[90m[process exited with code ${e.exitCode} — press Enter to restart]\x1b[0m\r\n`)
    })

    ipc('terminal:attach', { id })
      .then(({ buffer, end }) => {
        term.write(buffer)
        attachedEnd = end
        flushQueue()
      })
      .catch(() => {
        attachedEnd = 0
        flushQueue()
      })

    const input = term.onData((data) => {
      if (exitedRef.current) {
        if (data === '\r') void useTerminals.getState().restart(id)
        return
      }
      void ipc('terminal:write', { id, data }).catch(() => {})
    })
    const resized = term.onResize(({ cols, rows }) => {
      if (!exitedRef.current) void ipc('terminal:resize', { id, cols, rows }).catch(() => {})
    })

    // Hidden module (display:none) has no size — fit only when measurable.
    const doFit = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        try {
          fit.fit()
        } catch {
          /* renderer not ready yet */
        }
      }
    }
    const ro = new ResizeObserver(doFit)
    ro.observe(el)
    doFit()

    const mo = new MutationObserver(() => {
      term.options.theme = themeFromTokens()
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      offData()
      offExit()
      input.dispose()
      resized.dispose()
      ro.disconnect()
      mo.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [tab.id])

  useEffect(() => {
    if (!active) return
    const raf = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
      } catch {
        /* not measurable yet */
      }
      termRef.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [active])

  const focus = () => {
    if (!active) useTerminals.getState().setActive(tab.id)
    termRef.current?.focus()
  }

  // Padding lives on the wrapper: FitAddon measures the host's parent box, so
  // padding on the host itself would count as usable width and clip the text.
  return (
    <div
      style={box}
      className={cn('absolute', box ? 'p-1' : 'inset-0', !visible && 'invisible')}
      onMouseDown={focus}
    >
      <div
        className={cn(
          'flex h-full flex-col overflow-hidden',
          framed && 'rounded-md border transition-colors',
          framed && (active ? 'border-cyan/50' : 'border-hud/50')
        )}
      >
        {framed && (
          <div className="flex h-7 shrink-0 items-center gap-2 border-b border-hud/50 px-2.5">
            <span
              className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tab.exitCode === undefined ? 'bg-green' : 'bg-text-muted')}
            />
            <span className={cn('font-mono text-[11px]', active ? 'text-text-primary' : 'text-text-muted')}>{label}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-muted">
              {tab.cwdLabel !== tab.title && tab.cwdLabel}
            </span>
            <button
              type="button"
              aria-label={`Close ${label}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => void useTerminals.getState().close(tab.id)}
              className="rounded p-0.5 text-text-muted transition-colors hover:bg-elevated hover:text-text-primary"
            >
              <X size={11} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 px-3 py-2">
          <div ref={hostRef} className="h-full w-full" />
        </div>
      </div>
    </div>
  )
}
