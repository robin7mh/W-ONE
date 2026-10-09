import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useTerminals, type TerminalTab } from '../store'
import { getT, useT } from '@/lib/i18n'
import { useXterm } from '../useXterm'

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
 * One terminal tab's view (see useXterm). Stays mounted while hidden or
 * re-positioned (layout changes only move its box), so nothing is lost when
 * switching tabs or layouts. An exited shell restarts on Enter.
 */
export function XtermPane({ tab, label, active, visible, box, framed }: PaneProps) {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const { termRef, fitRef } = useXterm(hostRef, tab.id, tab.exitCode !== undefined, {
    onExit: (exitCode) => {
      useTerminals.getState().markExited(tab.id, exitCode)
      return `\r\n\x1b[90m[${getT().terminal.exited(exitCode)}]\x1b[0m\r\n`
    },
    onInputAfterExit: (data) => {
      if (data === '\r') void useTerminals.getState().restart(tab.id)
    }
  })

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
              aria-label={t.terminal.close(label)}
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
