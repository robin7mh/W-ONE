import { motion } from 'framer-motion'
import type { QuickAction } from '@/types'

const ACCENT: Record<NonNullable<QuickAction['accent']>, string> = {
  cyan: 'var(--accent-cyan)',
  blue: 'var(--accent-blue)',
  purple: 'var(--accent-purple)',
  amber: 'var(--accent-amber)'
}

/** A quick-action tile. Decorative (no real action) in this phase. */
export function QuickActionButton({ action }: { action: QuickAction }) {
  const color = ACCENT[action.accent ?? 'cyan']
  const Icon = action.icon
  return (
    <motion.button
      type="button"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      className="group relative flex items-center gap-2.5 rounded-md border border-hud/60 bg-surface/40 px-3 py-2.5 text-left transition-colors hover:border-[color:var(--c)]"
      style={{ ['--c' as string]: `rgb(${color} / 0.5)` }}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border transition-shadow"
        style={{
          borderColor: `rgb(${color} / 0.35)`,
          background: `rgb(${color} / 0.08)`,
          color: `rgb(${color})`
        }}
      >
        <Icon size={15} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-sans text-[12.5px] font-medium text-text-primary">
          {action.label}
        </span>
        <span className="block font-mono text-[10px] text-text-muted">{action.hint}</span>
      </span>
      <span
        className="pointer-events-none absolute inset-0 rounded-md opacity-0 transition-opacity group-hover:opacity-100"
        style={{ boxShadow: `inset 0 0 20px rgb(${color} / 0.10)` }}
      />
    </motion.button>
  )
}
