import type { LucideIcon } from 'lucide-react'
import { Sparkline } from './Sparkline'
import { TechLabel } from '@/components/ui/TechLabel'
import type { MetricSample } from '@/types'

/**
 * One metric row: icon + label, current value, and a rolling sparkline.
 * `unit` and `format` let network/battery render differently from percentages.
 */
export function SystemMetricCard({
  label,
  icon: Icon,
  sample,
  accent = 'var(--accent-cyan)',
  unit = '%',
  max = 100,
  format
}: {
  label: string
  icon: LucideIcon
  sample: MetricSample
  accent?: string
  unit?: string
  max?: number
  format?: (v: number) => string
}) {
  const shown = format ? format(sample.value) : Math.round(sample.value).toString()
  return (
    <div className="rounded-md border border-hud/50 bg-surface/40 p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={14} strokeWidth={1.8} style={{ color: `rgb(${accent})` }} />
          <TechLabel className="text-text-secondary">{label}</TechLabel>
        </div>
        <div className="font-mono text-[13px] font-semibold text-text-primary tabular-nums">
          {shown}
          <span className="ml-0.5 text-[10px] text-text-muted">{unit}</span>
        </div>
      </div>
      <div className="mt-2 h-9">
        <Sparkline data={sample.history} accent={accent} max={max} height={36} />
      </div>
    </div>
  )
}
