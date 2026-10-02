import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { FolderGit2, Loader2, Send, Square } from 'lucide-react'
import type { Project } from '@shared/types/project'
import { cn } from '@/lib/cn'

/** Message input: Enter sends, Shift+Enter breaks the line; Stop while a run is active. */
export function Composer({
  running,
  sending,
  disabled,
  projects,
  projectId,
  placeholder,
  onProject,
  onSend,
  onStop
}: {
  running: boolean
  sending: boolean
  disabled?: boolean
  projects: Project[]
  projectId?: string
  placeholder: string
  onProject: (id?: string) => void
  onSend: (text: string) => Promise<boolean>
  onStop: () => void
}) {
  const [text, setText] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = area.current!
    el.style.height = 'auto'
    el.style.height = `${Math.min(220, el.scrollHeight)}px`
  }, [text])

  const submit = async () => {
    if (!text.trim() || running || sending || disabled) return
    const sent = await onSend(text)
    if (sent) setText('')
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="border-t border-hud/60 p-3">
      <div className="flex items-end gap-2 rounded-lg border border-hud/70 bg-surface/70 px-2.5 py-2 focus-within:border-cyan/50">
        <textarea
          ref={area}
          aria-label="Message"
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          className="max-h-[220px] min-h-[24px] flex-1 resize-none bg-transparent font-sans text-[13.5px] leading-6 text-text-primary outline-none placeholder:text-text-muted disabled:opacity-50"
        />
        {running ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            title="Stop the agent"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber/50 bg-amber/10 text-amber hover:bg-amber/20"
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit()}
            aria-label="Send"
            disabled={!text.trim() || sending || disabled}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-cyan/50 bg-cyan/[0.12] text-cyan hover:bg-cyan/20 disabled:opacity-40"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <FolderGit2 size={12} className="text-text-muted" />
        <select
          aria-label="Project context"
          value={projectId ?? ''}
          onChange={(e) => onProject(e.target.value || undefined)}
          className={cn(
            'max-w-[220px] truncate rounded border border-transparent bg-transparent font-mono text-[11px] text-text-muted outline-none hover:border-hud/60 focus:border-cyan/50',
            projectId && 'text-text-secondary'
          )}
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="ml-auto hidden font-mono text-[10px] text-text-muted sm:inline">Enter to send · Shift+Enter new line</span>
      </div>
    </div>
  )
}
