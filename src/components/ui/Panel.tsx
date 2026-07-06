import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { TechLabel } from './TechLabel'
import { HudFrame } from '@/components/shell/HudFrame'

interface PanelProps {
  children: ReactNode
  /** Uppercase label rendered in the panel header strip. */
  title?: string
  /** Right-aligned content in the header (status dot, value, action). */
  headerRight?: ReactNode
  /** Show decorative corner ticks. */
  corners?: boolean
  /** Remove inner padding (e.g. for the terminal / full-bleed content). */
  flush?: boolean
  className?: string
  bodyClassName?: string
}

/**
 * The single Panel primitive. Every framed surface in the app uses this so
 * borders, header treatment and spacing stay identical everywhere.
 */
export function Panel({
  children,
  title,
  headerRight,
  corners = false,
  flush = false,
  className,
  bodyClassName
}: PanelProps) {
  return (
    <section className={cn('panel flex min-h-0 flex-col overflow-hidden', className)}>
      {corners && <HudFrame />}
      {(title || headerRight) && (
        <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-hud/60 px-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-px bg-cyan/60" />
            {title && <TechLabel className="text-text-secondary">{title}</TechLabel>}
          </div>
          {headerRight && <div className="flex items-center gap-2">{headerRight}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', flush ? '' : 'p-3', bodyClassName)}>{children}</div>
    </section>
  )
}
