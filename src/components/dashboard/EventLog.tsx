import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TechLabel } from '@/components/ui/TechLabel'
import { StatusDot, toneFromLevel } from '@/components/ui/StatusDot'
import { MOCK_EVENTS, EVENT_POOL } from '@/data/mockEvents'
import { formatTime } from '@/lib/format'
import type { SystemEvent } from '@/types'

/**
 * Live-ish system events. Seeds from MOCK_EVENTS then periodically prepends a
 * random event from EVENT_POOL so the panel feels active. Capped to 8 rows.
 */
export function EventLog() {
  const [events, setEvents] = useState<SystemEvent[]>(MOCK_EVENTS)

  useEffect(() => {
    const id = window.setInterval(() => {
      const pick = EVENT_POOL[Math.floor(Math.random() * EVENT_POOL.length)]
      const next: SystemEvent = {
        ...pick,
        id: `e-${Date.now()}`,
        time: formatTime(new Date())
      }
      setEvents((prev) => [next, ...prev].slice(0, 8))
    }, 3800)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border border-hud/50 bg-surface/40 p-3">
      <div className="flex items-center justify-between">
        <TechLabel className="text-text-secondary">System Events</TechLabel>
        <span className="flex items-center gap-1.5">
          <StatusDot tone="cyan" />
          <span className="font-mono text-[9px] text-text-muted">STREAM</span>
        </span>
      </div>

      <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {events.map((e) => (
            <motion.li
              key={e.id}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 py-0.5"
            >
              <StatusDot tone={toneFromLevel(e.level)} pulse={false} />
              <span className="w-14 shrink-0 font-mono text-[10px] text-text-muted">{e.time}</span>
              <span className="w-12 shrink-0 font-mono text-[10px] uppercase text-cyan/80">
                {e.source}
              </span>
              <span className="min-w-0 flex-1 truncate font-sans text-[11.5px] text-text-secondary">
                {e.message}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}
