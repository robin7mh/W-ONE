import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronUp, LayoutGrid } from 'lucide-react'
import { TechLabel } from '@/components/ui/TechLabel'
import { cn } from '@/lib/cn'

const STORAGE_KEY = 'wone.commandDeck.open'

/** Per-viewer UI preference; storage can be unavailable, so never throw. */
function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, open ? '1' : '0')
  } catch {
    /* preference just won't persist */
  }
}

/**
 * Collapsible Command Deck. The demo cards (session, objective, timeline,
 * events, agents, quick actions) were removed — real agent activity lands here
 * in P9. Collapsed by default so the bottom of the shell stays calm.
 */
export function BottomDashboard() {
  const [open, setOpen] = useState(readOpen)

  const toggle = () => {
    const next = !open
    setOpen(next)
    writeOpen(next)
  }

  return (
    <section className="flex shrink-0 flex-col border-t border-hud/70 bg-surface/40 backdrop-blur-sm">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="group flex h-8 items-center gap-2 px-3 text-left"
      >
        <LayoutGrid size={13} className="text-cyan" />
        <TechLabel className="text-text-secondary group-hover:text-text-primary">Command Deck</TechLabel>
        <ChevronUp
          size={14}
          className={cn(
            'ml-auto text-text-muted transition-transform group-hover:text-cyan',
            !open && 'rotate-180'
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3">
              <div className="flex h-20 items-center justify-center rounded-md border border-dashed border-hud/60">
                <span className="font-mono text-[11px] text-text-muted">
                  Nothing here yet — agent activity arrives in a later phase
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
