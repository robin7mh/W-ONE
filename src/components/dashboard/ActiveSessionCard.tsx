import { Radio, Clock3, Boxes } from 'lucide-react'
import { TechLabel } from '@/components/ui/TechLabel'
import { StatusDot } from '@/components/ui/StatusDot'
import { formatUptime } from '@/lib/format'

/** Active session summary. Uptime is live; the rest is static context. */
export function ActiveSessionCard({ uptime }: { uptime: number }) {
  return (
    <div className="flex h-full flex-col rounded-md border border-hud/50 bg-surface/40 p-3">
      <div className="flex items-center justify-between">
        <TechLabel className="text-text-secondary">Active Session</TechLabel>
        <span className="flex items-center gap-1.5">
          <StatusDot tone="ok" />
          <span className="font-mono text-[10px] text-text-muted">LIVE</span>
        </span>
      </div>

      <div className="mt-2 font-mono text-lg font-semibold text-text-primary text-glow-cyan">
        W1-7F3A
      </div>

      <div className="mt-3 space-y-1.5">
        <Row icon={Radio} label="Channel" value="LOCAL" />
        <Row icon={Clock3} label="Uptime" value={formatUptime(uptime)} />
        <Row icon={Boxes} label="Context" value="4 agents · 1 vault" />
      </div>
    </div>
  )
}

function Row({
  icon: Icon,
  label,
  value
}: {
  icon: typeof Radio
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={13} className="text-text-muted" />
      <span className="tech-label flex-1 text-text-muted">{label}</span>
      <span className="font-mono text-[11px] text-text-secondary">{value}</span>
    </div>
  )
}
