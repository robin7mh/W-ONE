import { Check, Loader2, Clock } from 'lucide-react'
import { TechLabel } from '@/components/ui/TechLabel'
import { RECENT_COMMANDS } from '@/data/mockProcesses'
import type { CommandEntry } from '@/types'

function StatusIcon({ status }: { status: CommandEntry['status'] }) {
  if (status === 'done') return <Check size={12} className="text-[rgb(96_220_150)]" />
  if (status === 'active') return <Loader2 size={12} className="animate-spin text-cyan" />
  return <Clock size={12} className="text-text-muted" />
}

/** Recent / queued commands — a mini timeline. Placeholder data. */
export function CommandTimeline() {
  return (
    <div className="flex h-full flex-col rounded-md border border-hud/50 bg-surface/40 p-3">
      <TechLabel className="text-text-secondary">Command Timeline</TechLabel>
      <ul className="mt-2.5 space-y-2">
        {RECENT_COMMANDS.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <StatusIcon status={c.status} />
            <span className="w-9 shrink-0 font-mono text-[10px] text-text-muted">{c.time}</span>
            <code
              className={
                c.status === 'queued'
                  ? 'flex-1 truncate font-mono text-[11px] text-text-muted'
                  : 'flex-1 truncate font-mono text-[11px] text-text-secondary'
              }
            >
              {c.command}
            </code>
          </li>
        ))}
      </ul>
    </div>
  )
}
