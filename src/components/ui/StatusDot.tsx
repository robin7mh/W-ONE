import { cn } from '@/lib/cn'
import type { AgentState, EventLevel } from '@/types'

type Tone = 'cyan' | 'ok' | 'warn' | 'error' | 'muted'

const TONE_CLASS: Record<Tone, string> = {
  cyan: 'bg-cyan',
  ok: 'bg-[rgb(96_220_150)]',
  warn: 'bg-amber',
  error: 'bg-danger',
  muted: 'bg-text-muted'
}

export function toneFromState(state: AgentState): Tone {
  switch (state) {
    case 'online':
      return 'ok'
    case 'standby':
      return 'cyan'
    case 'idle':
      return 'warn'
    default:
      return 'muted'
  }
}

export function toneFromLevel(level: EventLevel): Tone {
  switch (level) {
    case 'ok':
      return 'ok'
    case 'warn':
      return 'warn'
    case 'error':
      return 'error'
    default:
      return 'cyan'
  }
}

/** A small pulsing status dot. Pulse can be disabled for static rows. */
export function StatusDot({
  tone = 'cyan',
  pulse = true,
  className
}: {
  tone?: Tone
  pulse?: boolean
  className?: string
}) {
  return (
    <span className={cn('relative inline-flex h-2 w-2', className)}>
      <span
        className={cn(
          'inline-flex h-2 w-2 rounded-full',
          TONE_CLASS[tone],
          pulse && 'animate-pulse-dot'
        )}
      />
    </span>
  )
}
