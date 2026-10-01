import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, FileText, Plus, Search, X } from 'lucide-react'
import type { GraphStyle, NoteMeta, SearchHit } from '@shared/types/memory'
import { TechLabel } from '@/components/ui/TechLabel'
import { cn } from '@/lib/cn'
import { slotColor } from './GraphView'

interface Props {
  notes: NoteMeta[]
  hits: SearchHit[]
  query: string
  activePath?: string
  folderSlots: Map<string, number>
  style: GraphStyle
  onSearch: (q: string) => void
  onOpen: (path: string) => void
  onCreate: (folder: string) => void
}

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** Vault sidebar: search, then notes grouped by folder (root first, like Obsidian). */
export function NoteList({ notes, hits, query, activePath, folderSlots, style, onSearch, onOpen, onCreate }: Props) {
  const [input, setInput] = useState(query)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    const id = window.setTimeout(() => onSearch(input), 150)
    return () => window.clearTimeout(id)
  }, [input, onSearch])

  const groups = useMemo(() => {
    const map = new Map<string, NoteMeta[]>()
    for (const n of notes) {
      const dir = dirOf(n.path)
      map.set(dir, [...(map.get(dir) ?? []), n])
    }
    return [...map.entries()]
      .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
      .map(([dir, items]) => [dir, items.sort((a, b) => a.title.localeCompare(b.title))] as const)
  }, [notes])

  const dot = (folder: string) =>
    style.mode === 'colorful'
      ? slotColor(folderSlots.get(folder) ?? 0)
      : `rgb(var(--graph-${style.color}))`

  const toggle = (dir: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-2">
        <label className="flex items-center gap-2 rounded-md border border-hud/60 bg-surface/50 px-2.5 py-1.5 focus-within:border-cyan/50">
          <Search size={13} className="shrink-0 text-text-muted" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search memory…"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-sans text-[12px] text-text-primary outline-none placeholder:text-text-muted/70"
          />
          {input && (
            <button type="button" aria-label="Clear search" onClick={() => setInput('')}>
              <X size={12} className="text-text-muted hover:text-text-primary" />
            </button>
          )}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {query.trim() ? (
          <div className="space-y-1">
            <TechLabel className="block px-1.5 py-1 text-text-muted">{hits.length} results</TechLabel>
            {hits.map((h) => (
              <button
                key={h.path}
                type="button"
                onClick={() => onOpen(h.path)}
                className={cn(
                  'w-full rounded-md border px-2.5 py-2 text-left transition-colors',
                  h.path === activePath ? 'border-cyan/40 bg-cyan/[0.06]' : 'border-transparent hover:bg-elevated/50'
                )}
              >
                <span className="block truncate font-sans text-[12.5px] font-medium text-text-primary">{h.title}</span>
                <span className="mt-0.5 line-clamp-2 font-sans text-[11px] text-text-muted">{h.snippet}</span>
              </button>
            ))}
          </div>
        ) : (
          groups.map(([dir, items]) => {
            const top = dir.split('/')[0]
            const isCollapsed = collapsed.has(dir)
            return (
              <div key={dir || '.'} className="mb-1">
                {dir && (
                  <div className="group flex items-center gap-1.5 rounded px-1.5 py-1">
                    <button type="button" onClick={() => toggle(dir)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                      <ChevronDown
                        size={12}
                        className={cn('shrink-0 text-text-muted transition-transform', isCollapsed && '-rotate-90')}
                      />
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot(top) }} />
                      <span className="truncate font-sans text-[12px] font-medium text-text-secondary">{dir}</span>
                      <span className="font-mono text-[10px] text-text-muted">{items.length}</span>
                    </button>
                    <button
                      type="button"
                      title={`New note in ${dir}`}
                      onClick={() => onCreate(dir)}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Plus size={13} className="text-text-muted hover:text-cyan" />
                    </button>
                  </div>
                )}
                {!isCollapsed &&
                  items.map((n) => (
                    <button
                      key={n.path}
                      type="button"
                      onClick={() => onOpen(n.path)}
                      className={cn(
                        'relative flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors',
                        dir ? 'pl-7' : 'pl-2',
                        n.path === activePath
                          ? 'bg-cyan/[0.08] text-text-primary'
                          : 'text-text-secondary hover:bg-elevated/50 hover:text-text-primary'
                      )}
                    >
                      {n.path === activePath && (
                        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-cyan" />
                      )}
                      <FileText size={13} className="shrink-0 text-text-muted" />
                      <span className="min-w-0 flex-1 truncate font-sans text-[12.5px]">{n.title}</span>
                      {n.linkCount > 0 && (
                        <span className="font-mono text-[10px] text-text-muted">{n.linkCount}</span>
                      )}
                    </button>
                  ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
