import Database from 'better-sqlite3'
import { copyFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Migration } from './migrations'

export interface DbServiceOptions {
  /** Absolute path of the SQLite file (parent dir must exist). */
  file: string
  /** Where pre-migration backups go (created on demand). */
  backupsDir: string
}

export interface MigrateResult {
  from: number
  to: number
  applied: string[]
}

/**
 * Owns the SQLite connection (better-sqlite3, synchronous — ideal in the main
 * process) and the forward-only migration runner. Throws from the constructor
 * when the native module does not match the Electron ABI — callers catch and
 * surface "run npm run rebuild" instead of crashing the app.
 */
export class DbService {
  readonly db: Database.Database
  private readonly file: string
  private readonly backupsDir: string

  constructor(opts: DbServiceOptions) {
    this.file = opts.file
    this.backupsDir = opts.backupsDir
    this.db = new Database(this.file)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('synchronous = NORMAL')
  }

  get version(): number {
    return this.db.pragma('user_version', { simple: true }) as number
  }

  /**
   * Applies every migration newer than the current user_version, in order,
   * one transaction each. Before the first pending migration the DB file is
   * backed up (WAL checkpoint first, so the copy is complete). Re-running with
   * no pending migrations is a no-op.
   */
  migrate(migrations: readonly Migration[]): MigrateResult {
    const from = this.version
    const pending = [...migrations]
      .sort((a, b) => a.version - b.version)
      .filter((m) => m.version > from)

    if (pending.length === 0) return { from, to: from, applied: [] }

    this.backup(from)
    const applied: string[] = []
    for (const migration of pending) {
      this.db.transaction(() => {
        this.db.exec(migration.up)
        this.db.pragma(`user_version = ${migration.version}`)
      })()
      applied.push(`${migration.version}_${migration.name}`)
    }
    return { from, to: this.version, applied }
  }

  private backup(fromVersion: number): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)')
    mkdirSync(this.backupsDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = join(this.backupsDir, `${basename(this.file)}.v${fromVersion}.${stamp}.bak`)
    copyFileSync(this.file, target)
  }

  close(): void {
    this.db.close()
  }
}
