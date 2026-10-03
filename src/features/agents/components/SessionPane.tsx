import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, FolderGit2, GitBranch, Play, Power, Square, TerminalSquare, X } from 'lucide-react'
import type { ChatMessage } from '@shared/types/ai'
import type { AgentSession, SessionStatus } from '@shared/types/agents'
import { cn } from '@/lib/cn'
import { useXterm } from '@/features/terminal/useXterm'
import { useAssistant } from '../store'
import { useAgents } from '../sessions'
import { ChatThread } from './ChatThread'
import { Composer } from './Composer'

export const AGENT_NAMES: Record<AgentSession['kind'], string> = { 'claude-code': 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' }

export const STATUS_LABEL: Record<SessionStatus, { text: string; tone: string }> = {
  starting: { text: 'Starting…', tone: 'text-text-muted' },
  working: { text: 'Working', tone: 'text-cyan' },
  approval: { text: 'Needs your approval', tone: 'text-amber' },
  waiting: { text: 'Waiting for you', tone: 'text-amber' },
  idle: { text: 'Your turn', tone: 'text-green' },
  ended: { text: 'Ended', tone: 'text-text-muted' },
  error: { text: 'Error', tone: 'text-danger' }
}

/** The agent's own terminal — for whatever it only shows there (sign-in, trust prompt, /commands). */
function SessionTerminal({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null)
  const { termRef, fitRef } = useXterm(host, id, false, {
    onExit: () => '\r\n\x1b[90m[the agent ended]\x1b[0m\r\n'
  })
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
      } catch {
        /* not measurable yet */
      }
      termRef.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [fitRef, termRef])
  return (
    <div className="min-h-0 flex-1 px-3 py-2">
      <div ref={host} className="h-full w-full" />
    </div>
  )
}

const iconButton =
  'flex h-7 items-center gap-1 rounded-md border border-hud/60 px-2 font-sans text-[11.5px] text-text-secondary transition-colors hover:border-cyan/50 hover:text-cyan'

/**
 * One coding agent session as a chat: the user's messages, the agent's answers
 * and tool cards with approvals inline. Its real terminal is one click away —
 * and opens by itself while the agent waits for input only it can show.
 */
export function SessionPane({ session, messages }: { session: AgentSession; messages: ChatMessage[] }) {
  const pending = useAssistant((s) => s.pending)
  const respond = useAssistant((s) => s.respond)
  const error = useAgents((s) => s.error)
  const [terminal, setTerminal] = useState(false)
  const name = AGENT_NAMES[session.kind]
  const running = session.live
  const busy = session.status === 'working' || session.status === 'approval'
  // Only Claude Code runs in a PTY; ACP agents (Codex, Gemini) have no terminal.
  const hasTerminal = !!session.terminalId
  const needsTerminal = session.status === 'starting' || session.status === 'waiting'
  const showTerminal = hasTerminal && (terminal || needsTerminal)
  const status = STATUS_LABEL[session.status]
  const { send, interrupt, stop, resume, clearError } = useAgents.getState()

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hud/50 px-4">
        <TerminalSquare size={14} className="shrink-0 text-cyan" />
        <span className="truncate font-sans text-[13px] font-semibold text-text-primary">{session.title}</span>
        <span className="hidden items-center gap-1 font-mono text-[10.5px] text-text-muted lg:flex">
          <FolderGit2 size={11} /> {session.projectName}
          {session.branch && (
            <>
              <GitBranch size={11} className="ml-1" /> {session.branch}
            </>
          )}
        </span>
        <span className={cn('font-mono text-[10.5px]', status.tone)}>· {status.text}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {hasTerminal && (
            <button type="button" className={iconButton} aria-label={showTerminal ? 'Hide terminal' : 'Show terminal'} onClick={() => setTerminal(!showTerminal)}>
              {showTerminal ? <ChevronDown size={12} /> : <ChevronUp size={12} />} Terminal
            </button>
          )}
          {running && busy && (
            <button type="button" className={iconButton} aria-label="Interrupt" title="Stop what it is doing (Esc)" onClick={() => void interrupt()}>
              <Square size={11} /> Interrupt
            </button>
          )}
          {running ? (
            <button type="button" className={iconButton} aria-label="End session" onClick={() => void stop(session.id)}>
              <Power size={12} /> End
            </button>
          ) : (
            <button type="button" className={iconButton} aria-label="Resume" onClick={() => void resume(session.id)}>
              <Play size={12} /> Resume
            </button>
          )}
        </div>
      </div>

      {session.status === 'starting' && (
        <p className="border-b border-hud/50 bg-elevated/40 px-4 py-1.5 font-sans text-[12px] text-text-secondary">
          {name} is starting.{hasTerminal ? ' If it asks something — like trusting this folder — answer in the terminal below.' : ''}
        </p>
      )}
      {(session.error || error) && (
        <div className="flex items-start gap-2 border-b border-danger/30 bg-danger/[0.06] px-3 py-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-danger" />
          <span className="min-w-0 flex-1 font-mono text-[11px] text-text-secondary">{error ?? session.error}</span>
          {error && (
            <button type="button" aria-label="Dismiss" onClick={clearError} className="text-text-muted hover:text-text-primary">
              <X size={12} />
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <TerminalSquare size={26} className="text-cyan/70" />
            <p className="font-sans text-[14px] font-semibold text-text-primary">
              {name} · {session.projectName}
            </p>
            <p className="max-w-md font-sans text-[12.5px] text-text-secondary">
              Runs with your own {name} sign-in. Approvals appear here, changes on the right, and every session is journaled in your memory.
            </p>
          </div>
        ) : (
          <ChatThread messages={messages} pending={pending.filter((p) => p.conversationId === session.id)} onRespond={(id, d) => void respond(id, d)} />
        )}
      </div>

      {showTerminal && session.terminalId && (
        <div className="flex h-[42%] min-h-[160px] shrink-0 flex-col border-t border-hud/60 bg-void/40">
          <SessionTerminal id={session.terminalId} />
        </div>
      )}

      <Composer
        running={running && busy}
        sending={false}
        disabled={!running}
        placeholder={running ? `Message ${name}…` : 'Resume the session to continue'}
        onSend={send}
        onStop={() => void interrupt()}
      />
    </section>
  )
}
