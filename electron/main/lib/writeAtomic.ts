import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** The last write queued per file. */
const queues = new Map<string, Promise<void>>()

/**
 * Writes a file atomically (temp file + rename, so a crash never leaves half a
 * file) and one write at a time per file: concurrent writes would race on the
 * shared temp file (ENOENT on the second rename) or let an older state land
 * last. Each write gets a fresh temp file, so `mode` always applies, and a
 * failed one is cleaned up — it rejects its caller but never blocks the next.
 */
export function writeAtomic(file: string, data: string, mode?: number): Promise<void> {
  const run = (queues.get(file) ?? Promise.resolve()).then(async () => {
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`
    try {
      await writeFile(tmp, data, { encoding: 'utf8', mode })
      await rename(tmp, file)
    } catch (err) {
      await rm(tmp, { force: true })
      throw err
    }
  })
  const tail = run.catch(() => {})
  queues.set(file, tail)
  void tail.then(() => {
    if (queues.get(file) === tail) queues.delete(file)
  })
  return run
}
