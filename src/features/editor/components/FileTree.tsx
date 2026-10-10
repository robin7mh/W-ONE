import { ChevronRight, File, FileCode2, FileImage, FileJson, FileText, Folder, FolderOpen, type LucideIcon } from 'lucide-react'
import type { FileEntry } from '@shared/types/files'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { tabKey, useEditor } from '../store'

const CODE = /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|sh|zsh|vue|svelte|css|scss|less|html?|sql|ya?ml|toml)$/i
const ICONS: [RegExp, LucideIcon, string][] = [
  [/\.(json|jsonc)$/i, FileJson, 'text-amber/80'],
  [/\.(md|mdx|txt)$/i, FileText, 'text-green/80'],
  [/\.(png|jpe?g|gif|svg|webp|ico|avif)$/i, FileImage, 'text-purple/80'],
  [CODE, FileCode2, 'text-blue/80']
]

/** Icon + tint for a file name (a few families, VS Code-like but calm). */
export function fileIcon(name: string): { Icon: LucideIcon; tint: string } {
  const hit = ICONS.find(([re]) => re.test(name))
  return hit ? { Icon: hit[1], tint: hit[2] } : { Icon: File, tint: 'text-text-muted' }
}

const row =
  'flex w-full items-center gap-1.5 rounded py-[3px] pr-2 text-left font-sans text-[12.5px] transition-colors hover:bg-elevated/60'

function Level({ projectId, entries, depth }: { projectId: string; entries: FileEntry[]; depth: number }) {
  const tree = useEditor((s) => s.tree)
  const expanded = useEditor((s) => s.expanded)
  const activeId = useEditor((s) => s.activeId)
  const pad = { paddingLeft: 6 + depth * 12 }

  return (
    <>
      {entries.map((e) => {
        if (e.kind === 'dir') {
          const key = tabKey(projectId, e.path)
          const open = !!expanded[key]
          const children = tree[key]
          return (
            <div key={e.path}>
              <button
                type="button"
                role="treeitem"
                aria-expanded={open}
                style={pad}
                onClick={() => void useEditor.getState().toggleDir(e.path)}
                className={cn(row, 'text-text-secondary', e.ignored && 'opacity-50')}
              >
                <ChevronRight size={12} className={cn('shrink-0 text-text-muted transition-transform', open && 'rotate-90')} />
                {open ? <FolderOpen size={13} className="shrink-0 text-cyan/70" /> : <Folder size={13} className="shrink-0 text-cyan/70" />}
                <span className="truncate">{e.name}</span>
              </button>
              {open && children && <Level projectId={projectId} entries={children} depth={depth + 1} />}
            </div>
          )
        }
        const { Icon, tint } = fileIcon(e.name)
        const active = activeId === tabKey(projectId, e.path)
        return (
          <button
            key={e.path}
            type="button"
            role="treeitem"
            aria-selected={active}
            title={e.path}
            style={{ paddingLeft: pad.paddingLeft + 14 }}
            onClick={() => void useEditor.getState().open(e.path)}
            className={cn(
              row,
              active ? 'bg-cyan/10 text-text-primary' : 'text-text-secondary hover:text-text-primary',
              e.ignored && 'opacity-50'
            )}
          >
            <Icon size={13} className={cn('shrink-0', tint)} />
            <span className="truncate">{e.name}</span>
          </button>
        )
      })}
    </>
  )
}

/**
 * The explorer: one project's folders, listed lazily as they are opened.
 * Git-ignored entries are dimmed; `.git` itself never shows.
 */
export function FileTree({ projectId }: { projectId: string }) {
  const t = useT()
  const root = useEditor((s) => s.tree[tabKey(projectId, '')])
  const error = useEditor((s) => s.treeError)

  if (error) return <p className="px-3 py-2 font-sans text-[12px] text-danger">{error}</p>
  if (!root) return <p className="px-3 py-2 font-sans text-[12px] text-text-muted">{t.common.loading}</p>
  if (!root.length) return <p className="px-3 py-2 font-sans text-[12px] text-text-muted">{t.editor.emptyFolder}</p>
  return (
    <div role="tree" aria-label={t.editor.files} className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
      <Level projectId={projectId} entries={root} depth={0} />
    </div>
  )
}
