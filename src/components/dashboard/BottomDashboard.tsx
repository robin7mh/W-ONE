import { motion } from 'framer-motion'
import { LayoutGrid } from 'lucide-react'
import { ActiveSessionCard } from './ActiveSessionCard'
import { ObjectiveCard } from './ObjectiveCard'
import { CommandTimeline } from './CommandTimeline'
import { EventLog } from './EventLog'
import { ProjectContextCard } from './ProjectContextCard'
import { AgentStatusCard } from './AgentStatusCard'
import { QuickActionButton } from './QuickActionButton'
import { TechLabel } from '@/components/ui/TechLabel'
import { QUICK_ACTIONS } from '@/data/quickActions'
import { MOCK_AGENTS } from '@/data/mockAgents'

/**
 * The eDEX on-screen keyboard is deliberately replaced by this Agent / Workflow
 * Command Deck — the useful, forward-looking control surface for a Jarvis-style
 * app. A quick-action command strip sits above a responsive grid of context
 * cards. Collapses gracefully: cards wrap and the deck scrolls internally on
 * narrow widths, so there is never horizontal overflow.
 */
export function BottomDashboard({ uptime }: { uptime: number }) {
  return (
    <section className="flex max-h-[48vh] shrink-0 flex-col gap-2.5 border-t border-hud/70 bg-surface/40 px-3 py-2.5 backdrop-blur-sm">
      {/* header + quick-action command strip */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <LayoutGrid size={13} className="text-cyan" />
          <TechLabel className="text-text-secondary">Command Deck</TechLabel>
        </div>
        <div className="ml-auto grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap lg:justify-end">
          {QUICK_ACTIONS.map((a) => (
            <div key={a.id} className="lg:w-[150px]">
              <QuickActionButton action={a} />
            </div>
          ))}
        </div>
      </div>

      {/* context card grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Cell><ActiveSessionCard uptime={uptime} /></Cell>
        <Cell><ObjectiveCard /></Cell>
        <Cell><CommandTimeline /></Cell>
        <Cell className="2xl:col-span-1"><EventLog /></Cell>
        <Cell><ProjectContextCard /></Cell>
        <Cell>
          <div className="flex h-full flex-col rounded-md border border-hud/50 bg-surface/40 p-3">
            <TechLabel className="mb-2 text-text-secondary">Agents</TechLabel>
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto">
              {MOCK_AGENTS.map((agent) => (
                <AgentStatusCard key={agent.id} agent={agent} />
              ))}
            </div>
          </div>
        </Cell>
      </div>
    </section>
  )
}

/** Small stagger-in wrapper so deck cards animate on mount. */
function Cell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={className ? `min-h-[168px] ${className}` : 'min-h-[168px]'}
    >
      {children}
    </motion.div>
  )
}
