import { useState } from 'react'
import { ChevronRight, Circle } from 'lucide-react'
import { Panel } from '@/components/ui/Panel'
import { TerminalPanel } from './TerminalPanel'

/**
 * Center stage: a status header, the xterm terminal, and a styled command input.
 * The input is decorative — it echoes locally but executes nothing. Later this
 * becomes the seam for agent conversation / real command dispatch (see README).
 */
export function MainCommandPanel() {
  const [value, setValue] = useState('')

  return (
    <Panel
      title="Command Interface"
      corners
      flush
      className="min-h-0 flex-1"
      bodyClassName="flex flex-col"
    >
      {/* sub-header strip */}
      <div className="flex items-center gap-2 border-b border-hud/50 px-3 py-1.5">
        <Circle size={7} className="fill-cyan text-cyan" />
        <span className="font-mono text-[11px] text-text-muted">display-only shell · no execution</span>
      </div>

      <TerminalPanel />

      {/* command input line (local echo only) */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setValue('')
        }}
        className="flex items-center gap-2 border-t border-hud/60 bg-surface/40 px-3 py-2.5"
      >
        <span className="font-mono text-sm text-cyan">
          <ChevronRight size={16} className="inline" strokeWidth={2.5} />
        </span>
        <span className="font-mono text-sm text-text-muted">w-one</span>
        <span className="text-text-muted">/</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="type a command…  (UI preview — nothing executes)"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent font-mono text-sm text-text-primary caret-cyan outline-none placeholder:text-text-muted/60"
        />
        <span className="h-4 w-2 animate-pulse bg-cyan/80" />
      </form>
    </Panel>
  )
}
