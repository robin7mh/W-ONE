import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Code2, ExternalLink, FileWarning, FolderGit2, Lock, RefreshCw } from 'lucide-react'
import { ipc, isDesktop } from '@shared/ipc/client'
import { Panel } from '@/components/ui/Panel'
import { isMac } from '@/lib/platform'
import { cn } from '@/lib/cn'
import { useProjects } from '@/features/projects/store'
import { useSession } from '@/features/session/store'
import type { ModuleId } from '@/types'
import { useEditor, type EditorTab } from '../store'
import { FileTree } from './FileTree'
import { EditorTabs } from './EditorTabs'
import type { CursorInfo } from './CodeEditor'

// Monaco is a few MB — it loads the first time the Editor module opens.
const CodeEditor = lazy(() => import('./CodeEditor'))

/** How often open files are compared with the disk while the editor is visible. */
const DISK_POLL_MS = 3000

const button =
  'flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-sans text-[12px] font-medium transition-colors'
const primary = cn(button, 'border-cyan/40 bg-cyan/[0.06] text-cyan hover:bg-cyan/[0.12]')
const quiet = cn(button, 'border-hud/60 text-text-secondary hover:border-hud-strong hover:text-text-primary')

function Banner({ tone, children }: { tone: 'warn' | 'info'; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 font-sans text-[12.5px]',
        tone === 'warn' ? 'border-amber/30 bg-amber/[0.07] text-text-primary' : 'border-hud/60 bg-elevated/40 text-text-secondary'
      )}
    >
      {children}
    </div>
  )
}

function Centered({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
      {icon}
      <p className="font-sans text-[14px] font-semibold text-text-primary">{title}</p>
      {children}
    </div>
  )
}

/** What the editor area shows when the active tab has no text to edit. */
function Placeholder({ tab, onExternal }: { tab?: EditorTab; onExternal?: () => void }) {
  const key = isMac ? '⌘' : 'Ctrl+'
  if (!tab) {
    return (
      <Centered icon={<Code2 size={28} className="text-text-muted" />} title="Open a file from the explorer">
        <p className="font-mono text-[11px] text-text-muted">
          {key}S save · {key}F find · F1 all commands
        </p>
      </Centered>
    )
  }
  if (tab.loading) return <Centered icon={<RefreshCw size={22} className="animate-spin text-text-muted" />} title="Loading…" />
  const vsCode = onExternal && (
    <button type="button" onClick={onExternal} className={quiet}>
      <ExternalLink size={13} /> Open in VS Code
    </button>
  )
  if (tab.unsupported) {
    return (
      <Centered
        icon={<FileWarning size={28} className="text-text-muted" />}
        title={tab.unsupported === 'binary' ? 'Binary file' : 'Larger than 5 MB'}
      >
        <p className="font-sans text-[13px] text-text-secondary">W-ONE only edits text files up to 5 MB.</p>
        {vsCode}
      </Centered>
    )
  }
  return (
    <Centered icon={<AlertTriangle size={26} className="text-danger" />} title="Couldn't open this file">
      <p className="font-sans text-[13px] text-text-secondary">{tab.error}</p>
      <button type="button" onClick={() => void useEditor.getState().reload(tab.id)} className={quiet}>
        <RefreshCw size={13} /> Try again
      </button>
    </Centered>
  )
}

/**
 * The Editor module: a project's files on the left, open files as tabs, and
 * Monaco — VS Code's editor core — in the middle. Saving is explicit (⌘S);
 * the disk stays the source of truth: changes made elsewhere (an agent, git,
 * VS Code) flow into clean tabs, and conflicting ones ask first.
 */
export function EditorView({ active, onNavigate }: { active: boolean; onNavigate: (id: ModuleId) => void }) {
  const projects = useProjects((s) => s.projects)
  const [projectsLoaded, setProjectsLoaded] = useState(projects.length > 0)
  const { projectId, tabs, activeId, closing } = useEditor()
  const tab = tabs.find((t) => t.id === activeId)
  const closingTab = tabs.find((t) => t.id === closing)
  const info = useSession((s) => s.info)
  const desktop = isDesktop()
  // Writing project files can run code (hooks, scripts) — remote clients may
  // only when the core allows remote shells.
  const readOnly = !desktop && info?.remoteTerminal === false
  const [cursor, setCursor] = useState<CursorInfo>()
  const names = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])

  useEffect(() => {
    void useProjects
      .getState()
      .load()
      .then(() => setProjectsLoaded(true))
  }, [])

  // Pick a project: the one selected in Projects, else the first.
  useEffect(() => {
    if (!projects.length || projects.some((p) => p.id === useEditor.getState().projectId)) return
    const selected = useProjects.getState().selectedId
    void useEditor.getState().selectProject((projects.find((p) => p.id === selected) ?? projects[0]).id)
  }, [projects])

  // While visible: follow the disk, and ⌘S / Ctrl+S saves.
  useEffect(() => {
    if (!active) return
    const check = () => void useEditor.getState().checkDisk()
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      void useEditor.getState().save()
    }
    check()
    const timer = window.setInterval(check, DISK_POLL_MS)
    window.addEventListener('focus', check)
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      window.removeEventListener('keydown', onKey)
    }
  }, [active])

  // Unsaved edits veto closing the window; the desktop app then asks (main.ts).
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (!useEditor.getState().tabs.some((t) => t.dirty)) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  const openExternal = desktop
    ? () => {
        const call = tab
          ? ipc('projects:openFile', { id: tab.projectId, file: tab.path, line: cursor?.line })
          : ipc('projects:openInEditor', { id: projectId! })
        void call.catch(() => {})
      }
    : undefined

  if (!projects.length) {
    return (
      <Panel title="Editor" corners className="min-h-0 flex-1" bodyClassName="relative">
        {projectsLoaded && (
          <Centered icon={<FolderGit2 size={28} className="text-text-muted" />} title="No projects yet">
            <p className="font-sans text-[13px] text-text-secondary">The editor opens the files of your projects.</p>
            <button type="button" onClick={() => onNavigate('projects')} className={primary}>
              Add a project
            </button>
          </Centered>
        )}
      </Panel>
    )
  }

  const hasText = tab?.content !== undefined

  return (
    <Panel
      title="Editor"
      corners
      flush
      className="min-h-0 flex-1"
      bodyClassName="flex"
      headerRight={
        openExternal && (
          <button type="button" onClick={openExternal} className={quiet} title="Open in VS Code">
            <ExternalLink size={13} /> VS Code
          </button>
        )
      }
    >
      {/* Explorer */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-hud/60">
        <div className="flex items-center gap-1.5 p-2">
          <select
            aria-label="Project"
            value={projectId ?? ''}
            onChange={(e) => void useEditor.getState().selectProject(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-hud/60 bg-surface/50 px-2 py-1.5 font-sans text-[12.5px] text-text-primary outline-none focus:border-cyan/50"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Refresh files"
            onClick={() => void useEditor.getState().refreshTree()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-elevated/60 hover:text-cyan"
          >
            <RefreshCw size={13} />
          </button>
        </div>
        {projectId && <FileTree projectId={projectId} />}
      </aside>

      {/* Tabs · banners · Monaco · status */}
      <section className="flex min-w-0 flex-1 flex-col">
        <EditorTabs projectNames={names} />

        {closingTab ? (
          <Banner tone="warn">
            <span className="mr-auto">Save changes to {closingTab.name} before closing?</span>
            <button type="button" onClick={() => void useEditor.getState().saveAndClose(closingTab.id)} className={primary} disabled={readOnly}>
              Save
            </button>
            <button type="button" onClick={() => useEditor.getState().close(closingTab.id)} className={quiet}>
              Don't save
            </button>
            <button type="button" onClick={() => useEditor.getState().cancelClose()} className={quiet}>
              Cancel
            </button>
          </Banner>
        ) : tab?.conflict ? (
          <Banner tone="warn">
            <span className="mr-auto">{tab.name} changed on disk while you were editing.</span>
            <button type="button" onClick={() => void useEditor.getState().reload(tab.id)} className={quiet}>
              Load disk version
            </button>
            <button type="button" onClick={() => void useEditor.getState().save(tab.id, { force: true })} className={primary} disabled={readOnly}>
              Keep mine
            </button>
          </Banner>
        ) : tab?.deleted ? (
          <Banner tone="info">{tab.name} was deleted on disk — saving creates it again.</Banner>
        ) : tab?.error && hasText ? (
          <Banner tone="warn">
            <AlertTriangle size={13} className="text-danger" /> {tab.error}
          </Banner>
        ) : null}

        <div className="relative min-h-0 flex-1">
          <Suspense fallback={<Centered icon={<RefreshCw size={22} className="animate-spin text-text-muted" />} title="Starting the editor…" />}>
            <CodeEditor tab={tab} readOnly={readOnly} onCursor={setCursor} />
          </Suspense>
          {!hasText && (
            <div className="absolute inset-0 bg-panel/80">
              <Placeholder tab={tab} onExternal={openExternal} />
            </div>
          )}
        </div>

        {tab && hasText && (
          <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-hud/60 px-3 font-mono text-[11px] text-text-muted">
            <span className="min-w-0 flex-1 truncate">
              {names.get(tab.projectId)} › {tab.path.split('/').join(' › ')}
            </span>
            {readOnly && (
              <span className="flex items-center gap-1" title="This W-ONE core does not allow remote edits (remote shells are off)">
                <Lock size={11} /> Read-only
              </span>
            )}
            {cursor && (
              <span>
                Ln {cursor.line}, Col {cursor.col}
              </span>
            )}
            {cursor && <span>{cursor.language}</span>}
            <span className={cn(tab.dirty && 'text-amber')}>{tab.saving ? 'Saving…' : tab.dirty ? 'Unsaved' : 'Saved'}</span>
          </footer>
        )}
      </section>
    </Panel>
  )
}
