import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { HistoryEntry } from '@shared/types/browser'
import { writeAtomic } from '../../lib/writeAtomic'
import { isLoopback, isWebUrl } from './url'

/** Distinct pages kept (the least valuable go first). */
const MAX_ENTRIES = 10_000
const MAX_URL = 4096
const DAY_MS = 86_400_000

interface Entry {
  url: string
  title: string
  visits: number
  last: number
}

/** One line of the file: a visit (`v` absent = 1), a title change (`v: 0`) or, after compaction, a whole entry. */
interface Line {
  u: string
  t?: string
  v?: number
  l: number
}

/** How much a page counts: visits, worth less the longer ago the last one was. */
export function frecency(e: { visits: number; last: number }, now: number): number {
  const days = (now - e.last) / DAY_MS
  const weight = days < 4 ? 1 : days < 14 ? 0.7 : days < 31 ? 0.5 : days < 90 ? 0.3 : 0.1
  return e.visits * weight
}

/** The URL as people read and type it: no scheme, no www. */
export function bareUrl(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '')
}

/**
 * The browser history: JSON lines in one file — a line per visit, appended —
 * folded into one entry per page on load and compacted once it grows. Plain
 * files, no database (architecture §11.5).
 */
export class BrowserHistory {
  private readonly entries = new Map<string, Entry>()
  /** Lines in the file beyond one per entry — compaction is due when they pile up. */
  private extra = 0
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now
  ) {}

  async load(): Promise<void> {
    let raw = ''
    try {
      raw = await readFile(this.file, 'utf8')
    } catch {
      return // no history yet
    }
    let lines = 0
    for (const text of raw.split('\n')) {
      if (!text.trim()) continue
      lines += 1
      try {
        this.apply(JSON.parse(text) as Line)
      } catch {
        // a torn last line after a crash — skip it
      }
    }
    this.extra = Math.max(0, lines - this.entries.size)
  }

  /** A page was opened. */
  visit(url: string, title = ''): void {
    if (!this.keeps(url)) return
    const line: Line = { u: url, l: this.now(), ...(title ? { t: title } : {}) }
    this.apply(line)
    this.write(line)
  }

  /** The page's title arrived (after its visit). */
  title(url: string, title: string): void {
    const e = this.entries.get(url)
    if (!e || !title || e.title === title) return
    const line: Line = { u: url, t: title, v: 0, l: e.last }
    this.apply(line)
    this.write(line)
  }

  /** Visited pages matching every word of `query` (in address or title), best first; all by recency without a query. */
  search(query = '', limit = 100): HistoryEntry[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const now = this.now()
    const all = [...this.entries.values()]
    const hits = words.length
      ? all
          .filter((e) => {
            const hay = `${bareUrl(e.url)} ${e.title}`.toLowerCase()
            return words.every((w) => hay.includes(w))
          })
          .sort((a, b) => frecency(b, now) - frecency(a, now))
      : all.sort((a, b) => b.last - a.last)
    return hits.slice(0, limit).map(toEntry)
  }

  /** Address-bar matches: pages whose address starts with the text first, then any containing it. */
  suggest(text: string, limit = 6): HistoryEntry[] {
    const q = text.trim().toLowerCase()
    if (!q) return []
    const now = this.now()
    const scored: { e: Entry; score: number }[] = []
    for (const e of this.entries.values()) {
      const bare = bareUrl(e.url).toLowerCase()
      const prefix = bare.startsWith(q)
      if (!prefix && !bare.includes(q) && !e.title.toLowerCase().includes(q)) continue
      scored.push({ e, score: frecency(e, now) + (prefix ? 1000 : 0) })
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => toEntry(s.e))
  }

  /** The most visited sites — not local dev pages (the new-tab page lists those apart). */
  top(limit = 8): HistoryEntry[] {
    const now = this.now()
    return [...this.entries.values()]
      .filter((e) => !isLoopback(e.url))
      .sort((a, b) => frecency(b, now) - frecency(a, now))
      .slice(0, limit)
      .map(toEntry)
  }

  async clear(): Promise<void> {
    this.entries.clear()
    this.extra = 0
    await this.enqueue(() => rm(this.file, { force: true }))
  }

  /** Every write so far has reached the disk. */
  flush(): Promise<void> {
    return this.queue
  }

  private keeps(url: string): boolean {
    return isWebUrl(url) && url.length <= MAX_URL
  }

  private apply(line: Line): void {
    if (typeof line?.u !== 'string' || !this.keeps(line.u)) return
    const e = this.entries.get(line.u) ?? { url: line.u, title: '', visits: 0, last: 0 }
    e.visits += typeof line.v === 'number' ? line.v : 1
    if (typeof line.t === 'string' && line.t) e.title = line.t
    if (typeof line.l === 'number') e.last = Math.max(e.last, line.l)
    this.entries.set(line.u, e)
  }

  private write(line: Line): void {
    this.extra += 1
    if (this.extra > Math.max(2000, this.entries.size)) {
      void this.compact()
      return
    }
    void this.enqueue(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      await appendFile(this.file, `${JSON.stringify(line)}\n`, 'utf8')
    })
  }

  /** Rewrite the file with one line per page, dropping the least valuable beyond the cap. */
  private compact(): Promise<void> {
    const now = this.now()
    const keep = [...this.entries.values()].sort((a, b) => frecency(b, now) - frecency(a, now) || b.last - a.last).slice(0, MAX_ENTRIES)
    this.entries.clear()
    for (const e of keep) this.entries.set(e.url, e)
    this.extra = 0
    const text = keep.map((e) => JSON.stringify({ u: e.url, t: e.title, v: e.visits, l: e.last } satisfies Line)).join('\n')
    // Only a visit compacts, so there is always at least that page to write.
    return this.enqueue(() => writeAtomic(this.file, `${text}\n`))
  }

  private enqueue(task: () => Promise<unknown>): Promise<void> {
    const run = this.queue.then(task).then(
      () => undefined,
      (err) => console.error('[browser] history write failed', err)
    )
    this.queue = run
    return run
  }
}

function toEntry(e: Entry): HistoryEntry {
  return { url: e.url, title: e.title, visits: e.visits, lastVisit: new Date(e.last).toISOString() }
}
