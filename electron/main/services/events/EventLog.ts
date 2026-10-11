import { appendFile, readFile } from 'node:fs/promises'
import type { EventPersistence, WoneEvent } from '@shared/types/events'
import { writeAtomic } from '../../lib/writeAtomic'
import type { EventSink } from './EventBus'

export interface RecentQuery {
  limit?: number
  conversationId?: string
}

const MAX_LIMIT = 500

/** One event per line; a damaged line is skipped, never the whole history. */
function parseLines(raw: string): WoneEvent[] {
  return raw.split('\n').flatMap((line) => {
    if (!line) return []
    try {
      return [JSON.parse(line) as WoneEvent]
    } catch {
      return []
    }
  })
}

/**
 * The persistence sink behind the EventBus: the newest events in memory,
 * mirrored to a JSON-lines file in the data folder so the activity timeline
 * survives a restart. Append-only — there is no update or delete. Once the
 * file holds twice `capacity` lines it is rewritten with the newest ones.
 */
export class EventLog implements EventSink {
  private readonly ring: WoneEvent[] = []
  private lines = 0
  private writes: Promise<void> = Promise.resolve()

  /** Without a file (tests, tools) it is memory only. */
  constructor(
    private readonly file?: string,
    private readonly capacity = 1000
  ) {}

  /** The history from earlier runs. */
  async load(): Promise<void> {
    if (!this.file) return
    const events = parseLines(await readFile(this.file, 'utf8').catch(() => ''))
    this.lines = events.length
    this.ring.push(...events.slice(-this.capacity))
  }

  persist(event: WoneEvent, _cls: Exclude<EventPersistence, 'ephemeral'>): void {
    this.ring.push(event)
    if (this.ring.length > this.capacity) this.ring.splice(0, this.ring.length - this.capacity)
    const file = this.file
    if (!file) return
    this.lines += 1
    const compact = this.lines > this.capacity * 2
    const data = compact ? this.ring.map((e) => `${JSON.stringify(e)}\n`).join('') : `${JSON.stringify(event)}\n`
    if (compact) this.lines = this.ring.length
    this.writes = this.writes
      .then(() => (compact ? writeAtomic(file, data) : appendFile(file, data, 'utf8')))
      .catch((err: Error) => console.warn(`[events] could not store ${event.type}: ${err.message}`))
  }

  /** Settles once every event so far is on disk (shutdown, tests). */
  flush(): Promise<void> {
    return this.writes
  }

  /** Newest first. */
  async recent(query: RecentQuery = {}): Promise<WoneEvent[]> {
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(query.limit ?? 100)))
    const matching = query.conversationId ? this.ring.filter((e) => e.conversationId === query.conversationId) : this.ring
    return matching.slice(-limit).reverse()
  }
}
