import { Pool, type PoolConfig } from 'pg'
import type { Migration } from './migrations'

/** Minimal pool surface DbService needs — satisfied by `pg.Pool` and test doubles. */
export interface DbPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  connect(): Promise<{
    query(sql: string, params?: unknown[]): Promise<unknown>
    release(): void
  }>
  end(): Promise<void>
}

export interface MigrateResult {
  from: number
  to: number
  applied: string[]
}

/** Default matches docker-compose.yml (bound to 127.0.0.1 only). Override: WONE_DB_URL. */
export const DEFAULT_DB_URL = 'postgres://wone:wone@127.0.0.1:54329/wone'

export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.WONE_DB_URL || DEFAULT_DB_URL
}

/** A real pg pool with short timeouts, so a missing database fails fast at boot. */
export function createPool(url: string, extra: PoolConfig = {}): DbPool {
  return new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3000, ...extra })
}

/**
 * Owns the Postgres connection pool (Docker, see docker-compose.yml) and the
 * forward-only migration runner. Each migration runs in one transaction —
 * Postgres DDL is transactional, so a failing migration leaves no trace and
 * no file backup is needed (`npm run db:backup` dumps the data on demand).
 */
export class DbService {
  constructor(private readonly pool: DbPool) {}

  /** Throws if the database is unreachable. */
  async ping(): Promise<void> {
    await this.pool.query('SELECT 1')
  }

  /** Highest applied migration version (0 = none). */
  async version(): Promise<number> {
    await this.ensureLedger()
    const { rows } = await this.pool.query('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
    return Number(rows[0]?.v ?? 0)
  }

  /** Applies every migration newer than the current version, in order. Idempotent. */
  async migrate(migrations: readonly Migration[]): Promise<MigrateResult> {
    const from = await this.version()
    const pending = [...migrations].sort((a, b) => a.version - b.version).filter((m) => m.version > from)
    const applied: string[] = []
    for (const m of pending) {
      const client = await this.pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(m.up)
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [m.version, m.name])
        await client.query('COMMIT')
        applied.push(`${m.version}_${m.name}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    }
    return { from, to: applied.length ? pending[pending.length - 1].version : from, applied }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  private async ensureLedger(): Promise<void> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    )
  }
}
