import { FolderGit2, GitBranch, FileText, Database } from 'lucide-react'
import { TechLabel } from '@/components/ui/TechLabel'

/** Project / working-context summary. Placeholder data for now. */
export function ProjectContextCard() {
  return (
    <div className="flex h-full flex-col rounded-md border border-hud/50 bg-surface/40 p-3">
      <TechLabel className="text-text-secondary">Project Context</TechLabel>

      <div className="mt-2 flex items-center gap-2">
        <FolderGit2 size={15} className="text-purple" />
        <span className="font-sans text-[13px] font-medium text-text-primary">w-one-ui</span>
      </div>

      <div className="mt-3 space-y-1.5">
        <Row icon={GitBranch} label="Branch" value="scifi-desktop-ui" />
        <Row icon={FileText} label="Scope" value="UI preview" />
        <Row icon={Database} label="Vault" value="not linked" />
      </div>

      <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
        {['electron', 'react', 'tailwind', 'framer', 'xterm'].map((t) => (
          <span
            key={t}
            className="rounded border border-hud/60 bg-elevated/40 px-1.5 py-0.5 font-mono text-[10px] text-text-muted"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}

function Row({
  icon: Icon,
  label,
  value
}: {
  icon: typeof GitBranch
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={13} className="text-text-muted" />
      <span className="tech-label flex-1 text-text-muted">{label}</span>
      <span className="font-mono text-[11px] text-text-secondary">{value}</span>
    </div>
  )
}
