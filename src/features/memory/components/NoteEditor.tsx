import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Check, Link2, Loader2, PencilLine, Trash2 } from 'lucide-react'
import type { Note } from '@shared/types/memory'
import { TechLabel } from '@/components/ui/TechLabel'
import { cn } from '@/lib/cn'
import { renderMarkdown } from '../markdown'

interface Props {
  note: Note
  draft: string
  mode: 'edit' | 'preview'
  saving: boolean
  onDraft: (raw: string) => void
  onMode: (mode: 'edit' | 'preview') => void
  onSave: () => void
  onOpen: (path: string) => void
  onOpenOrCreate: (title: string) => void
  onTrash: () => void
}

function safeDecode(s: string): string {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

/** Shown elsewhere in the header (type badge, tag chips) or internal (id). */
const HIDDEN_PROPS = new Set(['id', 'type', 'tags', 'tag'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

function formatValue(v: unknown): string {
  if (v instanceof Date) return v.toLocaleString()
  if (typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v))) {
    return new Date(v).toLocaleString()
  }
  if (Array.isArray(v)) return v.join(', ')
  if (v && typeof v === 'object') return JSON.stringify(v)
  return String(v ?? '')
}

/** One note: read (rendered) or edit (raw markdown, autosaved), plus backlinks. */
export function NoteEditor({ note, draft, mode, saving, onDraft, onMode, onSave, onOpen, onOpenOrCreate, onTrash }: Props) {
  const [confirmTrash, setConfirmTrash] = useState(false)
  const dirty = draft !== note.raw
  const html = useMemo(() => renderMarkdown(note.body, note.links), [note.body, note.links])
  const props = Object.entries(note.frontmatter).filter(([k]) => !HIDDEN_PROPS.has(k))

  useEffect(() => setConfirmTrash(false), [note.path])

  // Obsidian shortcuts: ⌘/Ctrl+E toggles read/edit, ⌘/Ctrl+S saves now.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'e') {
        e.preventDefault()
        onMode(mode === 'edit' ? 'preview' : 'edit')
      } else if (key === 's') {
        e.preventDefault()
        onSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, onMode, onSave])

  const onPreviewClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    if (a.classList.contains('wikilink')) {
      const target = a.dataset.target ?? ''
      const path = note.links[target]
      if (path) onOpen(path)
      else onOpenOrCreate(target)
      return
    }
    const href = a.getAttribute('href') ?? ''
    if (/^(https?:|mailto:)/i.test(href)) {
      window.open(href, '_blank') // main routes this to the OS browser
      return
    }
    const target = safeDecode(href.split('#')[0])
    const path = note.links[target]
    if (path) onOpen(path)
    else if (/\.md$/i.test(target)) onOpenOrCreate(target)
  }

  const seg = 'flex items-center gap-1.5 rounded px-2 py-1 font-sans text-[11px] font-medium transition-colors'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* note header */}
      <div className="flex items-start gap-3 border-b border-hud/50 px-5 py-3">
        <div className="min-w-0 flex-1">
          {note.folder && (
            <TechLabel className="mb-1 block truncate text-text-muted">
              {note.path.slice(0, note.path.lastIndexOf('/')).replace(/\//g, ' / ')}
            </TechLabel>
          )}
          <h2 className="truncate font-sans text-[18px] font-semibold text-text-primary">{note.title}</h2>
          {(note.type || note.tags.length > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {note.type && (
                <span className="rounded border border-cyan/30 bg-cyan/[0.06] px-1.5 py-px font-mono text-[10px] text-cyan">
                  {note.type}
                </span>
              )}
              {note.tags.map((t) => (
                <span key={t} className="rounded border border-hud/60 bg-elevated/50 px-1.5 py-px font-mono text-[10px] text-purple">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1 font-mono text-[10px] text-text-muted">
            {saving ? (
              <>
                <Loader2 size={11} className="animate-spin" /> saving
              </>
            ) : dirty ? (
              'unsaved'
            ) : (
              <>
                <Check size={11} /> saved
              </>
            )}
          </span>
          <div className="flex rounded-md border border-hud/60 bg-surface/50 p-0.5">
            <button
              type="button"
              title="Read (⌘E)"
              onClick={() => onMode('preview')}
              className={cn(seg, mode === 'preview' ? 'bg-cyan/10 text-cyan' : 'text-text-muted hover:text-text-secondary')}
            >
              <BookOpen size={12} /> Read
            </button>
            <button
              type="button"
              title="Edit (⌘E)"
              onClick={() => onMode('edit')}
              className={cn(seg, mode === 'edit' ? 'bg-cyan/10 text-cyan' : 'text-text-muted hover:text-text-secondary')}
            >
              <PencilLine size={12} /> Edit
            </button>
          </div>
          {confirmTrash ? (
            <button
              type="button"
              onClick={onTrash}
              onBlur={() => setConfirmTrash(false)}
              autoFocus
              className="rounded-md border border-danger/50 bg-danger/10 px-2 py-1 font-sans text-[11px] font-medium text-danger"
            >
              Move to trash?
            </button>
          ) : (
            <button
              type="button"
              title="Move to trash"
              onClick={() => setConfirmTrash(true)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-hud/60 text-text-muted transition-colors hover:border-danger/50 hover:text-danger"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode === 'edit' ? (
          <textarea
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            spellCheck={false}
            autoFocus
            className="h-full min-h-[300px] w-full resize-none bg-transparent px-5 py-4 font-mono text-[13px] leading-[1.7] text-text-primary caret-cyan outline-none placeholder:text-text-muted/60"
            placeholder="Write in markdown — link notes with [[Title]], tag with #tag"
          />
        ) : (
          <div className="mx-auto max-w-3xl px-5 py-4">
            {props.length > 0 && (
              <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-hud/50 bg-surface/40 px-3 py-2">
                {props.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono text-[11px] text-text-muted">{k}</dt>
                    <dd className="truncate font-mono text-[11px] text-text-secondary">{formatValue(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {note.body.trim() ? (
              <div className="md-prose" onClick={onPreviewClick} dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <button
                type="button"
                onClick={() => onMode('edit')}
                className="font-sans text-[13px] text-text-muted hover:text-cyan"
              >
                Empty note — click to start writing
              </button>
            )}
          </div>
        )}
      </div>

      {/* backlinks */}
      <div className="max-h-40 shrink-0 overflow-y-auto border-t border-hud/50 px-5 py-2.5">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Link2 size={12} className="text-text-muted" />
          <TechLabel className="text-text-secondary">Linked mentions</TechLabel>
          <span className="font-mono text-[10px] text-text-muted">{note.backlinks.length}</span>
        </div>
        {note.backlinks.length === 0 ? (
          <p className="font-sans text-[12px] text-text-muted">No notes link here yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {note.backlinks.map((b) => (
              <button
                key={b.path}
                type="button"
                onClick={() => onOpen(b.path)}
                className="rounded-md border border-hud/60 bg-surface/50 px-2 py-1 font-sans text-[12px] text-text-secondary transition-colors hover:border-cyan/40 hover:text-cyan"
              >
                {b.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
