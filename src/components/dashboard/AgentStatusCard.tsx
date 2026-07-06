import type { Agent } from '@/types'
import { StatusDot, toneFromState } from '@/components/ui/StatusDot'

const STATE_LABEL: Record<Agent['state'], string> = {
  online: 'ONLINE',
  standby: 'STANDBY',
  idle: 'IDLE',
  offline: 'OFFLINE'
}

/** Compact card for a (future) agent. Everything here is placeholder state. */
export function AgentStatusCard({ agent }: { agent: Agent }) {
  const Icon = agent.icon
  const tone = toneFromState(agent.state)
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-hud/50 bg-surface/40 p-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-hud/60 bg-elevated/60 text-cyan">
        <Icon size={16} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[12px] font-semibold tracking-wide text-text-primary">
            {agent.name}
          </span>
          <span className="flex items-center gap-1">
            <StatusDot tone={tone} pulse={agent.state === 'online'} />
            <span className="font-mono text-[9px] text-text-muted">{STATE_LABEL[agent.state]}</span>
          </span>
        </div>
        <div className="mt-0.5 font-sans text-[11px] text-text-muted">{agent.role}</div>
        {/* load bar */}
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan to-blue"
            style={{ width: `${Math.round(agent.load * 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}
