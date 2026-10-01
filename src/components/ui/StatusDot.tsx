import { cn } from '@/lib/cn'

type Tone = 'cyan' | 'ok' | 'warn' | 'error' | 'muted'

const TONE_CLASS: Record<Tone, string> = {
  cyan: 'bg-cyan',
  ok: 'bg-[rgb(96_220_150)]',
  warn: 'bg-amber',
  error: 'bg-danger',
  muted: 'bg-text-muted'
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
