import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TerminalSquare } from 'lucide-react'
import { GlowBackground } from './GlowBackground'
import { Panel } from '@/components/ui/Panel'
import { isDesktop } from '@shared/ipc/client'
import { TopStatusBar } from '@/components/topbar/TopStatusBar'
import { SideNavigation } from '@/components/nav/SideNavigation'
import { TerminalView } from '@/features/terminal/components/TerminalView'
import { EditorView } from '@/features/editor/components/EditorView'
import { Dashboard } from '@/features/dashboard/components/Dashboard'
import { ProjectsView } from '@/features/projects/components/ProjectsView'
import { MemoryView } from '@/features/memory/components/MemoryView'
import { AgentsView } from '@/features/agents/components/AgentsView'
import { ApprovalToasts } from '@/features/agents/components/ApprovalToasts'
import { useAssistant } from '@/features/agents/store'
import { useAgents } from '@/features/agents/sessions'
import { useMemory } from '@/features/memory/store'
import { SettingsView } from '@/features/settings/components/SettingsView'
import { SystemView } from '@/features/system/components/SystemView'
import { AccountView } from '@/features/account/components/AccountView'
import { BrowserView } from '@/features/browser/components/BrowserView'
import { useBrowser } from '@/features/browser/store'
import { FilesView } from '@/features/files/components/FilesView'
import { getT, useT } from '@/lib/i18n'
import { useSession } from '@/features/session/store'
import { SystemMonitorPanel } from '@/components/monitor/SystemMonitorPanel'
import { BottomDashboard } from '@/components/dashboard/BottomDashboard'
import { BootSequence, BOOT_TOTAL_MS } from '@/components/boot/BootSequence'
import { useBoot } from '@/hooks/useBoot'
import type { ModuleId } from '@/types'

/** Browser without remote shells: explain instead of failing. */
function RemoteShellsOff() {
  const t = useT()
  return (
    <Panel title={t.nav.terminal} corners className="min-h-0 flex-1" bodyClassName="flex items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-3 p-6 text-center">
        <TerminalSquare size={28} className="text-text-muted" />
        <p className="font-sans text-[14px] font-semibold text-text-primary">{t.shell.shellsOffTitle}</p>
        <p className="font-sans text-[13px] text-text-secondary">
          {t.shell.shellsOffBefore} <code className="font-mono text-cyan">MINDECK_REMOTE_TERMINAL=1</code>
          {t.shell.shellsOffAfter}
        </p>
      </div>
    </Panel>
  )
}

/** Framer stagger for the primary panels entering after boot. */
const panelIn = (delay: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] as const }
})

export function AppShell() {
  const { booted, skip } = useBoot(BOOT_TOTAL_MS)
  const [active, setActive] = useState<ModuleId>('core')
  // Session uptime counts from boot. Only the top bar's indicator ticks — a
  // per-second state here would re-render every module, editor included.
  const [bootedAt, setBootedAt] = useState<number>()
  useEffect(() => {
    if (booted) setBootedAt(Date.now())
  }, [booted])

  // Terminal, Editor and Browser mount on first visit and then stay mounted (hidden), so
  // running shells, open files and their undo history, and the address bar survive switching modules.
  const [kept, setKept] = useState<{ terminal?: boolean; editor?: boolean; browser?: boolean }>({})
  useEffect(() => {
    if (active === 'terminal' || active === 'editor' || active === 'browser') setKept((k) => (k[active] ? k : { ...k, [active]: true }))
  }, [active])

  // Agents' push events (approvals, sessions, activity) matter in every module —
  // and so does the browser: links from anywhere open in it.
  useEffect(() => {
    const offAssistant = useAssistant.getState().connect()
    const offAgents = useAgents.getState().connect()
    const offBrowser = useBrowser.getState().connect({
      reveal: () => setActive('browser'),
      sendToAgent: (tab) => {
        setActive('agents')
        useAgents.getState().openDialog(getT().browser.agentPrompt(tab.title || tab.url, tab.url))
      },
      settings: () => setActive('settings')
    })
    return () => {
      offAssistant()
      offAgents()
      offBrowser()
    }
  }, [])
  // The chat open in the Agents module shows its approvals inline — no toast for it.
  const activeChat = useAssistant((s) => s.activeId)
  const activeSession = useAgents((s) => (s.view === 'session' ? s.activeId : undefined))
  const activeConversation = activeSession ?? activeChat
  const info = useSession((s) => s.info)
  const shellsOff = !isDesktop() && info?.remoteTerminal === false

  const openConversation = (id: string) => {
    setActive('agents')
    useAgents.getState().showAssistant()
    void useAssistant.getState().open(id)
  }
  const openSession = (id: string) => {
    setActive('agents')
    void useAgents.getState().open(id)
  }
  const openNote = (path: string) => {
    setActive('memory')
    void useMemory.getState().open(path)
  }

  const renderMain = () => {
    if (active === 'projects') return <ProjectsView onNavigate={setActive} />
    if (active === 'memory') return <MemoryView />
    if (active === 'agents') return <AgentsView onOpenNote={openNote} onOpenSettings={() => setActive('settings')} />
    if (active === 'system') return <SystemView />
    if (active === 'settings') return <SettingsView />
    if (active === 'account') return <AccountView />
    if (active === 'files') return <FilesView onNavigate={setActive} />
    if (active === 'browser') return null
    if (active === 'terminal') return shellsOff ? <RemoteShellsOff /> : null
    if (active === 'editor') return null
    return <Dashboard onNavigate={setActive} />
  }
  // The monitor rail belongs to the Core dashboard; every other module uses the full width.
  const showRail = active === 'core'

  return (
    <div className="relative flex h-screen min-h-[560px] w-screen flex-col overflow-hidden">
      <GlowBackground />

      <AnimatePresence>{!booted && <BootSequence onSkip={skip} />}</AnimatePresence>

      {/* Top bar */}
      <motion.div {...panelIn(0.05)}>
        <TopStatusBar since={bootedAt} showClock={active !== 'core'} />
      </motion.div>

      {/* Body: nav · main · monitor */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <motion.div {...panelIn(0.12)} className="flex">
          <SideNavigation active={active} onSelect={setActive} />
        </motion.div>

        <main className="flex min-w-0 flex-1 gap-2.5 overflow-hidden p-2.5">
          <motion.div {...panelIn(0.18)} className="flex min-w-0 flex-1 flex-col">
            {renderMain()}
            {kept.terminal && !shellsOff && (
              <div className={active === 'terminal' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
                <TerminalView onNavigate={setActive} />
              </div>
            )}
            {kept.editor && (
              <div className={active === 'editor' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
                <EditorView active={active === 'editor'} onNavigate={setActive} />
              </div>
            )}
            {kept.browser && (
              <div className={active === 'browser' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
                <BrowserView active={active === 'browser'} />
              </div>
            )}
          </motion.div>

          {/* Monitor rail — Core only, hidden on small widths */}
          {showRail && (
            <motion.div
              {...panelIn(0.24)}
              className="hidden w-72 shrink-0 lg:flex 2xl:w-80"
            >
              <SystemMonitorPanel />
            </motion.div>
          )}
        </main>
      </div>

      {/* Bottom command deck (collapsible) */}
      <motion.div {...panelIn(0.3)}>
        <BottomDashboard onOpenConversation={openConversation} onOpenSession={openSession} />
      </motion.div>

      {/* Approvals float above every module (the open chat shows its own inline; the
          browser's page would cover them, so it shows them above the page). */}
      {booted && !(active === 'browser' && isDesktop()) && <ApprovalToasts hideConversation={active === 'agents' ? activeConversation : undefined} />}
    </div>
  )
}
