import { lazy, Suspense, useEffect, useState } from 'react'
import { BookOpen, Check, CircleDot, FileDiff, GitMerge, Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import type { AgentSession } from '@shared/types/agents'
import { TechLabel } from '@/components/ui/TechLabel'
import { cn } from '@/lib/cn'
import { useAgents } from '../sessions'

// Monaco's diff editor — loaded only when a diff is opened.
const DiffView = lazy(() => import('@/features/editor/components/DiffView'))

type Tab = 'changes' | 'plan' | 'memory'

/** Before → after for one file, over the whole module. */
export function DiffModal() {
  const diff = useAgents((s) => s.diff)
  if (!diff) return null
  return (
    <div role="dialog" aria-label={`Changes in ${diff.path}`} className="fixed inset-0 z-50 flex items-center justify-center bg-void/70 p-6 backdrop-blur-sm">
      <div className="panel flex h-full max-h-[85vh] w-full max-w-6xl flex-col overflow-hidden">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hud/60 px-3">
          <FileDiff size={14} className="text-cyan" />
          <span className="truncate font-mono text-[12px] text-text-primary">{diff.path}</span>
          <span className="font-mono text-[10.5px] text-text-muted">before → after</span>
          <button type="button" aria-label="Close diff" onClick={() => useAgents.getState().closeDiff()} className="ml-auto text-text-muted hover:text-text-primary">
            <X size={15} />
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          <Suspense fallback={<p className="p-4 font-mono text-[11px] text-text-muted">Loading the diff…</p>}>
            <DiffView path={diff.path} original={diff.original} modified={diff.modified} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

/**
 * Beside the chat: what the session changed (with diffs; take over or throw
 * away an own working folder), its plan, and the memory it used.
 */
export function SessionSide({ session, onOpenNote }: { session: AgentSession; onOpenNote: (path: string) => void }) {
  const changes = useAgents((s) => s.changes[session.id])
  const busy = useAgents((s) => s.busy)
  const [tab, setTab] = useState<Tab>('changes')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const { loadChanges, showDiff, accept, discard } = useAgents.getState()

  // Fresh after every step the agent finishes.
  useEffect(() => {
    void useAgents.getState().loadChanges(session.id)
  }, [session.id, session.status])

  const tabs: [Tab, string, number][] = [
    ['changes', 'Changes', changes?.length ?? 0],
    ['plan', 'Plan', session.plan.filter((p) => !p.done).length],
    ['memory', 'Memory', session.notes.length]
  ]

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-l border-hud/50 xl:flex">
      <div role="tablist" className="flex h-10 shrink-0 items-center gap-1 border-b border-hud/50 px-2">
        {tabs.map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn('rounded px-2 py-1 font-sans text-[11.5px] font-medium', tab === id ? 'bg-cyan/10 text-cyan' : 'text-text-muted hover:text-text-secondary')}
          >
            {label}
            {count > 0 && <span className="ml-1 font-mono text-[10px]">{count}</span>}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === 'changes' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between px-1">
              <TechLabel className="text-text-muted">{session.worktree ? 'In its own working folder' : 'Since the session started'}</TechLabel>
              <button type="button" aria-label="Refresh changes" onClick={() => void loadChanges(session.id)} className="text-text-muted hover:text-cyan">
                <RefreshCw size={12} />
              </button>
            </div>
            {!changes?.length && <p className="px-1 py-2 font-mono text-[11px] text-text-muted">No changes yet</p>}
            {changes?.map((c) => (
              <button
                key={c.path}
                type="button"
                onClick={() => void showDiff(c.path)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-elevated/50"
              >
                <span className={cn('font-mono text-[10px] font-semibold', c.status === 'added' ? 'text-green' : c.status === 'deleted' ? 'text-danger' : 'text-amber')}>
                  {c.status === 'added' ? 'A' : c.status === 'deleted' ? 'D' : 'M'}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-secondary">{c.path}</span>
                <span className="font-mono text-[10px] text-text-muted">
                  +{c.added} −{c.removed}
                </span>
              </button>
            ))}
            {session.worktree && !!changes?.length && (
              <div className="mt-3 space-y-1.5 border-t border-hud/50 pt-2">
                {confirmDiscard ? (
                  <div className="space-y-1.5">
                    <p className="font-sans text-[11.5px] text-text-secondary">Throw away all changes and the working folder?</p>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => void discard()} className="flex-1 rounded-md border border-danger/50 px-2 py-1 font-sans text-[11.5px] text-danger hover:bg-danger/10">
                        Discard
                      </button>
                      <button type="button" onClick={() => setConfirmDiscard(false)} className="flex-1 rounded-md border border-hud/60 px-2 py-1 font-sans text-[11.5px] text-text-secondary">
                        Keep
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void accept()}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-cyan/50 bg-cyan/[0.08] px-2 py-1 font-sans text-[11.5px] text-cyan hover:bg-cyan/15 disabled:opacity-40"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />} Take over
                    </button>
                    <button
                      type="button"
                      aria-label="Discard changes"
                      onClick={() => setConfirmDiscard(true)}
                      className="rounded-md border border-hud/60 px-2 py-1 text-text-muted hover:border-danger/50 hover:text-danger"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
                <p className="font-sans text-[10.5px] text-text-muted">Take over copies the changes into the project as uncommitted edits.</p>
              </div>
            )}
          </div>
        )}

        {tab === 'plan' &&
          (session.plan.length ? (
            <ul className="space-y-1">
              {session.plan.map((p) => (
                <li key={p.id} className="flex items-start gap-2 px-1 py-0.5 font-sans text-[12px]">
                  {p.done ? <Check size={13} className="mt-0.5 shrink-0 text-green" /> : <CircleDot size={13} className="mt-0.5 shrink-0 text-text-muted" />}
                  <span className={p.done ? 'text-text-muted line-through' : 'text-text-secondary'}>{p.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 py-2 font-mono text-[11px] text-text-muted">No plan yet — it appears when the agent makes one</p>
          ))}

        {tab === 'memory' && (
          <div className="space-y-1">
            {session.journal && (
              <button type="button" onClick={() => onOpenNote(session.journal!)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-elevated/50">
                <BookOpen size={12} className="shrink-0 text-cyan" />
                <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-text-primary">Session journal</span>
              </button>
            )}
            {session.notes.map((n) => (
              <button key={n} type="button" onClick={() => onOpenNote(n)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-elevated/50">
                <BookOpen size={12} className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary">{n}</span>
              </button>
            ))}
            {!session.journal && !session.notes.length && (
              <p className="px-1 py-2 font-mono text-[11px] text-text-muted">
                Notes the agent reads or writes show up here; the session journal is written after its first answer.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
