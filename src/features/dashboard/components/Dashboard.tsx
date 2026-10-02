import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpRight, BrainCircuit, Cpu, FolderGit2, GitBranch, Send, Sparkles } from 'lucide-react'
import { ipc } from '@shared/ipc/client'
import type { Project } from '@shared/types/project'
import type { NoteMeta } from '@shared/types/memory'
import type { ModuleId } from '@/types'
import { Panel } from '@/components/ui/Panel'
import { StatusDot } from '@/components/ui/StatusDot'
import { TechLabel } from '@/components/ui/TechLabel'
import { useClock } from '@/hooks/useClock'
import { useProjects } from '@/features/projects/store'
import { useSystemMetrics } from '@/features/system/useSystemMetrics'
import { useAssistant } from '@/features/agents/store'
import { folderColors } from '@/features/memory/store'
import { slotColor } from '@/features/memory/components/GraphView'
import { greeting, isoWeek, longDate, t } from '../i18n'
import { HudClock } from './HudClock'

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const }
})

/**
 * Core: the personal HUD. Greeting, date and a calm clock, plus three tiles
 * with real data only — projects (live git state), the brain (vault), and a
 * one-line system verdict. Everything links into its module.
 */
export function Dashboard({ onNavigate }: { onNavigate: (id: ModuleId) => void }) {
  const now = useClock()
  const [firstName, setFirstName] = useState<string>()

  useEffect(() => {
    ipc('system:user')
      .then((u) => setFirstName(u.firstName))
      .catch(() => {})
  }, [])

  return (
    <Panel title="Command Center" corners className="min-h-0 flex-1" bodyClassName="flex min-h-0 flex-col overflow-y-auto">
      <div className="flex min-h-full flex-col items-center justify-between gap-8 px-6 py-8">
        <motion.header {...rise(0.05)} className="text-center">
          <h1 className="font-sans text-[34px] font-semibold tracking-tight text-text-primary">
            {greeting(now)}
            {firstName && <span className="text-cyan text-glow-cyan">, {firstName}</span>}
          </h1>
          <p className="mt-2 font-sans text-[14px] text-text-secondary">
            {longDate(now)}
            <span className="mx-2 text-text-muted">·</span>
            <span className="font-mono text-[13px] text-text-muted">
              {t.week} {isoWeek(now)}
            </span>
          </p>
        </motion.header>

        <motion.div {...rise(0.15)}>
          <HudClock now={now} />
        </motion.div>

        <motion.div {...rise(0.2)} className="w-full max-w-2xl">
          <AskBar onNavigate={onNavigate} />
        </motion.div>

        <motion.div {...rise(0.25)} className="grid w-full max-w-5xl grid-cols-1 gap-3 md:grid-cols-3">
          <ProjectsTile onNavigate={onNavigate} />
          <BrainTile onNavigate={onNavigate} />
          <SystemTile />
        </motion.div>
      </div>
    </Panel>
  )
}

/** One line to the assistant: starts a new chat and opens the Agents module. */
function AskBar({ onNavigate }: { onNavigate: (id: ModuleId) => void }) {
  const [text, setText] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const question = text.trim()
    if (!question) return
    const a = useAssistant.getState()
    a.newChat('assistant')
    setText('')
    onNavigate('agents')
    void a.send(question)
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-2 rounded-lg border border-hud/70 bg-surface/60 px-3 py-2 backdrop-blur focus-within:border-cyan/50">
      <Sparkles size={15} className="shrink-0 text-cyan" />
      <input
        aria-label="Ask W-ONE"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t.ask}
        className="min-w-0 flex-1 bg-transparent font-sans text-[14px] text-text-primary outline-none placeholder:text-text-muted"
      />
      <button type="submit" aria-label="Ask" disabled={!text.trim()} className="text-cyan disabled:opacity-30">
        <Send size={15} />
      </button>
    </form>
  )
}

function Tile({
  icon: Icon,
  title,
  onOpen,
  children
}: {
  icon: typeof Cpu
  title: string
  onOpen?: () => void
  children: React.ReactNode
}) {
  return (
    <section className="group flex min-h-[150px] flex-col rounded-lg border border-hud/60 bg-surface/40 p-4 transition-colors hover:border-hud-strong/70">
      <header className="mb-3 flex items-center gap-2">
        <Icon size={14} className="text-cyan" />
        <TechLabel className="text-text-secondary">{title}</TechLabel>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Open ${title}`}
            className="ml-auto rounded p-0.5 text-text-muted transition-colors hover:text-cyan"
          >
            <ArrowUpRight size={14} />
          </button>
        )}
      </header>
      {children}
    </section>
  )
}

function BigNumber({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-[28px] font-medium leading-none text-text-primary tabular-nums">{value}</span>
      <span className="font-sans text-[12px] text-text-muted">{label}</span>
    </div>
  )
}

function ProjectsTile({ onNavigate }: { onNavigate: (id: ModuleId) => void }) {
  const [projects, setProjects] = useState<Project[]>()

  // Cached list first, then a live git refresh (git state is never trusted from cache).
  useEffect(() => {
    let alive = true
    ipc('projects:list')
      .then(async (list) => {
        if (!alive) return
        setProjects(list)
        const fresh = await Promise.all(list.map((p) => ipc('projects:refresh', { id: p.id }).catch(() => p)))
        if (alive) setProjects(fresh)
      })
      .catch(() => alive && setProjects([]))
    return () => {
      alive = false
    }
  }, [])

  const open = (id?: string) => {
    if (id) useProjects.getState().select(id)
    onNavigate('projects')
  }

  const dirty = projects?.filter((p) => p.git?.dirty).length ?? 0

  return (
    <Tile icon={FolderGit2} title={t.projects} onOpen={() => open()}>
      {!projects ? (
        <p className="font-mono text-[11px] text-text-muted">{t.loading}</p>
      ) : projects.length === 0 ? (
        <button type="button" onClick={() => open()} className="text-left font-sans text-[13px] text-text-muted hover:text-cyan">
          {t.noProjects} — {t.addProject} →
        </button>
      ) : (
        <>
          <BigNumber value={projects.length} label={dirty ? `${dirty} ${t.changed}` : t.allClean} />
          <ul className="mt-3 space-y-1">
            {projects.slice(0, 3).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => open(p.id)}
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-elevated/50"
                >
                  <StatusDot tone={!p.git?.isRepo ? 'muted' : p.git.dirty ? 'warn' : 'ok'} pulse={false} />
                  <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] text-text-secondary">{p.name}</span>
                  {p.git?.branch && (
                    <span className="flex items-center gap-1 font-mono text-[10px] text-text-muted">
                      <GitBranch size={10} />
                      {p.git.branch}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Tile>
  )
}

function BrainTile({ onNavigate }: { onNavigate: (id: ModuleId) => void }) {
  const [state, setState] = useState<{ exists: boolean; notes: NoteMeta[]; links: number }>()

  useEffect(() => {
    let alive = true
    Promise.all([ipc('memory:status'), ipc('memory:list'), ipc('memory:graph')])
      .then(([status, notes, graph]) => {
        if (alive) setState({ exists: status.exists, notes, links: graph.edges.length })
      })
      .catch(() => alive && setState({ exists: false, notes: [], links: 0 }))
    return () => {
      alive = false
    }
  }, [])

  const slots = useMemo(() => folderColors(state?.notes ?? []), [state])
  const folders = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of state?.notes ?? []) if (n.folder) counts.set(n.folder, (counts.get(n.folder) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  }, [state])

  return (
    <Tile icon={BrainCircuit} title={t.brain} onOpen={() => onNavigate('memory')}>
      {!state ? (
        <p className="font-mono text-[11px] text-text-muted">{t.loading}</p>
      ) : !state.exists ? (
        <button type="button" onClick={() => onNavigate('memory')} className="text-left font-sans text-[13px] text-text-muted hover:text-cyan">
          {t.noVault} — {t.setUp} →
        </button>
      ) : (
        <>
          <BigNumber value={state.notes.length} label={`${t.notes} · ${state.links} ${t.links}`} />
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
            {folders.map(([folder, count]) => (
              <span key={folder} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: slotColor(slots.get(folder)!) }} />
                <span className="font-sans text-[12px] text-text-secondary">{folder}</span>
                <span className="font-mono text-[10px] text-text-muted">{count}</span>
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onNavigate('memory')}
            className="mt-auto self-start pt-3 font-sans text-[12px] text-text-muted transition-colors hover:text-cyan"
          >
            {t.openGraph} →
          </button>
        </>
      )}
    </Tile>
  )
}

function SystemTile() {
  const { metrics: m, battery, live } = useSystemMetrics()

  const warnings = [
    m.cpu.value > 85 && t.cpuHigh,
    m.ram.value > 90 && t.ramHigh,
    m.disk.value > 90 && t.diskHigh,
    battery.hasBattery && !battery.charging && m.battery.value < 20 && t.batteryLow
  ].filter(Boolean) as string[]

  const stats: [string, number][] = [
    ['CPU', m.cpu.value],
    ['RAM', m.ram.value],
    ['Disk', m.disk.value],
    ...(battery.hasBattery ? [[t.battery, m.battery.value] as [string, number]] : [])
  ]

  return (
    <Tile icon={Cpu} title={t.system}>
      {!live ? (
        <p className="font-mono text-[11px] text-text-muted">{t.loading}</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <StatusDot tone={warnings.length ? 'warn' : 'ok'} />
            <span className="font-sans text-[14px] font-medium text-text-primary">{warnings[0] ?? t.allGood}</span>
          </div>
          {warnings.length > 1 && (
            <p className="mt-1 font-sans text-[12px] text-amber">{warnings.slice(1).join(' · ')}</p>
          )}
          <div className="mt-auto grid grid-cols-4 gap-2 pt-4">
            {stats.map(([label, value]) => (
              <div key={label}>
                <div className="font-mono text-[15px] text-text-primary tabular-nums">
                  {Math.round(value)}
                  <span className="text-[10px] text-text-muted">%</span>
                </div>
                <div className="tech-label mt-1 truncate text-text-muted">
                  {label}
                  {label === t.battery && battery.charging ? ' ⚡' : ''}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Tile>
  )
}
