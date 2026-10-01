import {
  GitBranch,
  GitCommitHorizontal,
  ArrowUp,
  ArrowDown,
  Code2,
  TerminalSquare,
  RefreshCw,
  Trash2,
  FileText,
  Package
} from 'lucide-react'
import type { Project } from '@shared/types/project'
import { TechLabel } from '@/components/ui/TechLabel'
import { StatusDot } from '@/components/ui/StatusDot'
import { cn } from '@/lib/cn'
import { useProjects } from '../store'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1">
      <TechLabel className="mt-0.5 w-24 shrink-0 text-text-muted">{label}</TechLabel>
      <div className="min-w-0 flex-1 font-mono text-[12px] text-text-secondary">{children}</div>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger
}: {
  icon: typeof Code2
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 font-sans text-[12px] font-medium transition-colors disabled:opacity-40',
        danger
          ? 'border-hud/60 text-text-secondary hover:border-danger/50 hover:text-danger'
          : 'border-hud/60 text-text-secondary hover:border-cyan/50 hover:text-cyan'
      )}
    >
      <Icon size={14} strokeWidth={1.8} />
      {label}
    </button>
  )
}

export function ProjectDetailPanel({ project }: { project: Project }) {
  const { refresh, remove, openEditor, openTerminal, busyId } = useProjects()
  const busy = busyId === project.id
  const g = project.git
  const s = project.stack

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <div className="flex items-start justify-between gap-3 border-b border-hud/50 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-sans text-base font-semibold text-text-primary">{project.name}</h2>
          <p className="mt-0.5 truncate font-mono text-[11px] text-text-muted">{project.path}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusDot tone={g?.isRepo ? (g.dirty ? 'warn' : 'ok') : 'muted'} pulse={false} />
          <TechLabel className="text-text-muted">{g?.isRepo ? (g.dirty ? 'dirty' : 'clean') : 'no repo'}</TechLabel>
        </div>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {/* git */}
        {g?.isRepo && (
          <section>
            <TechLabel className="mb-1.5 block text-text-secondary">Git</TechLabel>
            <Row label="Branch">
              <span className="inline-flex items-center gap-1.5">
                <GitBranch size={12} className="text-cyan" />
                {g.branch ?? 'detached'}
              </span>
            </Row>
            {(g.ahead != null || g.behind != null) && (
              <Row label="Upstream">
                <span className="inline-flex items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <ArrowUp size={11} className="text-text-muted" />
                    {g.ahead ?? 0}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ArrowDown size={11} className="text-text-muted" />
                    {g.behind ?? 0}
                  </span>
                </span>
              </Row>
            )}
            {g.lastCommit && (
              <Row label="Last commit">
                <span className="inline-flex items-start gap-1.5">
                  <GitCommitHorizontal size={12} className="mt-0.5 shrink-0 text-text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate text-text-primary">{g.lastCommit.subject}</span>
                    <span className="block text-[10px] text-text-muted">
                      {g.lastCommit.hash.slice(0, 7)} · {g.lastCommit.author}
                    </span>
                  </span>
                </span>
              </Row>
            )}
          </section>
        )}

        {/* stack */}
        <section>
          <TechLabel className="mb-1.5 block text-text-secondary">Stack</TechLabel>
          {s?.languages.length ? (
            <Row label="Languages">{s.languages.join(', ')}</Row>
          ) : (
            <Row label="Languages"><span className="text-text-muted">—</span></Row>
          )}
          {s?.frameworks.length ? (
            <Row label="Frameworks">
              <span className="flex flex-wrap gap-1.5">
                {s.frameworks.map((f) => (
                  <span
                    key={f}
                    className="rounded border border-hud/60 bg-elevated/40 px-1.5 py-0.5 text-[10px] text-text-secondary"
                  >
                    {f}
                  </span>
                ))}
              </span>
            </Row>
          ) : null}
          {s?.packageManager && <Row label="Pkg manager">{s.packageManager}</Row>}
          <Row label="README">
            <span className={cn('inline-flex items-center gap-1.5', s?.hasReadme ? 'text-text-secondary' : 'text-text-muted')}>
              <FileText size={12} />
              {s?.hasReadme ? 'present' : 'none'}
            </span>
          </Row>
          {s?.packageJson?.scripts?.length ? (
            <Row label="Scripts">
              <span className="flex flex-wrap gap-1.5">
                {s.packageJson.scripts.slice(0, 8).map((sc) => (
                  <span
                    key={sc}
                    className="inline-flex items-center gap-1 rounded border border-hud/60 bg-elevated/40 px-1.5 py-0.5 text-[10px] text-text-secondary"
                  >
                    <Package size={10} className="text-text-muted" />
                    {sc}
                  </span>
                ))}
              </span>
            </Row>
          ) : null}
        </section>
      </div>

      {/* actions */}
      <div className="flex flex-wrap gap-2 border-t border-hud/50 px-4 py-3">
        <ActionButton icon={Code2} label="VS Code" onClick={() => openEditor(project.id)} />
        <ActionButton icon={TerminalSquare} label="Terminal" onClick={() => openTerminal(project.id)} />
        <ActionButton icon={RefreshCw} label={busy ? 'Refreshing…' : 'Refresh'} onClick={() => refresh(project.id)} disabled={busy} />
        <div className="flex-1" />
        <ActionButton icon={Trash2} label="Remove" onClick={() => remove(project.id)} disabled={busy} danger />
      </div>
    </div>
  )
}
