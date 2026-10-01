/**
 * Forward-only schema migrations, applied by DbService in version order.
 * Each runs inside one transaction; `PRAGMA user_version` tracks the schema.
 * Migrations are TS modules exporting SQL strings (not .sql files) so both
 * the bundler and the plain-tsc typecheck handle them with zero config.
 */
export interface Migration {
  version: number
  name: string
  /** SQL executed inside one transaction. */
  up: string
}

/** Ordered list. Domain schema (001: entities/links/events/memories) lands in P2B. */
export const MIGRATIONS: readonly Migration[] = []
