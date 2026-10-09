import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Columns2, FolderGit2, Grid2x2, House, Plus, Rows2, Square, TerminalSquare, X } from 'lucide-react'
import { ipc } from '@shared/ipc/client'
import type { Project } from '@shared/types/project'
import { Panel } from '@/components/ui/Panel'
import { StatusDot } from '@/components/ui/StatusDot'
import { TechLabel } from '@/components/ui/TechLabel'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { LAYOUT_GRID, tabLabels, useTerminals, type TerminalLayout } from '../store'
import { XtermPane } from './XtermPane'

/** Split layouts; each label is `t.terminal[id]`. */
const LAYOUTS: { id: TerminalLayout; icon: typeof Square }[] = [
  { id: 'single', icon: Square },
  { id: 'cols', icon: Columns2 },
  { id: 'rows', icon: Rows2 },
  { id: 'grid', icon: Grid2x2 }
]

/**
 * The Terminal module: real shells (node-pty in main), all of them in one
 * grid. The layout sets how many fill a screen — one, side by side, stacked or
 * 2×2 — and further shells continue below, so the area scrolls. Tabs jump to a
 * shell. "+" opens one in Home or a registered project. Sessions keep running
 * while you're in other modules — the shell mounts this view once and hides it.
 */
export function TerminalView() {
  const tr = useT()
  const { tabs, activeId, layout, error, init, open, close, setActive, setLayout } = useTerminals()
  const active = tabs.find((t) => t.id === activeId)
  const { cols, rows } = LAYOUT_GRID[layout]
  const split = layout !== 'single'
  // Frames show where one shell ends and the next begins.
  const framed = split || tabs.length > 1
  // Split layouts fill the first screen and the last row with "new terminal" panes.
  const empty = split ? Math.max(cols * rows, Math.ceil(tabs.length / cols) * cols) - tabs.length : 0
  const labels = tabLabels(tabs)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void init()
  }, [init])

  // Keep the active shell in sight: after a tab click, a new shell, a layout switch.
  useEffect(() => {
    scrollRef.current!.querySelector(`[data-terminal="${activeId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId, layout])

  return (
    <Panel
      title={tr.terminal.title}
      corners
      flush
      className="min-h-0 flex-1"
      bodyClassName="flex min-h-0 flex-col"
      headerRight={
        active && (
          <span className="truncate font-mono text-[11px] text-text-muted">
            {active.shell} · {active.cwdLabel}
          </span>
        )
      }
    >
      {/* Tab strip scrolls on its own; "+" and the layout picker sit outside it
          so the "+" menu can drop down without being clipped. */}
      <div className="flex items-center gap-1 border-b border-hud/50 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={cn(
                'group flex shrink-0 items-center gap-1 rounded-md border pl-2 pr-1 transition-colors',
                t.id === activeId ? 'border-cyan/40 bg-cyan/[0.06] text-text-primary' : 'border-hud/50 text-text-secondary hover:bg-elevated/50'
              )}
            >
              <button type="button" onClick={() => setActive(t.id)} className="flex items-center gap-1.5 py-1">
                <StatusDot tone={t.exitCode === undefined ? 'ok' : 'muted'} pulse={false} />
                <span className="font-mono text-[11.5px]">{labels.get(t.id)}</span>
              </button>
              <button
                type="button"
                aria-label={tr.terminal.close(labels.get(t.id)!)}
                onClick={() => void close(t.id)}
                className={cn(
                  'rounded p-0.5 text-text-muted transition-opacity hover:bg-elevated hover:text-text-primary',
                  t.id === activeId ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <NewTerminalMenu onOpen={(projectId) => void open(projectId)} />

        <div className="ml-auto flex shrink-0 rounded-md border border-hud/60 bg-surface/50 p-0.5">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              title={tr.terminal[l.id]}
              aria-label={tr.terminal.layout(tr.terminal[l.id])}
              aria-pressed={layout === l.id}
              onClick={() => setLayout(l.id)}
              className={cn(
                'flex h-6 w-7 items-center justify-center rounded transition-colors',
                layout === l.id ? 'bg-cyan/10 text-cyan' : 'text-text-muted hover:text-text-secondary'
              )}
            >
              <l.icon size={13} />
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 border-b border-danger/30 bg-danger/[0.06] px-3 py-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-danger" />
          <span className="font-mono text-[11px] text-text-secondary">{error}</span>
        </div>
      )}

      {/* Row height = one screen / rows per screen (container query units of
          the scroll area itself), so the layout fills the screen exactly. */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto [container-type:size]">
        {split || tabs.length > 0 ? (
          <div
            className={cn('grid', framed && 'p-1')}
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: framed ? `calc((100cqh - 8px) / ${rows})` : '100cqh' }}
          >
            {tabs.map((t) => (
              <XtermPane key={t.id} tab={t} label={labels.get(t.id)!} active={t.id === activeId} framed={framed} />
            ))}
            {/* empty panes let the user open a shell (Home or a project) */}
            {Array.from({ length: empty }, (_, k) => (
              <div key={`empty-${k}`} className="p-1">
                <NewTerminalMenu variant="pane" onOpen={(projectId) => void open(projectId)} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <TerminalSquare size={26} className="text-text-muted" />
            <button
              type="button"
              onClick={() => void open()}
              className="rounded-md border border-cyan/40 bg-cyan/[0.06] px-3 py-1.5 font-sans text-[12px] font-medium text-cyan transition-colors hover:bg-cyan/[0.12]"
            >
              {tr.terminal.open}
            </button>
          </div>
        )}
      </div>
    </Panel>
  )
}

/**
 * "New terminal" chooser: Home or a registered project. `icon` is the "+" in
 * the tab strip; `pane` fills an empty split pane with a dashed button.
 */
function NewTerminalMenu({
  onOpen,
  variant = 'icon'
}: {
  onOpen: (projectId?: string) => void
  variant?: 'icon' | 'pane'
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    ipc('projects:list')
      .then(setProjects)
      .catch(() => setProjects([]))
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (projectId?: string) => {
    setOpen(false)
    onOpen(projectId)
  }

  const item =
    'flex w-full items-center gap-2 px-3 py-1.5 text-left font-sans text-[12.5px] text-text-secondary transition-colors hover:bg-elevated/60 hover:text-text-primary'

  return (
    <div ref={ref} className={cn('relative', variant === 'pane' ? 'h-full w-full' : 'shrink-0')}>
      {variant === 'pane' ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-full w-full items-center justify-center gap-2 rounded-md border border-dashed border-hud/60 font-sans text-[12px] text-text-muted transition-colors hover:border-cyan/40 hover:text-cyan"
        >
          <Plus size={14} /> {t.terminal.new}
        </button>
      ) : (
        <button
          type="button"
          title={t.terminal.new}
          aria-label={t.terminal.new}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-elevated/60 hover:text-cyan"
        >
          <Plus size={14} />
        </button>
      )}
      {open && (
        <div
          className={cn(
            'absolute z-30 w-60 rounded-md border border-hud/60 bg-panel py-1 shadow-lg',
            variant === 'pane' ? 'left-1/2 top-1/2 mt-6 -translate-x-1/2' : 'left-0 top-full mt-1'
          )}
        >
          <button type="button" onClick={() => pick()} className={item}>
            <House size={13} className="text-text-muted" />
            {t.terminal.home}
          </button>
          {projects.length > 0 && <TechLabel className="block px-3 pb-1 pt-2 text-text-muted">{t.terminal.projects}</TechLabel>}
          {projects.map((p) => (
            <button key={p.id} type="button" onClick={() => pick(p.id)} className={item}>
              <FolderGit2 size={13} className="text-text-muted" />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
