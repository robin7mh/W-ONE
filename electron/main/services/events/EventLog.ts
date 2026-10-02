import type { EventPersistence, WoneEvent } from '@shared/types/events'
import type { EventSink } from './EventBus'

/** The slice of DbService the log needs. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
}

export interface RecentQuery {
  limit?: number
  conversationId?: string
}

const MAX_LIMIT = 500

function fromRow(r: Record<string, unknown>): WoneEvent {
  return {
    id: String(r.id),
    type: r.type as WoneEvent['type'],
    ts: new Date(r.ts as string).toISOString(),
    actor: { kind: r.actor_kind as WoneEvent['actor']['kind'], ...(r.actor_id ? { id: String(r.actor_id) } : {}) },
    ...(r.subject ? { subject: r.subject as WoneEvent['subject'] } : {}),
    ...(r.project_id ? { projectId: String(r.project_id) } : {}),
    ...(r.conversation_id ? { conversationId: String(r.conversation_id) } : {}),
    payload: r.payload
  }
}

/**
 * The persistence sink behind the EventBus. Keeps a bounded in-memory ring of
 * recent events (the activity timeline works without a database) and writes
 * every persisted event to the Postgres `events` table once a database is
 * attached. Append-only: there is no update or delete — audit rows stay.
 */
export class EventLog implements EventSink {
  private readonly ring: WoneEvent[] = []
  private db: Queryable | null = null

  constructor(private readonly capacity = 1000) {}

  attach(db: Queryable | null): void {
    this.db = db
  }

  persist(event: WoneEvent, cls: Exclude<EventPersistence, 'ephemeral'>): void {
    this.ring.push(event)
    if (this.ring.length > this.capacity) this.ring.splice(0, this.ring.length - this.capacity)
    const db = this.db
    if (!db) return
    db.query(
      `INSERT INTO events (id, type, class, ts, actor_kind, actor_id, subject, project_id, conversation_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        event.id,
        event.type,
        cls,
        event.ts,
        event.actor.kind,
        event.actor.id ?? null,
        event.subject ? JSON.stringify(event.subject) : null,
        event.projectId ?? null,
        event.conversationId ?? null,
        JSON.stringify(event.payload)
      ]
    ).catch((err: Error) => console.warn(`[events] could not store ${event.type}: ${err.message}`))
  }

  /** Newest first. From the database when attached (history survives restarts). */
  async recent(query: RecentQuery = {}): Promise<WoneEvent[]> {
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(query.limit ?? 100)))
    if (this.db) {
      try {
        const rows = query.conversationId
          ? await this.db.query('SELECT * FROM events WHERE conversation_id = $1 ORDER BY ts DESC LIMIT $2', [query.conversationId, limit])
          : await this.db.query('SELECT * FROM events ORDER BY ts DESC LIMIT $1', [limit])
        return rows.map(fromRow)
      } catch (err) {
        console.warn(`[events] history query failed, using memory: ${(err as Error).message}`)
      }
    }
    const matching = query.conversationId ? this.ring.filter((e) => e.conversationId === query.conversationId) : this.ring
    return matching.slice(-limit).reverse()
  }
}
