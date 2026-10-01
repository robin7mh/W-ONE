import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'

const created: string[] = []

/** A fresh temp directory, removed after the current test. */
export async function tempDir(prefix = 'wone-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

/** Resolves after pending timers/IO callbacks have had a chance to run. */
export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
