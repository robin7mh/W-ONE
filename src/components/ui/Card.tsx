import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { TechLabel } from './TechLabel'

/** A titled section inside a module panel (Settings, Profile). */
export function Card({ icon: Icon, title, children, className }: { icon: LucideIcon; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-md border border-hud/60 bg-surface/40 p-3.5', className)}>
      <div className="mb-3 flex items-center gap-2">
        <Icon size={14} className="text-cyan" />
        <TechLabel className="text-text-secondary">{title}</TechLabel>
      </div>
      {children}
    </section>
  )
}
