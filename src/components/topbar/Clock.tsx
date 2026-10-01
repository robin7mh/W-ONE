import { useClock } from '@/hooks/useClock'
import { formatDate, formatTime } from '@/lib/format'

export function Clock() {
  const now = useClock()
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-lg font-medium leading-none tracking-wider text-text-primary tabular-nums">
        {formatTime(now)}
      </span>
      <span className="tech-label hidden text-text-muted sm:inline">{formatDate(now)}</span>
    </div>
  )
}
