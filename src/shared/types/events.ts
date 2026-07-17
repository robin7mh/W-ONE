// Structured system events — one envelope for everything that happens
// (architecture §10). Pure module (no DOM/Node/Electron) so it compiles
// under both tsconfigs.

import type { EntityRef } from './entity'

/** Grows additively as phases land (project.*, memory.*, agent.*, tool.*, …). */
export type WoneEventType = 'app.started' | 'db.migrated'

/**
 * How an event is persisted. The bus distributes ALL events to subscribers;
 * it stores only per this class. Audit rows are append-only — the event store
 * exposes no update or delete methods for them.
 */
export type EventPersistence = 'ephemeral' | 'activity' | 'audit'

/**
 * Central catalog: every event type declares its persistence class exactly
 * once. Adding an event type without classifying it is a type error.
 */
export const EVENT_CATALOG: Record<WoneEventType, EventPersistence> = {
  'app.started': 'activity',
  'db.migrated': 'activity'
}

export interface WoneEvent<T = unknown> {
  id: string
  type: WoneEventType
  ts: string // ISO
  actor: { kind: 'user' | 'agent' | 'system'; id?: string }
  /** Primary entity concerned, if any. */
  subject?: EntityRef
  /** Project scope, if any. */
  projectId?: string
  /** JSON-serializable, type-specific detail. Never raw model reasoning. */
  payload: T
}
