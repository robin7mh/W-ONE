import { motion } from 'framer-motion'
import { Target, Check, Loader2, Circle } from 'lucide-react'
import { TechLabel } from '@/components/ui/TechLabel'

const STEPS = [
  { label: 'Parse objective', state: 'done' as const },
  { label: 'Index vault (read-only)', state: 'active' as const },
  { label: 'Draft plan', state: 'queued' as const },
  { label: 'Await confirmation', state: 'queued' as const }
]

const done = STEPS.filter((s) => s.state === 'done').length
const progress = Math.round((done / STEPS.length) * 100) + 12 // mid-step

/** Current objective + step checklist with a progress bar. All placeholder. */
export function ObjectiveCard() {
  return (
    <div className="flex h-full flex-col rounded-md border border-hud/50 bg-surface/40 p-3">
      <div className="flex items-center justify-between">
        <TechLabel className="text-text-secondary">Current Objective</TechLabel>
        <span className="font-mono text-[10px] text-cyan">{progress}%</span>
      </div>

      <div className="mt-2 flex items-start gap-2">
        <Target size={15} className="mt-0.5 shrink-0 text-cyan" />
        <p className="font-sans text-[13px] font-medium leading-snug text-text-primary">
          Index Obsidian vault &amp; build a working memory map
        </p>
      </div>

      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-elevated">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-cyan via-blue to-purple"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          style={{ boxShadow: '0 0 10px rgb(var(--accent-cyan) / 0.5)' }}
        />
      </div>

      <ul className="mt-3 space-y-1.5">
        {STEPS.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            {s.state === 'done' ? (
              <Check size={13} className="text-[rgb(96_220_150)]" />
            ) : s.state === 'active' ? (
              <Loader2 size={13} className="animate-spin text-cyan" />
            ) : (
              <Circle size={13} className="text-text-muted" />
            )}
            <span
              className={
                s.state === 'queued'
                  ? 'font-sans text-[12px] text-text-muted'
                  : 'font-sans text-[12px] text-text-secondary'
              }
            >
              {s.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
