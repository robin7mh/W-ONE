import { ShieldAlert, TerminalSquare, PencilLine, Check, CheckCheck, X } from 'lucide-react'
import type { ApprovalDecision, PermissionRequest } from '@shared/types/ai'
import { TechLabel } from '@/components/ui/TechLabel'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'

/**
 * The permission prompt (architecture §9): which agent, which tool, exactly
 * what will happen and why. Commands never get "Always allow".
 */
export function ApprovalCard({
  request,
  onRespond,
  compact = false
}: {
  request: PermissionRequest
  onRespond: (decision: ApprovalDecision) => void
  compact?: boolean
}) {
  const t = useT()
  const Icon = request.risk === 'execute' ? TerminalSquare : PencilLine
  const btn = 'flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-sans text-[12px] font-medium transition-colors'
  return (
    <div
      role="alertdialog"
      aria-label={t.agents.approve(request.toolTitle)}
      className={cn(
        'rounded-md border bg-surface/90 p-3 backdrop-blur',
        request.risk === 'execute' ? 'border-amber/60' : 'border-cyan/50'
      )}
    >
      <div className="flex items-center gap-2">
        <ShieldAlert size={14} className="shrink-0 text-amber" />
        <TechLabel className="text-text-secondary">
          {t.agents.wantsTo(request.agentName, request.risk === 'execute')}
        </TechLabel>
      </div>
      <div className="mt-2 flex items-start gap-2">
        <Icon size={14} className="mt-0.5 shrink-0 text-cyan" />
        <div className="min-w-0">
          <p className={cn('break-words font-mono text-[12px] text-text-primary', compact && 'line-clamp-2')}>{request.summary}</p>
          {request.reason && <p className="mt-1 font-sans text-[12px] text-text-secondary">{t.agents.why(request.reason)}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => onRespond('once')} className={cn(btn, 'border-cyan/50 bg-cyan/[0.10] text-cyan hover:bg-cyan/[0.16]')}>
          <Check size={13} /> {t.agents.allowOnce}
        </button>
        {request.allowAlways && (
          <button type="button" onClick={() => onRespond('always')} className={cn(btn, 'border-hud/60 text-text-secondary hover:border-cyan/50 hover:text-cyan')}>
            <CheckCheck size={13} /> {t.agents.allowAlways}
          </button>
        )}
        <button type="button" onClick={() => onRespond('deny')} className={cn(btn, 'border-hud/60 text-text-secondary hover:border-danger/50 hover:text-danger')}>
          <X size={13} /> {t.agents.deny}
        </button>
      </div>
    </div>
  )
}
