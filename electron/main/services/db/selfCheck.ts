import { mkdir, rm } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DbService } from './DbService'
import type { Migration } from './migrations'
import { SettingsService } from '../settings/SettingsService'
import { EventBus, type EventSink } from '../events/EventBus'
import type { WoneEvent, EventPersistence } from '@shared/types/events'

/**
 * Dev-only startup smoke (never runs packaged). Proves the P2A foundation on
 * scratch files inside its own subdirectory — it never touches the real
 * settings, vault, or user data beyond `<dataDir>/selfcheck/`.
 */
export async function runSelfCheck(opts: {
  dataDir: string
  /** The real, already-migrated DB — pragma/health assertions only. */
  db: DbService
  expectedVersion: number
}): Promise<void> {
  const scratch = join(opts.dataDir, 'selfcheck')
  await rm(scratch, { recursive: true, force: true })
  await mkdir(scratch, { recursive: true })

  try {
    checkRealDb(opts.db, opts.expectedVersion)
    checkMigrationRunner(scratch)
    await checkSettingsRoundtrip(scratch)
    checkEventBus()
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`[selfcheck] ${message}`)
}

function checkRealDb(db: DbService, expectedVersion: number): void {
  const journal = db.db.pragma('journal_mode', { simple: true })
  assert(journal === 'wal', `journal_mode is ${String(journal)}, expected wal`)
  const fk = db.db.pragma('foreign_keys', { simple: true })
  assert(fk === 1, 'foreign_keys is off')
  assert(
    db.version === expectedVersion,
    `user_version is ${db.version}, expected ${expectedVersion}`
  )
}

/** Exercises open → migrate → backup → idempotent re-run on a scratch DB. */
function checkMigrationRunner(scratch: string): void {
  const TEST_MIGRATIONS: readonly Migration[] = [
    {
      version: 1,
      name: 'test',
      up: `CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER NOT NULL);
           INSERT INTO t (id, v) VALUES ('a', 1);`
    }
  ]
  const backupsDir = join(scratch, 'backups')
  const db = new DbService({ file: join(scratch, 'scratch.db'), backupsDir })
  try {
    const first = db.migrate(TEST_MIGRATIONS)
    assert(first.from === 0 && first.to === 1, `migrate went ${first.from}→${first.to}`)
    const row = db.db.prepare('SELECT v FROM t WHERE id = ?').get('a') as { v: number }
    assert(row?.v === 1, 'migrated table not readable')
    assert(readdirSync(backupsDir).length === 1, 'pre-migration backup missing')

    const second = db.migrate(TEST_MIGRATIONS)
    assert(second.applied.length === 0 && db.version === 1, 'migrate is not idempotent')
    assert(readdirSync(backupsDir).length === 1, 'idempotent re-run created a backup')
  } finally {
    db.close()
  }
}

async function checkSettingsRoundtrip(scratch: string): Promise<void> {
  const file = join(scratch, 'settings.json')
  const a = new SettingsService(file)
  await a.init()
  assert(a.get().vaultRoot === undefined, 'fresh settings not empty')
  await a.update({ vaultRoot: '/tmp/selfcheck-vault' })

  const b = new SettingsService(file)
  await b.init()
  assert(b.get().vaultRoot === '/tmp/selfcheck-vault', 'settings roundtrip failed')
}

/** Isolated bus instance with a recording sink — no pollution of the real bus. */
function checkEventBus(): void {
  const persisted: Array<{ event: WoneEvent; cls: EventPersistence }> = []
  const sink: EventSink = { persist: (event, cls) => persisted.push({ event, cls }) }
  const bus = new EventBus({ sink })

  let received: WoneEvent | null = null
  const off = bus.subscribe('*', (e) => (received = e))
  const emitted = bus.emit('app.started', { payload: { selfcheck: true } })
  off()

  assert(received !== null && (received as WoneEvent).id === emitted.id, 'subscriber not notified')
  assert(persisted.length === 1, 'activity event did not reach the sink')
  assert(persisted[0]?.cls === 'activity', 'wrong persistence class')

  bus.emit('app.started', {}) // after unsubscribe → only the sink hears it
  assert(persisted[1] !== undefined && (received as WoneEvent).id === emitted.id, 'unsubscribe failed')
}
