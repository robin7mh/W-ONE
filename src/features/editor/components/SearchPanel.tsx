import { useEffect, useMemo, useRef, useState } from 'react'
import { CaseSensitive, Loader2, Regex, Search } from 'lucide-react'
import type { SearchMatch } from '@shared/types/scm'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { useEditor } from '../store'
import { useScm } from '../scm'

const toggle = (on: boolean) =>
  cn('flex h-6 w-6 items-center justify-center rounded transition-colors', on ? 'bg-cyan/15 text-cyan' : 'text-text-muted hover:bg-elevated hover:text-text-primary')

/** Searching runs this long after the last keystroke. */
const DEBOUNCE_MS = 300

/** Search across the project's files (git grep), results grouped by file; a click opens the line. */
export function SearchPanel() {
  const t = useT()
  const { query, regex, caseSensitive, result, searching } = useScm((s) => s.search)
  const { setSearch, runSearch } = useScm.getState()
  const first = useRef(true)

  // Search as you type (and when an option flips).
  useEffect(() => {
    if (first.current) {
      first.current = false
      if (result) return
    }
    const timer = window.setTimeout(() => void runSearch(), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, regex, caseSensitive])

  const groups = useMemo(() => {
    const byFile = new Map<string, SearchMatch[]>()
    for (const m of result?.matches ?? []) byFile.set(m.path, [...(byFile.get(m.path) ?? []), m])
    return [...byFile]
  }, [result])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-hud/50 p-2">
        <div className="flex items-center gap-1 rounded-md border border-hud/60 bg-surface/50 px-2 focus-within:border-cyan/50">
          <Search size={13} className="shrink-0 text-text-muted" />
          <input
            autoFocus
            aria-label={t.scm.searchPlaceholder}
            placeholder={t.scm.searchPlaceholder}
            value={query}
            onChange={(e) => setSearch({ query: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
            className="min-w-0 flex-1 bg-transparent py-1.5 font-sans text-[12.5px] text-text-primary outline-none placeholder:text-text-muted"
          />
          <button type="button" aria-label={t.scm.matchCase} title={t.scm.matchCase} aria-pressed={caseSensitive} className={toggle(caseSensitive)} onClick={() => setSearch({ caseSensitive: !caseSensitive })}>
            <CaseSensitive size={15} />
          </button>
          <button type="button" aria-label={t.scm.useRegex} title={t.scm.useRegex} aria-pressed={regex} className={toggle(regex)} onClick={() => setSearch({ regex: !regex })}>
            <Regex size={13} />
          </button>
        </div>
        {result && (
          <p className="mt-1.5 flex items-center gap-1.5 px-0.5 font-mono text-[10.5px] text-text-muted">
            {searching && <Loader2 size={10} className="animate-spin" />}
            {result.matches.length ? t.scm.results(result.matches.length, groups.length) : t.scm.noResults}
          </p>
        )}
        {result?.truncated && <p className="mt-1 px-0.5 font-sans text-[11px] text-amber">{t.scm.truncated}</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {groups.map(([path, matches]) => (
          <section key={path} className="mb-1">
            <p className="truncate px-2 py-0.5 font-sans text-[12px] text-text-primary" title={path}>
              {path.slice(path.lastIndexOf('/') + 1)} <span className="font-mono text-[10.5px] text-text-muted">{path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''}</span>
            </p>
            <ul>
              {matches.map((m) => (
                <li key={`${m.path}:${m.line}`}>
                  <button
                    type="button"
                    onClick={() => {
                      useScm.getState().closeDiff()
                      void useEditor.getState().openAt(m.path, m.line)
                    }}
                    className="flex w-full items-baseline gap-2 px-2 py-0.5 pl-4 text-left hover:bg-elevated/50"
                  >
                    <span className="w-8 shrink-0 text-right font-mono text-[10.5px] text-text-muted">{m.line}</span>
                    <span className="min-w-0 truncate font-mono text-[11.5px] text-text-secondary">{m.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

/** Fuzzy match: every query character in order; earlier, denser and file-name hits score better (lower). */
export function fuzzyScore(path: string, query: string): number | null {
  const p = path.toLowerCase()
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return 0
  const base = p.lastIndexOf('/') + 1
  let at = -1
  let score = 0
  for (const ch of q) {
    const next = p.indexOf(ch, at + 1)
    if (next < 0) return null
    score += next - at - 1 // gaps cost
    at = next
  }
  if (p.slice(base).includes(q)) score -= 1000 // the file name itself matches
  return score + p.length / 100
}

/** ⌘P: jump to a file by (part of) its name. */
export function QuickOpen() {
  const t = useT()
  const files = useScm((s) => s.files)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const hits = useMemo(
    () =>
      files
        .map((path) => ({ path, score: fuzzyScore(path, query) }))
        .filter((h): h is { path: string; score: number } => h.score !== null)
        .sort((a, b) => a.score - b.score)
        .slice(0, 60),
    [files, query]
  )
  const close = () => useScm.getState().setQuickOpen(false)
  const open = (path: string) => {
    close()
    useScm.getState().closeDiff()
    void useEditor.getState().open(path)
  }

  useEffect(() => {
    list.current!.children[active].scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div role="dialog" aria-label={t.scm.quickOpen} className="fixed inset-0 z-[60] flex justify-center bg-void/40 pt-[12vh]" onMouseDown={close}>
      <div className="h-fit w-[min(560px,90vw)] overflow-hidden rounded-lg border border-hud/70 bg-panel/95 shadow-2xl shadow-black/50 backdrop-blur-md" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          aria-label={t.scm.quickOpen}
          placeholder={t.scm.quickOpen}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((i) => Math.min(hits.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter' && hits[active]) open(hits[active].path)
          }}
          className="w-full border-b border-hud/60 bg-transparent px-3 py-2.5 font-sans text-[13.5px] text-text-primary outline-none placeholder:text-text-muted"
        />
        <ul ref={list} role="listbox" aria-label={t.scm.quickOpen} className="max-h-[50vh] overflow-y-auto p-1">
          {!hits.length && <li className="px-3 py-2 font-sans text-[12px] text-text-muted">{t.scm.noFiles}</li>}
          {hits.map((h, i) => {
            const name = h.path.slice(h.path.lastIndexOf('/') + 1)
            return (
              <li
                key={h.path}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => open(h.path)}
                className={cn('flex cursor-pointer items-baseline gap-2 rounded-md px-2.5 py-1.5', i === active && 'bg-cyan/10')}
              >
                <span className="shrink-0 font-sans text-[12.5px] text-text-primary">{name}</span>
                <span className="min-w-0 truncate font-mono text-[10.5px] text-text-muted">{h.path.slice(0, h.path.length - name.length)}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
