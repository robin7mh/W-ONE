import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { GlowBackground } from './GlowBackground'
import { ModulePlaceholder } from './ModulePlaceholder'
import { TopStatusBar } from '@/components/topbar/TopStatusBar'
import { SideNavigation } from '@/components/nav/SideNavigation'
import { MainCommandPanel } from '@/components/command/MainCommandPanel'
import { ProjectsView } from '@/features/projects/components/ProjectsView'
import { SystemMonitorPanel } from '@/components/monitor/SystemMonitorPanel'
import { BottomDashboard } from '@/components/dashboard/BottomDashboard'
import { BootSequence, BOOT_TOTAL_MS } from '@/components/boot/BootSequence'
import { useBoot } from '@/hooks/useBoot'
import { NAV_ITEMS } from '@/data/navigation'
import type { ModuleId } from '@/types'

/** Framer stagger for the primary panels entering after boot. */
const panelIn = (delay: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] as const }
})

export function AppShell() {
  const { booted, skip } = useBoot(BOOT_TOTAL_MS)
  const [active, setActive] = useState<ModuleId>('core')
  const [uptime, setUptime] = useState(0)

  // Session uptime ticker (starts once booted).
  useEffect(() => {
    if (!booted) return
    const id = window.setInterval(() => setUptime((u) => u + 1), 1000)
    return () => window.clearInterval(id)
  }, [booted])

  const isCore = active === 'core' || active === 'terminal'
  const activeItem = NAV_ITEMS.find((n) => n.id === active)!

  const renderMain = () => {
    if (active === 'projects') return <ProjectsView />
    if (isCore) return <MainCommandPanel active={booted} />
    return <ModulePlaceholder item={activeItem} />
  }

  return (
    <div className="relative flex h-screen min-h-[560px] w-screen flex-col overflow-hidden">
      <GlowBackground />

      <AnimatePresence>{!booted && <BootSequence onSkip={skip} />}</AnimatePresence>

      {/* Top bar */}
      <motion.div {...panelIn(0.05)}>
        <TopStatusBar uptime={uptime} />
      </motion.div>

      {/* Body: nav · main · monitor */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <motion.div {...panelIn(0.12)} className="flex">
          <SideNavigation active={active} onSelect={setActive} />
        </motion.div>

        <main className="flex min-w-0 flex-1 gap-2.5 overflow-hidden p-2.5">
          <motion.div {...panelIn(0.18)} className="flex min-w-0 flex-1 flex-col">
            {renderMain()}
          </motion.div>

          {/* Monitor rail — hidden on small widths to avoid crowding */}
          <motion.div
            {...panelIn(0.24)}
            className="hidden w-72 shrink-0 lg:flex 2xl:w-80"
          >
            <SystemMonitorPanel />
          </motion.div>
        </main>
      </div>

      {/* Bottom command deck (keyboard replacement) */}
      <motion.div {...panelIn(0.3)}>
        <BottomDashboard uptime={uptime} />
      </motion.div>
    </div>
  )
}
