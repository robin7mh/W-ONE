import { readFile } from 'node:fs/promises'
import type { AgentRun } from '@shared/types/ai'
import { writeAtomic } from '../../lib/writeAtomic'

const MAX_LIMIT = 200

/**
 * Agent runs (architecture §7): the newest `capacity` in memory for the live
 * view, saved as one small JSON file in the data folder so they survive a restart.
 */
export class RunStore {
  private readonly runs = new Map<string, AgentRun>()

  /** Without a file (tests, tools) it is memory only. */
  constructor(
    private readonly file?: string,
    private readonly capacity = 200
  ) {}

  /** The runs from earlier sessions; an unreadable file starts empty. */
  async load(): Promise<void> {
    if (!this.file) return
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8')) as { runs?: AgentRun[] }
      for (const run of saved.runs ?? []) this.runs.set(run.id, run)
    } catch {
      /* no file yet, or damaged */
    }
  }

  /** Insert or update; storage errors are logged, never thrown into the run. */
  async save(run: AgentRun): Promise<void> {
    this.runs.delete(run.id)
    this.runs.set(run.id, { ...run })
    while (this.runs.size > this.capacity) this.runs.delete(this.runs.keys().next().value as string)
    if (!this.file) return
    try {
      await writeAtomic(this.file, JSON.stringify({ version: 1, runs: [...this.runs.values()] }))
    } catch (err) {
      console.warn(`[runs] could not store run ${run.id}: ${(err as Error).message}`)
    }
  }

  /** Newest first. */
  async list(limit = 50): Promise<AgentRun[]> {
    const n = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)))
    return [...this.runs.values()].reverse().slice(0, n)
  }
}
