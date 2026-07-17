// Cross-entity addressing — the universal relation currency (architecture §4).
// Pure module (no DOM/Node/Electron) so it compiles under both tsconfigs.

/**
 * v1 keeps this to kinds with real consumers today. It grows additively as
 * each module lands (task, decision, person, concept, conversation, agent,
 * tool, file, automation); the SQLite column stays TEXT, so additions are
 * type-level only.
 */
export type EntityKind = 'project' | 'memory' | 'knowledge'

/** Stable address of any domain object. Relations and events point at these. */
export interface EntityRef {
  kind: EntityKind
  id: string
}
