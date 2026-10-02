import { useEffect, useMemo } from 'react'
import { AlertTriangle, Bot, Code2, Globe, MessageSquare, Plus, Sparkles, Trash2, X } from 'lucide-react'
import type { AgentInfo } from '@shared/types/ai'
import { Panel } from '@/components/ui/Panel'
import { TechLabel } from '@/components/ui/TechLabel'
import { StatusDot } from '@/components/ui/StatusDot'
import { cn } from '@/lib/cn'
import { useProjects } from '@/features/projects/store'
import { useActiveMessages, useAssistant } from '../store'
import { relativeTime } from '../format'
import { ActivityTimeline } from './ActivityTimeline'
import { ChatThread } from './ChatThread'
import { Composer } from './Composer'
import { KeySetup } from './KeySetup'

const AGENT_ICON: Record<string, typeof Bot> = { assistant: Sparkles, coding: Code2, research: Globe, chat: MessageSquare }
const iconFor = (id: string) => AGENT_ICON[id] ?? Bot

function AgentPicker({ agents, value, onPick }: { agents: AgentInfo[]; value: string; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {agents.map((a) => {
        const Icon = iconFor(a.id)
        return (
          <button
            key={a.id}
            type="button"
            title={a.description}
            aria-pressed={a.id === value}
            onClick={() => onPick(a.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left font-sans text-[12px] transition-colors',
              a.id === value ? 'border-cyan/50 bg-cyan/[0.08] text-cyan' : 'border-hud/60 text-text-secondary hover:border-cyan/40 hover:text-text-primary'
            )}
          >
            <Icon size={13} className="shrink-0" />
            <span className="truncate">{a.name}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The Agents module (P6–P9): pick an agent, chat, watch it work (tool calls
 * inline, approvals where they happen, the activity timeline beside it).
 */
export function AgentsView() {
  const a = useAssistant()
  const messages = useActiveMessages()
  const projects = useProjects((s) => s.projects)
  const loadProjects = useProjects((s) => s.load)

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  const active = a.conversations.find((c) => c.id === a.activeId)
  const agentId = active?.agentId ?? a.agentId
  const agent = a.agents.find((x) => x.id === agentId)
  const running = !!(a.activeId && a.running[a.activeId])
  const activity = useMemo(
    () => (a.activeId ? a.activity.filter((e) => e.conversationId === a.activeId) : a.activity),
    [a.activity, a.activeId]
  )
  const model = a.status?.settings.model

  const header = (
    <div className="flex items-center gap-2">
      {model && <span className="hidden font-mono text-[10px] text-text-muted md:inline">{model} · {a.status?.settings.effort}</span>}
      <StatusDot tone={a.status?.configured ? 'ok' : 'warn'} pulse={running} />
    </div>
  )

  return (
    <Panel title="Agents" corners flush className="min-h-0 flex-1" headerRight={header} bodyClassName="flex min-h-0">
      {/* left: agents + conversations */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-hud/50 md:flex">
        <div className="space-y-2 border-b border-hud/50 p-2.5">
          <button
            type="button"
            onClick={() => a.newChat()}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-cyan/40 bg-cyan/[0.06] px-2.5 py-1.5 font-sans text-[12px] font-medium text-cyan hover:bg-cyan/[0.12]"
          >
            <Plus size={14} /> New chat
          </button>
          <AgentPicker agents={a.agents} value={a.agentId} onPick={(id) => a.newChat(id)} />
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
          {a.conversations.length === 0 && <p className="px-2 py-3 font-mono text-[11px] text-text-muted">No conversations yet</p>}
          {a.conversations.map((c) => {
            const Icon = iconFor(c.agentId)
            return (
              <div
                key={c.id}
                className={cn(
                  'group flex items-center gap-2 rounded-md px-2 py-1.5',
                  c.id === a.activeId ? 'bg-cyan/[0.08]' : 'hover:bg-elevated/50'
                )}
              >
                <button type="button" onClick={() => void a.open(c.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <Icon size={13} className={cn('shrink-0', c.id === a.activeId ? 'text-cyan' : 'text-text-muted')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-sans text-[12.5px] text-text-primary">{c.title}</span>
                    <span className="block font-mono text-[10px] text-text-muted">{relativeTime(c.updatedAt)}</span>
                  </span>
                  {a.running[c.id] && <StatusDot tone="cyan" />}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${c.title}`}
                  onClick={() => void a.remove(c.id)}
                  className="shrink-0 text-text-muted opacity-0 hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </div>
      </aside>

      {/* center: the conversation */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hud/50 px-4">
          {(() => {
            const Icon = iconFor(agentId)
            return <Icon size={14} className="shrink-0 text-cyan" />
          })()}
          <span className="truncate font-sans text-[13px] font-semibold text-text-primary">
            {active ? active.title : `New chat · ${agent?.name ?? 'Agent'}`}
          </span>
          {agent && <span className="hidden truncate font-mono text-[10px] text-text-muted lg:inline">{agent.description}</span>}
          <button
            type="button"
            onClick={() => a.newChat()}
            className="ml-auto flex items-center gap-1 rounded border border-hud/60 px-2 py-0.5 font-sans text-[11px] text-text-secondary hover:border-cyan/50 hover:text-cyan md:hidden"
          >
            <Plus size={12} /> New
          </button>
        </div>

        {a.error && (
          <div className="flex items-start gap-2 border-b border-danger/30 bg-danger/[0.06] px-3 py-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-danger" />
            <span className="min-w-0 flex-1 font-mono text-[11px] text-text-secondary">{a.error}</span>
            <button type="button" aria-label="Dismiss" onClick={a.clearError} className="text-text-muted hover:text-text-primary">
              <X size={12} />
            </button>
          </div>
        )}

        {a.status && !a.status.configured ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <KeySetup onSave={a.setKey} />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  {(() => {
                    const Icon = iconFor(agentId)
                    return <Icon size={28} className="text-cyan/70" />
                  })()}
                  <p className="font-sans text-[15px] font-semibold text-text-primary">{agent?.name ?? 'Assistant'}</p>
                  <p className="max-w-md font-sans text-[13px] text-text-secondary">{agent?.description}</p>
                  {agent && agent.tools.length > 0 && (
                    <p className="max-w-md font-mono text-[10.5px] text-text-muted">
                      Tools: {agent.tools.join(', ')}
                      {agent.web ? ', web search' : ''} — anything that changes data asks you first.
                    </p>
                  )}
                </div>
              ) : (
                <ChatThread messages={messages} pending={a.pending} onRespond={(id, d) => void a.respond(id, d)} />
              )}
            </div>
            <Composer
              running={running}
              sending={a.sending}
              projects={projects}
              projectId={a.projectId}
              placeholder={`Message ${agent?.name ?? 'the assistant'}…`}
              onProject={a.setProject}
              onSend={a.send}
              onStop={() => void a.cancel()}
            />
          </>
        )}
      </section>

      {/* right: what the agent did */}
      <aside className="hidden w-72 shrink-0 flex-col border-l border-hud/50 xl:flex">
        <div className="flex h-10 items-center border-b border-hud/50 px-3">
          <TechLabel className="text-text-secondary">{a.activeId ? 'Run activity' : 'All activity'}</TechLabel>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          <ActivityTimeline events={activity} empty="Nothing happened here yet" />
        </div>
      </aside>
    </Panel>
  )
}
