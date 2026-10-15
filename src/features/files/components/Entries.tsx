import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { ArrowDown, ArrowUp, Folder } from 'lucide-react'
import type { FinderEntry } from '@shared/types/finder'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { entryKind, formatBytes, formatModified } from '../kinds'
import { useFiles, type SortKey } from '../store'
import { FileIcon } from './FileIcon'
import { DRAG_FILES, dropProps } from './Sidebar'

/** A name being typed (rename, new folder): Enter or leaving the field commits, Escape cancels. */
export function NameInput({ initial, label, onCommit, onCancel }: { initial: string; label: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current!
    el.focus()
    // Select the name without its extension, like Finder.
    const dot = initial.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [initial])
  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    if (commit) onCommit(ref.current!.value)
    else onCancel()
  }
  return (
    <input
      ref={ref}
      aria-label={label}
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(true)
        else if (e.key === 'Escape') finish(false)
      }}
      onBlur={() => finish(true)}
      className="min-w-0 flex-1 rounded border border-cyan/60 bg-surface px-1 py-0 font-sans text-[12.5px] text-text-primary outline-none"
    />
  )
}

export interface EntryHandlers {
  open(entry: FinderEntry): void
  menu(entry: FinderEntry, e: MouseEvent): void
}

/** Click, ⌘-click, ⇧-click, drag — the same for rows and tiles. */
function useEntry(entry: FinderEntry, handlers: EntryHandlers) {
  const selected = useFiles((s) => s.selected.includes(entry.path))
  const [over, setOver] = useState(false)
  const folder = entry.kind === 'dir' && !entry.bundle
  return {
    selected,
    over,
    props: {
      'aria-selected': selected,
      draggable: true,
      onClick: (e: MouseEvent) => useFiles.getState().select(entry.path, e.metaKey || e.ctrlKey ? 'toggle' : e.shiftKey ? 'range' : 'single'),
      onDoubleClick: () => handlers.open(entry),
      onContextMenu: (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (!useFiles.getState().selected.includes(entry.path)) useFiles.getState().select(entry.path)
        handlers.menu(entry, e)
      },
      onDragStart: (e: DragEvent) => {
        const s = useFiles.getState()
        const paths = s.selected.includes(entry.path) ? s.selected : [entry.path]
        e.dataTransfer.setData(DRAG_FILES, JSON.stringify(paths))
        e.dataTransfer.effectAllowed = 'copyMove'
      },
      ...(folder ? dropProps(entry.path, setOver) : {})
    }
  }
}

function Row({ entry, handlers }: { entry: FinderEntry; handlers: EntryHandlers }) {
  const t = useT()
  const renaming = useFiles((s) => s.renaming === entry.path)
  const { selected, over, props } = useEntry(entry, handlers)
  return (
    <div
      role="row"
      {...props}
      className={cn(
        'grid cursor-default grid-cols-[minmax(0,1fr)_150px_90px_120px] items-center gap-3 rounded-md px-2 py-[5px] transition-colors',
        selected ? 'bg-cyan/[0.12] text-text-primary' : 'text-text-secondary hover:bg-elevated/40',
        over && 'ring-1 ring-cyan/60',
        entry.hidden && 'opacity-60'
      )}
    >
      <span role="gridcell" className="flex min-w-0 items-center gap-2">
        <FileIcon entry={entry} />
        {renaming ? (
          <NameInput
            initial={entry.name}
            label={t.files.rename}
            onCommit={(name) => void useFiles.getState().rename(entry.path, name)}
            onCancel={() => useFiles.getState().cancelRename()}
          />
        ) : (
          <span className={cn('truncate font-sans text-[12.5px]', selected && 'text-text-primary')}>{entry.name}</span>
        )}
      </span>
      <span role="gridcell" className="truncate font-mono text-[11px] text-text-muted">
        {formatModified(entry.mtimeMs)}
      </span>
      <span role="gridcell" className="truncate text-right font-mono text-[11px] text-text-muted">
        {entry.kind === 'dir' ? '—' : formatBytes(entry.size)}
      </span>
      <span role="gridcell" className="truncate font-sans text-[11.5px] text-text-muted">
        {t.files.kinds[entryKind(entry)]}
      </span>
    </div>
  )
}

function Tile({ entry, handlers }: { entry: FinderEntry; handlers: EntryHandlers }) {
  const t = useT()
  const renaming = useFiles((s) => s.renaming === entry.path)
  const { selected, over, props } = useEntry(entry, handlers)
  return (
    <div
      role="gridcell"
      {...props}
      title={entry.name}
      className={cn(
        'flex w-[112px] cursor-default flex-col items-center gap-1.5 rounded-lg p-2 transition-colors',
        selected ? 'bg-cyan/[0.12]' : 'hover:bg-elevated/40',
        over && 'ring-1 ring-cyan/60',
        entry.hidden && 'opacity-60'
      )}
    >
      <span className="flex h-16 w-16 items-center justify-center">
        <FileIcon entry={entry} size={56} thumb={!entry.hidden} />
      </span>
      {renaming ? (
        <NameInput
          initial={entry.name}
          label={t.files.rename}
          onCommit={(name) => void useFiles.getState().rename(entry.path, name)}
          onCancel={() => useFiles.getState().cancelRename()}
        />
      ) : (
        <span className={cn('line-clamp-2 w-full break-words text-center font-sans text-[11.5px] leading-tight', selected ? 'text-text-primary' : 'text-text-secondary')}>
          {entry.name}
        </span>
      )}
    </div>
  )
}

function NewFolder() {
  const t = useT()
  return (
    <div className="flex items-center gap-2 rounded-md bg-cyan/[0.08] px-2 py-[5px]">
      <Folder size={15} className="shrink-0 text-cyan" />
      <NameInput
        initial={t.files.untitledFolder}
        label={t.files.newFolder}
        onCommit={(name) => void useFiles.getState().mkdir(name)}
        onCancel={() => useFiles.getState().cancelCreate()}
      />
    </div>
  )
}

function SortHeader({ k, label, className }: { k: SortKey; label: string; className?: string }) {
  const sort = useFiles((s) => s.sort)
  const Arrow = sort.desc ? ArrowDown : ArrowUp
  return (
    <button
      type="button"
      role="columnheader"
      aria-sort={sort.key === k ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      onClick={() => useFiles.getState().setSort(k)}
      className={cn('flex items-center gap-1 font-sans text-[11px] font-medium text-text-muted hover:text-text-secondary', className)}
    >
      {label}
      {sort.key === k && <Arrow size={11} className="text-cyan" />}
    </button>
  )
}

/** The folder (or the search hits) as a list with columns, or as icons. */
export function Entries({ entries, handlers }: { entries: FinderEntry[]; handlers: EntryHandlers }) {
  const t = useT()
  const view = useFiles((s) => s.view)
  const creating = useFiles((s) => s.creating)
  if (view === 'grid') {
    return (
      <div role="grid" aria-label={t.files.title} className="flex flex-wrap content-start gap-1 p-2">
        {creating && <NewFolder />}
        {entries.map((e) => (
          <Tile key={e.path} entry={e} handlers={handlers} />
        ))}
      </div>
    )
  }
  return (
    <div role="grid" aria-label={t.files.title} className="flex flex-col p-1.5">
      <div role="row" className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_150px_90px_120px] gap-3 border-b border-hud/40 bg-panel/90 px-2 pb-1.5 pt-1 backdrop-blur-sm">
        <SortHeader k="name" label={t.files.name} />
        <SortHeader k="modified" label={t.files.modified} />
        <SortHeader k="size" label={t.files.size} className="justify-end" />
        <SortHeader k="kind" label={t.files.kind} />
      </div>
      {creating && <NewFolder />}
      {entries.map((e) => (
        <Row key={e.path} entry={e} handlers={handlers} />
      ))}
    </div>
  )
}
