import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Code2, ExternalLink, FolderGit2, GitBranch, Github, Gitlab, Play, Power, Square, TerminalSquare, X } from 'lucide-react'
import type { ChatMessage } from '@shared/types/ai'
import type { AgentSession, SessionStatus } from '@shared/types/agents'
import { isDesktop } from '@shared/ipc/client'
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
function SessionTerminal({ id, ended }: { id: string; ended: string }) {
  const host = useRef<HTMLDivElement>(null)
  const { termRef, fitRef } = useXterm(host, id, false, {
    onExit: () => `\r\n\x1b[90m[${ended}]\x1b[0m\r\n`
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

/** The session's name: click to edit, Enter or leaving the field saves, Esc cancels. */
function TitleInput({ title, onRename }: { title: string; onRename: (title: string) => void }) {
  const [value, setValue] = useState(title)
  const commit = () => (value.trim() && value.trim() !== title ? onRename(value.trim()) : setValue(title))
  return (
    <input
      aria-label="Session name"
      value={value}
      maxLength={80}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setValue(title)
          e.currentTarget.blur()
        }
      }}
      title="Rename"
      spellCheck={false}
      style={{ width: `${Math.max(value.length, 4) + 2}ch` }}
      className="-mx-1 min-w-0 max-w-[40%] truncate rounded bg-transparent px-1 font-sans text-[13px] font-semibold text-text-primary outline-none transition-colors hover:bg-elevated/50 focus:bg-elevated/70 focus:ring-1 focus:ring-cyan/40"
    />
  )
}

/** "GitHub", "GitLab" — or the host — for the repo link. */
function repoLink(url: string): { label: string; Icon: typeof Github } {
  const host = new URL(url).hostname
  if (host === 'github.com') return { label: 'GitHub', Icon: Github }
  if (host.startsWith('gitlab.')) return { label: 'GitLab', Icon: Gitlab }
  return { label: host, Icon: ExternalLink }
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
  // ACP agents (Codex, Gemini) have no terminal: theirs is a shell in the session's folder.
  const [shell, setShell] = useState<{ sessionId: string; terminalId: string }>()
  const name = AGENT_NAMES[session.kind]
  const running = session.live
  const busy = session.status === 'working' || session.status === 'approval'
  // Claude Code runs in a PTY the user can watch; its prompts there open it by themselves.
  const agentTerminal = session.terminalId
  const shellId = shell?.sessionId === session.id ? shell.terminalId : undefined
  const needsTerminal = !!agentTerminal && (session.status === 'starting' || session.status === 'waiting')
  const shownId = agentTerminal ? (terminal || needsTerminal ? agentTerminal : undefined) : terminal ? shellId : undefined
  const showTerminal = !!shownId
  const status = STATUS_LABEL[session.status]
  const repo = session.repoUrl ? repoLink(session.repoUrl) : undefined
  const { send, interrupt, stop, resume, clearError, rename, openShell, openInEditor } = useAgents.getState()

  const toggleTerminal = async () => {
    if (showTerminal) return setTerminal(false)
    if (!agentTerminal) {
      const terminalId = await openShell(session.id)
      if (!terminalId) return
      setShell({ sessionId: session.id, terminalId })
    }
    setTerminal(true)
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hud/50 px-4">
        <TerminalSquare size={14} className="shrink-0 text-cyan" />
        <TitleInput key={`${session.id}:${session.title}`} title={session.title} onRename={(t) => void rename(session.id, t)} />
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
          {repo && (
            <a href={session.repoUrl} target="_blank" rel="noreferrer" className={iconButton} title={`Open ${session.repoUrl}`}>
              <repo.Icon size={12} /> {repo.label}
            </a>
          )}
          {isDesktop() && (
            <button type="button" className={iconButton} title={`Open ${session.cwd} in VS Code`} onClick={() => void openInEditor(session.id)}>
              <Code2 size={12} /> VS Code
            </button>
          )}
          <button
            type="button"
            className={iconButton}
            aria-label={showTerminal ? 'Hide terminal' : 'Show terminal'}
            title={agentTerminal ? `${name}'s terminal` : "A shell in the session's folder"}
            onClick={() => void toggleTerminal()}
          >
            {showTerminal ? <ChevronDown size={12} /> : <ChevronUp size={12} />} Terminal
          </button>
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
          {name} is starting.{agentTerminal ? ' If it asks something — like trusting this folder — answer in the terminal below.' : ''}
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

      {shownId && (
        <div className="flex h-[42%] min-h-[160px] shrink-0 flex-col border-t border-hud/60 bg-void/40">
          <SessionTerminal key={shownId} id={shownId} ended={shownId === agentTerminal ? 'the agent ended' : 'the shell ended'} />
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
