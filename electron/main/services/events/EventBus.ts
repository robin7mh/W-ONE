import { randomUUID } from 'node:crypto'
import {
  EVENT_CATALOG,
  type EventPersistence,
  type WoneEvent,
  type WoneEventType
} from '@shared/types/events'
import type { EntityRef } from '@shared/types/entity'

/**
 * Where non-ephemeral events are stored (EventLog: memory ring + Postgres
 * `events` table, catalog-driven, audit rows append-only).
 */
export interface EventSink {
  persist(event: WoneEvent, cls: Exclude<EventPersistence, 'ephemeral'>): void
}

export class NoopEventSink implements EventSink {
  persist(): void {}
}

export interface EmitInput<T> {
  actor?: WoneEvent['actor']
  subject?: EntityRef
  projectId?: string
  conversationId?: string
  payload?: T
}

type Listener = (event: WoneEvent) => void

/**
 * In-main pub/sub for structured WoneEvents (architecture §10). Distributes
 * every event to subscribers; persists only per the central EVENT_CATALOG
 * class. An optional broadcast hook forwards events to the renderer once a
 * push channel exists in the IPC contract (none yet in P2A).
 */
export class EventBus {
  private readonly listeners = new Map<WoneEventType | '*', Set<Listener>>()

  constructor(
    private readonly opts: {
      sink: EventSink
      broadcast?: (event: WoneEvent) => void
    }
  ) {}

  emit<T = unknown>(type: WoneEventType, input: EmitInput<T> = {}): WoneEvent<T> {
    const event: WoneEvent<T> = {
      id: randomUUID(),
      type,
      ts: new Date().toISOString(),
      actor: input.actor ?? { kind: 'system' },
      subject: input.subject,
      projectId: input.projectId,
      conversationId: input.conversationId,
      payload: (input.payload ?? {}) as T
    }

    for (const key of [type, '*'] as const) {
      for (const listener of this.listeners.get(key) ?? []) {
        try {
          listener(event)
        } catch (err) {
          console.error(`[events] listener for ${type} failed`, err)
        }
      }
    }

    const cls = EVENT_CATALOG[type]
    if (cls !== 'ephemeral') {
      try {
        this.opts.sink.persist(event, cls)
      } catch (err) {
        console.error(`[events] persisting ${type} failed`, err)
      }
    }

    this.opts.broadcast?.(event)
    return event
  }

  subscribe(type: WoneEventType | '*', listener: Listener): () => void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
    return () => set.delete(listener)
  }
}
