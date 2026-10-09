import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useEditor, type EditorTab } from '../store'
import { useT } from '@/lib/i18n'
import { fileIcon } from './FileTree'

/**
 * Same-named tabs (two `index.ts`) get their folder as a hint, like VS Code —
 * or the project's name for files at a project root.
 */
function hints(tabs: EditorTab[], projectNames: Map<string, string>): Map<string, string> {
  const count = new Map<string, number>()
  for (const t of tabs) count.set(t.name, (count.get(t.name) ?? 0) + 1)
  return new Map(
    tabs
      .filter((t) => count.get(t.name)! > 1)
      .map((t) => [t.id, t.path.split('/').slice(-2, -1)[0] ?? projectNames.get(t.projectId) ?? ''])
  )
}

/**
 * Open files. A dot marks unsaved edits (it turns into × on hover);
 * middle-click closes, like in VS Code.
 */
export function EditorTabs({ projectNames }: { projectNames: Map<string, string> }) {
  const tr = useT()
  const tabs = useEditor((s) => s.tabs)
  const activeId = useEditor((s) => s.activeId)
  const hint = hints(tabs, projectNames)
  const { setActive, requestClose } = useEditor.getState()

  return (
    <div role="tablist" aria-label={tr.editor.openFiles} className="flex h-9 shrink-0 overflow-x-auto border-b border-hud/60">
      {tabs.map((t) => {
        const active = t.id === activeId
        const { Icon, tint } = fileIcon(t.name)
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={active}
            title={`${projectNames.get(t.projectId) ?? t.projectId} · ${t.path}`}
            onClick={() => setActive(t.id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                requestClose(t.id)
              }
            }}
            className={cn(
              'group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-hud/40 pl-3 pr-1.5 font-sans text-[12.5px] transition-colors',
              active ? 'bg-elevated/50 text-text-primary' : 'text-text-muted hover:bg-elevated/30 hover:text-text-secondary'
            )}
          >
            {active && <span className="absolute inset-x-0 top-0 h-px bg-cyan" />}
            <Icon size={13} className={cn('shrink-0', tint)} />
            <span className={cn(t.deleted && 'line-through')}>{t.name}</span>
            {hint.has(t.id) && <span className="font-mono text-[10px] text-text-muted">{hint.get(t.id)}</span>}
            <button
              type="button"
              aria-label={tr.editor.closeFile(t.name)}
              onClick={(e) => {
                e.stopPropagation()
                requestClose(t.id)
              }}
              className="relative ml-0.5 flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-elevated hover:text-text-primary"
            >
              {t.dirty && (
                <span aria-label={tr.editor.unsaved} className="h-2 w-2 rounded-full bg-text-secondary group-hover:hidden" />
              )}
              <X size={12} className={cn(t.dirty ? 'hidden group-hover:block' : active ? '' : 'opacity-0 group-hover:opacity-100')} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
