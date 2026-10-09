import { motion } from 'framer-motion'
import { UserRound } from 'lucide-react'
import { NAV_ITEMS } from '@/data/navigation'
import type { ModuleId } from '@/types'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
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
  const t = useT()
  const profileActive = active === 'account'
  return (
    <nav className="flex h-full w-14 shrink-0 flex-col items-stretch gap-1 border-r border-hud/70 bg-surface/40 px-2 py-3 backdrop-blur-sm xl:w-52">
      <TechLabel className="mb-2 hidden px-2 text-text-muted xl:block">{t.nav.modules}</TechLabel>

      {NAV_ITEMS.map((item) => {
        const isActive = item.id === active
        const Icon = item.icon
        const label = t.nav[item.id]
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            title={label}
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
              <span className="font-sans text-[13px] font-medium">{label}</span>
            </span>
          </button>
        )
      })}

      {/* Profile: the W-ONE account, licence and language */}
      <button
        type="button"
        onClick={() => onSelect('account')}
        title={t.nav.account}
        aria-label={t.nav.account}
        className={cn(
          'mt-auto flex items-center gap-2.5 rounded-md border px-1.5 py-1.5 text-left transition-colors',
          profileActive
            ? 'border-cyan/40 bg-cyan/[0.07] text-text-primary'
            : 'border-hud/50 bg-surface/40 text-text-muted hover:border-hud-strong/70 hover:text-text-secondary'
        )}
      >
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
            profileActive ? 'border-cyan/50 text-cyan' : 'border-hud/70'
          )}
        >
          <UserRound size={15} strokeWidth={1.8} />
        </span>
        <span className="hidden min-w-0 flex-1 xl:block">
          <span className="block truncate font-sans text-[13px] font-medium text-text-primary">{t.nav.account}</span>
          <span className="block truncate font-mono text-[10px] text-text-muted">{t.nav.notSignedIn}</span>
        </span>
      </button>
    </nav>
  )
}
