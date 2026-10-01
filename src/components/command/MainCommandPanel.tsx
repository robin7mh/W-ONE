import { useState } from 'react'
import { ChevronRight, Circle, Zap } from 'lucide-react'
import { Panel } from '@/components/ui/Panel'
import { TerminalPanel } from './TerminalPanel'
import { StatusDot } from '@/components/ui/StatusDot'
import { TechLabel } from '@/components/ui/TechLabel'

/**
 * Center stage: a status header, the xterm terminal, and a styled command input.
 * The input is decorative — it echoes locally but executes nothing. Later this
 * becomes the seam for agent conversation / real command dispatch (see README).
 */
export function MainCommandPanel({ active }: { active: boolean }) {
  const [value, setValue] = useState('')

  return (
    <Panel
      title="Command Interface"
      corners
      flush
      className="min-h-0 flex-1"
      headerRight={
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1.5 md:flex">
            <TechLabel className="text-text-muted">Model</TechLabel>
            <span className="font-mono text-[11px] text-text-secondary">w-one · local</span>
          </span>
          <span className="hidden items-center gap-1.5 sm:flex">
            <Zap size={12} className="text-cyan" />
            <span className="font-mono text-[11px] text-text-secondary">3ms</span>
          </span>
          <span className="flex items-center gap-1.5">
            <StatusDot tone="ok" />
            <span className="font-mono text-[10px] text-text-muted">ONLINE</span>
          </span>
        </div>
      }
      bodyClassName="flex flex-col"
    >
      {/* sub-header strip */}
      <div className="flex items-center gap-2 border-b border-hud/50 px-3 py-1.5">
        <Circle size={7} className="fill-cyan text-cyan" />
        <span className="font-mono text-[11px] text-text-secondary">
          session <span className="text-cyan">W1-7F3A</span>
        </span>
        <span className="mx-1 h-3 w-px bg-hud/60" />
        <span className="font-mono text-[11px] text-text-muted">display-only shell · no execution</span>
      </div>

      <TerminalPanel active={active} />

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
