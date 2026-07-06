import { motion } from 'framer-motion'
import type { NavItem } from '@/types'
import { TechLabel } from '@/components/ui/TechLabel'
import { HudFrame } from './HudFrame'

/** Shown for modules that aren't built yet (Projects/Memory/Agents/System/Settings). */
export function ModulePlaceholder({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <motion.div
      key={item.id}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="panel relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center"
    >
      <HudFrame />
      <span className="flex h-16 w-16 items-center justify-center rounded-xl border border-cyan/30 bg-cyan/5 text-cyan">
        <Icon size={28} strokeWidth={1.6} />
      </span>
      <div>
        <h2 className="font-sans text-lg font-semibold text-text-primary">{item.label}</h2>
        <TechLabel className="mt-1.5 block text-text-muted">Module reserved · not yet wired</TechLabel>
      </div>
      <p className="max-w-sm font-sans text-[13px] leading-relaxed text-text-muted">
        This surface is scaffolded for a later phase. Real data, Obsidian memory and agent
        orchestration plug in through the <code className="font-mono text-cyan">window.wone</code>{' '}
        bridge — see the README for integration notes.
      </p>
    </motion.div>
  )
}
