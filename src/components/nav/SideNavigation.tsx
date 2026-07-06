import { motion } from 'framer-motion'
import { NAV_ITEMS } from '@/data/navigation'
import type { ModuleId } from '@/types'
import { cn } from '@/lib/cn'
import { TechLabel } from '@/components/ui/TechLabel'

/**
 * Left module rail. Collapses to icon-only on narrow widths (labels hidden via
 * the `xl:` breakpoint). Active state is visual-only in this phase; the sliding
 * indicator uses a shared layoutId so it animates between items.
 */
export function SideNavigation({
  active,
  onSelect
}: {
  active: ModuleId
  onSelect: (id: ModuleId) => void
}) {
  return (
    <nav className="flex h-full w-14 shrink-0 flex-col items-stretch gap-1 border-r border-hud/70 bg-surface/40 px-2 py-3 backdrop-blur-sm xl:w-52">
      <TechLabel className="mb-2 hidden px-2 text-text-muted xl:block">Modules</TechLabel>

      {NAV_ITEMS.map((item) => {
        const isActive = item.id === active
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            title={item.label}
            className={cn(
              'group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors',
              isActive ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'
            )}
          >
            {isActive && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-md border border-cyan/40 bg-cyan/[0.07]"
                style={{ boxShadow: 'inset 0 0 18px rgb(var(--accent-cyan) / 0.10)' }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            {/* left accent tick */}
            <span
              className={cn(
                'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full transition-all',
                isActive ? 'bg-cyan opacity-100' : 'bg-transparent opacity-0'
              )}
            />
            <Icon
              size={18}
              strokeWidth={1.8}
              className={cn(
                'relative z-10 shrink-0 transition-colors',
                isActive && 'text-cyan'
              )}
            />
            <span className="relative z-10 hidden flex-1 items-center justify-between xl:flex">
              <span className="font-sans text-[13px] font-medium">{item.label}</span>
              {!item.ready && (
                <span className="rounded border border-hud/60 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-text-muted">
                  soon
                </span>
              )}
            </span>
          </button>
        )
      })}

      <div className="mt-auto hidden px-2 xl:block">
        <div className="rounded-md border border-hud/50 bg-surface/40 p-2.5">
          <TechLabel className="text-text-muted">Build</TechLabel>
          <div className="mt-1 font-mono text-[11px] text-text-secondary">UI PREVIEW</div>
          <div className="mt-0.5 font-mono text-[10px] text-text-muted">no backend linked</div>
        </div>
      </div>
    </nav>
  )
}
