import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { AlertTriangle, Ban, BookOpen, ChevronRight, Globe, Loader2, PencilLine, TerminalSquare, User, Wrench } from 'lucide-react'
import type { ApprovalDecision, ChatMessage, PermissionRequest, ToolCallPart } from '@shared/types/ai'
import { renderMarkdown } from '@/features/memory/markdown'
import { TechLabel } from '@/components/ui/TechLabel'
import { cn } from '@/lib/cn'
import { ApprovalCard } from './ApprovalCard'

const STATUS: Record<ToolCallPart['status'], { label: string; cls: string }> = {
  pending: { label: 'queued', cls: 'text-text-muted' },
  'awaiting-approval': { label: 'waiting for you', cls: 'text-amber' },
  running: { label: 'running', cls: 'text-cyan' },
  done: { label: 'done', cls: 'text-green' },
  error: { label: 'failed', cls: 'text-danger' },
  denied: { label: 'blocked', cls: 'text-amber' }
}

function toolIcon(part: ToolCallPart) {
  if (part.server) return Globe
  if (part.risk === 'execute') return TerminalSquare
  if (part.risk === 'write') return PencilLine
  return /^(memory|mcp__wone__)/.test(part.name) ? BookOpen : Wrench
}

/** Short one-line view of the tool input (the full JSON is one click away). */
export function inputPreview(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  const key = ['command', 'file_path', 'notebook_path', 'query', 'pattern', 'path', 'title', 'url', 'dir', 'folder', 'description', 'projectId'].find((k) => typeof o[k] === 'string')
  return key ? String(o[key]) : ''
}

function ToolCard({ part, request, onRespond }: { part: ToolCallPart; request?: PermissionRequest; onRespond: (id: string, d: ApprovalDecision) => void }) {
  const [open, setOpen] = useState(false)
  const Icon = toolIcon(part)
  const s = STATUS[part.status]
  const preview = inputPreview(part.input)
  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-hud/60 bg-elevated/30 px-2.5 py-1.5 text-left hover:border-cyan/40"
      >
        <ChevronRight size={12} className={cn('shrink-0 text-text-muted transition-transform', open && 'rotate-90')} />
        <Icon size={13} className="shrink-0 text-cyan" />
        <span className="shrink-0 font-sans text-[12px] font-medium text-text-primary">{part.title}</span>
        {preview && <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-muted">{preview}</span>}
        <span className={cn('ml-auto flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-wider', s.cls)}>
          {part.status === 'running' && <Loader2 size={10} className="animate-spin" />}
          {s.label}
        </span>
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 rounded-md border border-hud/40 bg-surface/60 p-2">
          <TechLabel className="text-text-muted">Input</TechLabel>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary">
            {JSON.stringify(part.input, null, 2)}
          </pre>
          {part.output !== undefined && (
            <>
              <TechLabel className="text-text-muted">Result</TechLabel>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary">{part.output}</pre>
            </>
          )}
        </div>
      )}
      {part.status === 'awaiting-approval' && request && (
        <div className="mt-1.5">
          <ApprovalCard request={request} onRespond={(d) => onRespond(request.id, d)} />
        </div>
      )}
    </div>
  )
}

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text, {}), [text])
  return <div className="md-prose chat-prose" dangerouslySetInnerHTML={{ __html: html }} />
}

function Message({
  message,
  pending,
  onRespond
}: {
  message: ChatMessage
  pending: PermissionRequest[]
  onRespond: (id: string, d: ApprovalDecision) => void
}) {
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg border border-cyan/30 bg-cyan/[0.07] px-3 py-2">
          <div className="mb-0.5 flex items-center gap-1.5">
            <User size={11} className="text-cyan" />
            <TechLabel className="text-text-muted">You</TechLabel>
          </div>
          <p className="whitespace-pre-wrap break-words font-sans text-[13px] text-text-primary">{text}</p>
        </div>
      </div>
    )
  }
  const empty = message.parts.length === 0
  return (
    <div className="max-w-full">
      {message.parts.map((part, i) =>
        part.type === 'text' ? (
          <Markdown key={i} text={part.text} />
        ) : (
          <ToolCard key={part.id} part={part} request={pending.find((p) => p.id === part.requestId)} onRespond={onRespond} />
        )
      )}
      {message.status === 'streaming' && empty && (
        <p className="flex items-center gap-2 font-mono text-[11px] text-text-muted">
          <Loader2 size={12} className="animate-spin text-cyan" /> thinking…
        </p>
      )}
      {message.status === 'streaming' && !empty && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-cyan/70 align-middle" />}
      {message.status === 'error' && (
        <p className="mt-1 flex items-start gap-1.5 font-mono text-[11px] text-danger">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {message.error ?? 'The run failed.'}
        </p>
      )}
      {message.status === 'cancelled' && (
        <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-amber">
          <Ban size={12} /> Stopped
        </p>
      )}
      {message.status !== 'streaming' && message.model && (
        <p className="mt-1 font-mono text-[10px] text-text-muted">
          {message.model}
          {message.usage ? ` · ${message.usage.inputTokens} in / ${message.usage.outputTokens} out` : ''}
        </p>
      )}
    </div>
  )
}

/** Opens http(s) links outside the app (Electron: the OS browser; web: a new tab). */
export function interceptLinks(e: MouseEvent<HTMLElement>): void {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  e.preventDefault()
  const href = a.getAttribute('href') ?? ''
  if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
}

export function ChatThread({
  messages,
  pending,
  onRespond
}: {
  messages: ChatMessage[]
  pending: PermissionRequest[]
  onRespond: (id: string, d: ApprovalDecision) => void
}) {
  const end = useRef<HTMLDivElement>(null)
  const last = messages[messages.length - 1]
  const signature = `${messages.length}:${last?.parts.length ?? 0}:${last?.status ?? ''}:${JSON.stringify(last?.parts.at(-1) ?? '').length}`
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [signature])

  return (
    <div className="space-y-4 px-4 py-4" onClick={interceptLinks}>
      {messages.map((m) => (
        <Message key={m.id} message={m} pending={pending} onRespond={onRespond} />
      ))}
      <div ref={end} />
    </div>
  )
}
