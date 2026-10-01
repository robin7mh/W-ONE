import { useEffect } from 'react'
import { FolderPlus, FolderGit2, AlertTriangle } from 'lucide-react'
import { Panel } from '@/components/ui/Panel'
import { TechLabel } from '@/components/ui/TechLabel'
import { useProjects, useSelectedProject } from '../store'
import { ProjectListItem } from './ProjectList'
import { ProjectDetailPanel } from './ProjectDetailPanel'

export function ProjectsView() {
  const { projects, selectedId, loading, error, load, addViaPicker, select } = useProjects()
  const selected = useSelectedProject()

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Panel
      title="Projects"
      corners
      flush
      className="min-h-0 flex-1"
      headerRight={
        <div className="flex items-center gap-3">
          <TechLabel className="text-text-muted">{projects.length} registered</TechLabel>
          <button
            type="button"
            onClick={() => void addViaPicker()}
            className="flex items-center gap-1.5 rounded-md border border-cyan/40 bg-cyan/[0.06] px-2.5 py-1 font-sans text-[12px] font-medium text-cyan transition-colors hover:bg-cyan/[0.12]"
          >
            <FolderPlus size={14} strokeWidth={2} />
            Add project
          </button>
        </div>
      }
      bodyClassName="flex min-h-0"
    >
      {/* left: list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-hud/50">
        {error && (
          <div className="m-2 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/[0.06] px-2.5 py-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-danger" />
            <span className="font-mono text-[11px] text-text-secondary">{error}</span>
          </div>
        )}
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
          {loading && projects.length === 0 && (
            <p className="px-2 py-4 font-mono text-[11px] text-text-muted">Loading…</p>
          )}
          {!loading && projects.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
              <FolderGit2 size={26} className="text-text-muted" />
              <p className="font-sans text-[12px] text-text-secondary">No projects yet</p>
              <p className="font-mono text-[10px] text-text-muted">Add a folder to get started</p>
            </div>
          )}
          {projects.map((p) => (
            <ProjectListItem
              key={p.id}
              project={p}
              active={p.id === selectedId}
              onSelect={() => select(p.id)}
            />
          ))}
        </div>
      </div>

      {/* right: detail */}
      <div className="min-w-0 flex-1">
        {selected ? (
          <ProjectDetailPanel project={selected} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="font-mono text-[12px] text-text-muted">Select a project</p>
          </div>
        )}
      </div>
    </Panel>
  )
}
