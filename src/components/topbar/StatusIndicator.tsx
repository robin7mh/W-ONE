import { StatusDot } from '@/components/ui/StatusDot'
import { cn } from '@/lib/cn'

type Tone = 'cyan' | 'ok' | 'warn' | 'error' | 'muted'

/** Compact label + value pill with a status dot. */
export function StatusIndicator({
  label,
  value,
  tone = 'ok',
  pulse = true,
  className
}: {
  label: string
  value: string
  tone?: Tone
  pulse?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-hud/60 bg-surface/50 px-2.5 py-1',
        className
      )}
    >
      <StatusDot tone={tone} pulse={pulse} />
      <span className="tech-label text-text-muted">{label}</span>
      <span className="font-mono text-[11px] font-medium text-text-secondary">{value}</span>
    </div>
  )
}
