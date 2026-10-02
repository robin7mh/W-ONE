/**
 * Forward-only schema migrations, applied by DbService in version order.
 * Each runs inside one transaction; the `schema_migrations` ledger tracks
 * the version. Migrations are TS modules exporting SQL strings (not .sql
 * files) so both the bundler and the plain-tsc typecheck handle them with
 * zero config.
 */
export interface Migration {
  version: number
  name: string
  /** SQL executed inside one transaction. */
  up: string
}

/**
 * 001 — the activity/audit event log (architecture §10) and agent runs (§7).
 * Audit rows are append-only by contract: EventLog exposes no update or
 * delete. Conversations stay JSON files in ~/W-ONE/data so the assistant
 * works without the database container.
 */
const m001: Migration = {
  version: 1,
  name: 'events_and_agent_runs',
  up: `
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      class TEXT NOT NULL,
      ts TIMESTAMPTZ NOT NULL,
      actor_kind TEXT NOT NULL,
      actor_id TEXT,
      subject JSONB,
      project_id TEXT,
      conversation_id TEXT,
      payload JSONB NOT NULL
    );
    CREATE INDEX events_ts_idx ON events (ts);
    CREATE INDEX events_conversation_idx ON events (conversation_id);
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      project_id TEXT,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ,
      iterations INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      error TEXT
    );
    CREATE INDEX agent_runs_started_idx ON agent_runs (started_at);
  `
}

/** Ordered list. */
export const MIGRATIONS: readonly Migration[] = [m001]
